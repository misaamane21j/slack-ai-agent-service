/**
 * Integration tests for error boundary and recovery mechanism validation
 * Tests complete error recovery flows and boundary interactions
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { ToolExecutionBoundary } from '../../src/errors/boundaries/ToolExecutionBoundary';
import { AIProcessingBoundary } from '../../src/errors/boundaries/AIProcessingBoundary';
import { SlackResponseBoundary } from '../../src/errors/boundaries/SlackResponseBoundary';
import { ConfigurationBoundary } from '../../src/errors/boundaries/ConfigurationBoundary';
import { RegistryBoundary } from '../../src/errors/boundaries/RegistryBoundary';
import { BoundaryState } from '../../src/errors/boundaries/ErrorBoundary';
import { ResilienceOrchestrator } from '../../src/errors/resilience/ResilienceOrchestrator';
import { ResilienceBoundary } from '../../src/errors/resilience/ResilienceBoundary';
import { RecoveryStrategyManager, RecoveryResult, RecoveryStrategy } from '../../src/errors/recovery/RecoveryStrategy';
import { ErrorContextBuilder, ProcessingStage, OperationPhase } from '../../src/errors/context/ErrorContext';
import { ContextPreserver } from '../../src/errors/context/ContextPreserver';
import { ErrorSeverity, RecoveryAction, ErrorCategory } from '../../src/errors/types';
import { MCPToolError, MCPConnectionError } from '../../src/errors/mcp-tool';
import { AIProcessingError, AIValidationError } from '../../src/errors/ai-processing';
import { ConfigurationError } from '../../src/errors/configuration';
import { SecurityError } from '../../src/errors/security';
import { MonitoringOrchestrator } from '../../src/monitoring/MonitoringOrchestrator';

// Mock monitoring
jest.mock('../../src/monitoring/MonitoringOrchestrator');

// Use real timers for recovery testing
jest.useRealTimers();

describe('Error Recovery and Boundary Validation', () => {
  let toolBoundary: ToolExecutionBoundary;
  let aiBoundary: AIProcessingBoundary;
  let slackBoundary: SlackResponseBoundary;
  let configBoundary: ConfigurationBoundary;
  let registryBoundary: RegistryBoundary;
  let resilienceOrchestrator: ResilienceOrchestrator;
  let recoveryManager: RecoveryStrategyManager;
  let contextPreserver: ContextPreserver;
  let monitoring: jest.Mocked<MonitoringOrchestrator>;

  beforeEach(() => {
    // Initialize boundaries
    toolBoundary = new ToolExecutionBoundary();
    aiBoundary = new AIProcessingBoundary();
    slackBoundary = new SlackResponseBoundary();
    configBoundary = new ConfigurationBoundary();
    registryBoundary = new RegistryBoundary();
    
    // Initialize recovery and resilience components
    resilienceOrchestrator = new ResilienceOrchestrator();
    recoveryManager = new RecoveryStrategyManager();
    contextPreserver = new ContextPreserver();
    
    // Mock monitoring
    monitoring = new MonitoringOrchestrator() as jest.Mocked<MonitoringOrchestrator>;
    monitoring.recordError = jest.fn();
    monitoring.recordRecovery = jest.fn();
    monitoring.recordPerformanceMetric = jest.fn();
    monitoring.updateUserExperience = jest.fn();
  });

  describe('Multi-Boundary Interaction Tests', () => {
    it('should handle cascading failures across multiple boundaries', async () => {
      // Arrange
      const context = ErrorContextBuilder.create()
        .withSeverity(ErrorSeverity.HIGH)
        .withOperation('cascading_failure', OperationPhase.TOOL_INVOCATION)
        .withExecutionState(ProcessingStage.TOOL_EXECUTION)
        .withUserContext('U123456789', 'C123456789', 'T123456789')
        .build();

      // Primary tool operation fails
      const primaryToolOperation = async () => {
        throw new MCPConnectionError('Primary tool server down', {
          operation: 'execute',
          serverName: 'primary-server',
          recoveryActions: [RecoveryAction.USE_FALLBACK]
        });
      };

      // Secondary tool operation also fails
      const secondaryToolOperation = async () => {
        throw new MCPToolError('Secondary tool failed', {
          toolName: 'backup-tool',
          operation: 'execute',
          recoveryActions: [RecoveryAction.USE_FALLBACK]
        });
      };

      // AI processing fallback fails
      const aiProcessingFallback = async () => {
        throw new AIProcessingError('AI service overloaded', {
          model: 'fallback-model',
          operation: 'text_generation',
          statusCode: 503,
          recoveryActions: [RecoveryAction.USE_FALLBACK]
        });
      };

      // Final fallback to static response
      const staticFallback = async () => {
        return JSON.stringify({
          message: 'Service temporarily unavailable. Your request has been queued.',
          queued: true,
          estimatedTime: '5-10 minutes'
        });
      };

      // Act
      let result = await toolBoundary.execute(primaryToolOperation, context, secondaryToolOperation);
      if (!result.success) {
        result = await aiBoundary.execute(aiProcessingFallback, context, staticFallback);
      }

      // Assert
      expect(result.fallbackUsed).toBe(true);
      expect(result.result).toContain('queued');
      expect(toolBoundary.getState()).toBe(BoundaryState.DEGRADED);
      expect(aiBoundary.getState()).toBe(BoundaryState.DEGRADED);
      
      // Verify monitoring recorded the cascade
      expect(monitoring.recordError).toHaveBeenCalledTimes(2);
    });

    it('should isolate failures to prevent boundary contamination', async () => {
      // Arrange
      const toolContext = ErrorContextBuilder.create()
        .withSeverity(ErrorSeverity.CRITICAL)
        .withOperation('isolated_tool_failure', OperationPhase.TOOL_INVOCATION)
        .withExecutionState(ProcessingStage.TOOL_EXECUTION)
        .build();

      const aiContext = ErrorContextBuilder.create()
        .withSeverity(ErrorSeverity.LOW)
        .withOperation('healthy_ai_operation', OperationPhase.AI_INVOCATION)
        .withExecutionState(ProcessingStage.AI_PROCESSING)
        .build();

      const criticalToolFailure = async () => {
        throw new SecurityError('Critical security violation in tool', {
          violationType: 'privilege_escalation',
          inputSource: 'tool_parameter',
          recoveryActions: [RecoveryAction.ISOLATE_COMPONENT]
        });
      };

      const healthyAIOperation = async () => {
        return JSON.stringify({ intent: 'help', confidence: 0.9 });
      };

      // Act
      const toolResult = await toolBoundary.execute(criticalToolFailure, toolContext);
      const aiResult = await aiBoundary.execute(healthyAIOperation, aiContext);

      // Assert
      expect(toolResult.success).toBe(false);
      expect(aiResult.success).toBe(true);
      expect(toolBoundary.getState()).toBe(BoundaryState.ISOLATED);
      expect(aiBoundary.getState()).toBe(BoundaryState.HEALTHY);
      
      // Tool boundary should be isolated but AI boundary unaffected
      expect(toolBoundary.isIsolated()).toBe(true);
      expect(aiBoundary.isIsolated()).toBe(false);
    });
  });

  describe('Recovery Strategy Validation', () => {
    it('should execute appropriate recovery strategies based on error type', async () => {
      // Arrange
      const contexts = [
        {
          context: ErrorContextBuilder.create()
            .withSeverity(ErrorSeverity.MEDIUM)
            .withOperation('network_retry', OperationPhase.TOOL_INVOCATION)
            .withExecutionState(ProcessingStage.TOOL_EXECUTION)
            .build(),
          error: new MCPConnectionError('Network timeout', {
            operation: 'connect',
            serverName: 'test-server',
            timeout: 5000,
            recoveryActions: [RecoveryAction.RETRY_WITH_BACKOFF]
          }),
          expectedStrategy: RecoveryStrategy.EXPONENTIAL_BACKOFF
        },
        {
          context: ErrorContextBuilder.create()
            .withSeverity(ErrorSeverity.HIGH)
            .withOperation('validation_error', OperationPhase.RESPONSE_PROCESSING)
            .withExecutionState(ProcessingStage.AI_PROCESSING)
            .build(),
          error: new AIValidationError('Invalid response format', {
            validationRules: ['json_format', 'required_fields'],
            violatedRules: ['json_format'],
            recoveryActions: [RecoveryAction.SANITIZE_INPUT]
          }),
          expectedStrategy: RecoveryStrategy.INPUT_SANITIZATION
        },
        {
          context: ErrorContextBuilder.create()
            .withSeverity(ErrorSeverity.CRITICAL)
            .withOperation('security_violation', OperationPhase.SECURITY_CHECK)
            .withExecutionState(ProcessingStage.SECURITY_VALIDATION)
            .build(),
          error: new SecurityError('Command injection detected', {
            violationType: 'command_injection',
            inputSource: 'user_input',
            recoveryActions: [RecoveryAction.ISOLATE_COMPONENT]
          }),
          expectedStrategy: RecoveryStrategy.ISOLATION
        }
      ];

      // Act & Assert
      for (const { context, error, expectedStrategy } of contexts) {
        const recoveryResult = await recoveryManager.executeRecovery(error, context);
        
        expect(recoveryResult).toBeDefined();
        expect(recoveryResult.strategy).toBe(expectedStrategy);
        expect([RecoveryResult.SUCCESS, RecoveryResult.PARTIAL_SUCCESS]).toContain(recoveryResult.result);
        
        if (recoveryResult.result === RecoveryResult.SUCCESS) {
          expect(monitoring.recordRecovery).toHaveBeenCalledWith(
            expect.objectContaining({
              errorType: error.constructor.name,
              recoveryStrategy: expectedStrategy,
              success: true
            })
          );
        }
      }
    });

    it('should chain recovery strategies when primary strategy fails', async () => {
      // Arrange
      const context = ErrorContextBuilder.create()
        .withSeverity(ErrorSeverity.HIGH)
        .withOperation('chained_recovery', OperationPhase.TOOL_INVOCATION)
        .withExecutionState(ProcessingStage.TOOL_EXECUTION)
        .withUserContext('U123456789', 'C123456789', 'T123456789')
        .build();

      let retryAttempts = 0;
      const multiFailureOperation = async () => {
        retryAttempts++;
        
        if (retryAttempts === 1) {
          throw new MCPConnectionError('Initial connection failure', {
            operation: 'connect',
            serverName: 'primary-server',
            recoveryActions: [RecoveryAction.RETRY_WITH_BACKOFF, RecoveryAction.USE_FALLBACK]
          });
        }
        
        if (retryAttempts === 2) {
          throw new MCPConnectionError('Retry failed', {
            operation: 'retry_connect',
            serverName: 'primary-server',
            recoveryActions: [RecoveryAction.USE_FALLBACK]
          });
        }
        
        // Third attempt succeeds with fallback
        return 'fallback_server_success';
      };

      // Act
      const result = await toolBoundary.execute(multiFailureOperation, context);

      // Assert
      expect(result.success).toBe(true);
      expect(result.result).toBe('fallback_server_success');
      expect(retryAttempts).toBe(3);
      
      // Should have recorded recovery attempts
      expect(monitoring.recordRecovery).toHaveBeenCalled();
    });
  });

  describe('Context Preservation and Restoration', () => {
    it('should preserve and restore context during error recovery', async () => {
      // Arrange
      const originalContext = ErrorContextBuilder.create()
        .withSeverity(ErrorSeverity.HIGH)
        .withOperation('context_preservation', OperationPhase.TOOL_INVOCATION)
        .withExecutionState(ProcessingStage.TOOL_EXECUTION)
        .withUserContext('U123456789', 'C123456789', 'T123456789')
        .withConversationMetadata('important-conversation', 'critical-thread', 'sensitive operation')
        .withExecutionState(ProcessingStage.TOOL_EXECUTION)
        .withProcessingMetrics({
          toolSelections: ['jenkins_deploy', 'notification_send'],
          retryCount: 2,
          maxRetries: 5,
          partialResults: {
            deploymentId: 'dep-12345',
            environment: 'production'
          }
        })
        .build();

      const contextPreservingOperation = async () => {
        throw new MCPConnectionError('Connection lost during critical operation', {
          operation: 'deploy_to_production',
          serverName: 'production-jenkins',
          preserveContext: true,
          recoveryActions: [RecoveryAction.PRESERVE_CONTEXT, RecoveryAction.RETRY_WITH_BACKOFF]
        });
      };

      const contextAwareRecovery = async () => {
        // Simulate recovery that uses preserved context
        return JSON.stringify({
          status: 'recovered',
          preservedDeployment: 'dep-12345',
          message: 'Operation resumed from checkpoint'
        });
      };

      // Act
      const result = await toolBoundary.execute(
        contextPreservingOperation,
        originalContext,
        contextAwareRecovery
      );

      // Assert
      expect(result.fallbackUsed).toBe(true);
      expect(result.preservedStateId).toBeDefined();
      expect(result.result).toContain('dep-12345');
      expect(result.result).toContain('resumed from checkpoint');

      // Verify context was preserved with correct metadata
      const preservedData = JSON.parse(result.result as string);
      expect(preservedData.preservedDeployment).toBe('dep-12345');
    });

    it('should handle context restoration failures gracefully', async () => {
      // Arrange
      const context = ErrorContextBuilder.create()
        .withSeverity(ErrorSeverity.MEDIUM)
        .withOperation('context_restoration_failure', OperationPhase.TOOL_INVOCATION)
        .withExecutionState(ProcessingStage.TOOL_EXECUTION)
        .build();

      const contextCorruptionOperation = async () => {
        throw new MCPToolError('Context corruption detected', {
          toolName: 'data_processor',
          operation: 'process_with_context',
          contextCorrupted: true,
          recoveryActions: [RecoveryAction.PRESERVE_CONTEXT, RecoveryAction.USE_DEFAULT_VALUES]
        });
      };

      const defaultValueRecovery = async () => {
        return JSON.stringify({
          status: 'recovered_with_defaults',
          message: 'Context was corrupted, using safe defaults',
          defaults_used: true
        });
      };

      // Act
      const result = await toolBoundary.execute(
        contextCorruptionOperation,
        context,
        defaultValueRecovery
      );

      // Assert
      expect(result.fallbackUsed).toBe(true);
      expect(result.success).toBe(true);
      
      const recoveryData = JSON.parse(result.result as string);
      expect(recoveryData.defaults_used).toBe(true);
      expect(recoveryData.message).toContain('safe defaults');
    });
  });

  describe('Resilience Orchestrator Integration', () => {
    it('should coordinate multiple resilience patterns', async () => {
      // Arrange
      const resilienceBoundary = new ResilienceBoundary({
        enableCircuitBreaker: true,
        enableExponentialBackoff: true,
        enableFallbackChain: true,
        enableGracefulDegradation: true
      });

      const context = ErrorContextBuilder.create()
        .withSeverity(ErrorSeverity.HIGH)
        .withOperation('resilience_coordination', OperationPhase.TOOL_INVOCATION)
        .withExecutionState(ProcessingStage.TOOL_EXECUTION)
        .build();

      let attemptCount = 0;
      const multiPatternOperation = async () => {
        attemptCount++;
        
        if (attemptCount <= 2) {
          throw new MCPConnectionError(`Attempt ${attemptCount} failed`, {
            operation: 'resilience_test',
            serverName: 'resilience-server',
            recoveryActions: [RecoveryAction.RETRY_WITH_BACKOFF]
          });
        }
        
        if (attemptCount === 3) {
          throw new MCPToolError('Primary tool unavailable', {
            toolName: 'primary_tool',
            operation: 'execute',
            recoveryActions: [RecoveryAction.USE_FALLBACK]
          });
        }
        
        return 'resilience_success';
      };

      const degradedFallback = async () => {
        return 'degraded_mode_response';
      };

      // Act
      const result = await resilienceBoundary.execute(
        multiPatternOperation,
        context,
        degradedFallback
      );

      // Assert
      expect(result.fallbackUsed).toBe(true);
      expect(result.result).toBe('degraded_mode_response');
      expect(attemptCount).toBe(4); // 3 failures + 1 fallback
      
      // Should demonstrate multiple resilience patterns working together
      expect(resilienceBoundary.getMetrics().patterns.exponentialBackoff.used).toBe(true);
      expect(resilienceBoundary.getMetrics().patterns.fallbackChain.used).toBe(true);
    });

    it('should adapt resilience strategy based on error patterns', async () => {
      // Arrange
      const adaptiveContext = ErrorContextBuilder.create()
        .withSeverity(ErrorSeverity.MEDIUM)
        .withOperation('adaptive_resilience', OperationPhase.TOOL_INVOCATION)
        .withExecutionState(ProcessingStage.TOOL_EXECUTION)
        .build();

      // Simulate different error patterns
      const errorPatterns = [
        () => new MCPConnectionError('Network timeout', {
          operation: 'connect',
          serverName: 'adaptive-server',
          recoveryActions: [RecoveryAction.RETRY_WITH_BACKOFF]
        }),
        () => new MCPToolError('Rate limit exceeded', {
          toolName: 'adaptive_tool',
          operation: 'execute',
          statusCode: 429,
          recoveryActions: [RecoveryAction.EXPONENTIAL_BACKOFF]
        }),
        () => new AIProcessingError('Model overloaded', {
          model: 'adaptive-model',
          operation: 'process',
          statusCode: 503,
          recoveryActions: [RecoveryAction.USE_FALLBACK]
        })
      ];

      const adaptiveOperation = (errorIndex: number) => async () => {
        throw errorPatterns[errorIndex]();
      };

      const adaptiveFallback = async () => 'adaptive_fallback_success';

      // Act
      const results = [];
      for (let i = 0; i < errorPatterns.length; i++) {
        const result = await resilienceOrchestrator.execute(
          adaptiveOperation(i),
          adaptiveContext,
          adaptiveFallback
        );
        results.push(result);
        
        // Reset for next test
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Assert
      expect(results.every(r => r.success || r.fallbackUsed)).toBe(true);
      
      // Verify that different strategies were used for different error types
      const orchestratorMetrics = resilienceOrchestrator.getMetrics();
      expect(orchestratorMetrics.strategiesUsed).toContain('exponential_backoff');
      expect(orchestratorMetrics.strategiesUsed).toContain('fallback_chain');
    });
  });

  describe('Boundary State Management', () => {
    it('should transition boundary states correctly during recovery', async () => {
      // Arrange
      const context = ErrorContextBuilder.create()
        .withSeverity(ErrorSeverity.HIGH)
        .withOperation('state_transition', OperationPhase.TOOL_INVOCATION)
        .withExecutionState(ProcessingStage.TOOL_EXECUTION)
        .build();

      expect(toolBoundary.getState()).toBe(BoundaryState.HEALTHY);

      // Act & Assert - Error causes degradation
      const firstFailure = async () => {
        throw new MCPToolError('First failure', {
          toolName: 'state_test_tool',
          operation: 'execute',
          recoveryActions: [RecoveryAction.RETRY_WITH_BACKOFF]
        });
      };

      await toolBoundary.execute(firstFailure, context);
      expect(toolBoundary.getState()).toBe(BoundaryState.HEALTHY); // Still healthy after one error

      // Second failure causes degradation
      await toolBoundary.execute(firstFailure, context);
      expect(toolBoundary.getState()).toBe(BoundaryState.DEGRADED);

      // Third failure causes isolation
      await toolBoundary.execute(firstFailure, context);
      expect(toolBoundary.getState()).toBe(BoundaryState.ISOLATED);

      // Successful operation after isolation period should start recovery
      const successOperation = async () => 'success';
      
      // Wait for isolation period to expire
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const recoveryResult = await toolBoundary.execute(successOperation, context);
      expect(recoveryResult.success).toBe(true);
      expect(toolBoundary.getState()).toBe(BoundaryState.DEGRADED); // Should transition to degraded

      // Another success should restore to healthy
      await toolBoundary.execute(successOperation, context);
      expect(toolBoundary.getState()).toBe(BoundaryState.HEALTHY);
    });

    it('should reset boundary states when explicitly requested', async () => {
      // Arrange
      const context = ErrorContextBuilder.create()
        .withSeverity(ErrorSeverity.CRITICAL)
        .withOperation('boundary_reset', OperationPhase.TOOL_INVOCATION)
        .withExecutionState(ProcessingStage.TOOL_EXECUTION)
        .build();

      // Force boundary into isolated state
      const criticalFailure = async () => {
        throw new SecurityError('Critical security violation', {
          violationType: 'privilege_escalation',
          inputSource: 'tool_execution',
          recoveryActions: [RecoveryAction.ISOLATE_COMPONENT]
        });
      };

      // Act
      await toolBoundary.execute(criticalFailure, context);
      await toolBoundary.execute(criticalFailure, context);
      await toolBoundary.execute(criticalFailure, context);
      
      expect(toolBoundary.getState()).toBe(BoundaryState.ISOLATED);
      expect(toolBoundary.isIsolated()).toBe(true);

      // Reset boundary
      toolBoundary.reset();

      // Assert
      expect(toolBoundary.getState()).toBe(BoundaryState.HEALTHY);
      expect(toolBoundary.isIsolated()).toBe(false);
      
      const metrics = toolBoundary.getMetrics();
      expect(metrics.errorCount).toBe(0);
      expect(metrics.lastErrorTime).toBeNull();
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });
});