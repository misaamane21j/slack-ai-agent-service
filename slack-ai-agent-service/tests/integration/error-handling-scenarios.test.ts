/**
 * Integration tests for comprehensive error handling scenarios
 * Tests complete error handling flow with realistic failure conditions
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { MonitoringOrchestrator } from '../../src/monitoring/MonitoringOrchestrator';
import { SlackBotService } from '../../src/services/slack-bot';
import { AIProcessor } from '../../src/services/ai-processor';
import { MCPClientWrapper } from '../../src/services/mcp-client-wrapper';
import { MCPRegistry } from '../../src/services/mcp-registry';
import { ErrorBoundary, BoundaryType, BoundaryState } from '../../src/errors/boundaries/ErrorBoundary';
import { ToolExecutionBoundary } from '../../src/errors/boundaries/ToolExecutionBoundary';
import { AIProcessingBoundary } from '../../src/errors/boundaries/AIProcessingBoundary';
import { ResilienceOrchestrator } from '../../src/errors/resilience/ResilienceOrchestrator';
import { CircuitBreaker } from '../../src/errors/resilience/CircuitBreaker';
import { ErrorContextBuilder, ProcessingStage, OperationPhase } from '../../src/errors/context/ErrorContext';
import { ErrorSeverity, RecoveryAction } from '../../src/errors/types';
import { MCPToolError, MCPConnectionError } from '../../src/errors/mcp-tool';
import { AIProcessingError, AIValidationError } from '../../src/errors/ai-processing';
import { SecurityError } from '../../src/errors/security';

// Mock dependencies
jest.mock('../../src/services/slack-bot');
jest.mock('../../src/services/ai-processor');
jest.mock('../../src/services/mcp-client-wrapper');
jest.mock('../../src/services/mcp-registry');
jest.mock('../../src/monitoring/MonitoringOrchestrator');

// Use real timers for integration testing
jest.useRealTimers();

describe('Error Handling Integration Scenarios', () => {
  let monitoringOrchestrator: jest.Mocked<MonitoringOrchestrator>;
  let slackBot: jest.Mocked<SlackBotService>;
  let aiProcessor: jest.Mocked<AIProcessor>;
  let mcpClient: jest.Mocked<MCPClientWrapper>;
  let mcpRegistry: jest.Mocked<MCPRegistry>;
  let toolBoundary: ToolExecutionBoundary;
  let aiBoundary: AIProcessingBoundary;
  let resilienceOrchestrator: ResilienceOrchestrator;

  beforeEach(() => {
    // Setup mocks
    monitoringOrchestrator = new MonitoringOrchestrator() as jest.Mocked<MonitoringOrchestrator>;
    slackBot = new SlackBotService({} as any, {} as any, {} as any, {} as any) as jest.Mocked<SlackBotService>;
    aiProcessor = new AIProcessor({} as any) as jest.Mocked<AIProcessor>;
    mcpClient = new MCPClientWrapper({} as any, {} as any) as jest.Mocked<MCPClientWrapper>;
    mcpRegistry = new MCPRegistry({} as any) as jest.Mocked<MCPRegistry>;
    
    // Create boundary instances
    toolBoundary = new ToolExecutionBoundary();
    aiBoundary = new AIProcessingBoundary();
    resilienceOrchestrator = new ResilienceOrchestrator();

    // Setup default mock behaviors
    monitoringOrchestrator.recordError = jest.fn();
    monitoringOrchestrator.recordRecovery = jest.fn();
    monitoringOrchestrator.updateUserExperience = jest.fn();
    monitoringOrchestrator.recordPerformanceMetric = jest.fn();
  });

  describe('MCP Tool Failure Scenarios', () => {
    it('should handle MCP connection timeout with graceful degradation', async () => {
      // Arrange
      const context = ErrorContextBuilder.create()
        .withSeverity(ErrorSeverity.HIGH)
        .withOperation('mcp_tool_execution', OperationPhase.TOOL_INVOCATION)
        .withExecutionState(ProcessingStage.TOOL_EXECUTION)
        .withUserContext('U123456789', 'C123456789', 'T123456789')
        .withConversationMetadata('test-conversation', 'test-thread', 'execute jenkins job')
        .build();

      const timeoutOperation = async () => {
        await new Promise((_, reject) => {
          setTimeout(() => {
            reject(new MCPConnectionError('Connection timeout', {
              operation: 'tool_execution',
              serverName: 'jenkins-mcp',
              timeout: 30000,
              recoveryActions: [RecoveryAction.RETRY_WITH_BACKOFF, RecoveryAction.USE_FALLBACK]
            }));
          }, 100);
        });
        return 'success';
      };

      const fallbackOperation = async () => {
        return 'fallback_response: Jenkins job queued manually';
      };

      // Act
      const result = await toolBoundary.execute(timeoutOperation, context, fallbackOperation);

      // Assert
      expect(result.fallbackUsed).toBe(true);
      expect(result.result).toContain('fallback_response');
      expect(result.error).toBeInstanceOf(MCPConnectionError);
      expect(result.preservedStateId).toBeDefined();
      expect(monitoringOrchestrator.recordError).toHaveBeenCalledWith(
        expect.any(MCPConnectionError),
        expect.objectContaining({
          severity: ErrorSeverity.HIGH,
          operation: 'mcp_tool_execution'
        })
      );
    });

    it('should escalate to circuit breaker after multiple MCP failures', async () => {
      // Arrange
      const context = ErrorContextBuilder.create()
        .withSeverity(ErrorSeverity.CRITICAL)
        .withOperation('repeated_mcp_failure', OperationPhase.TOOL_INVOCATION)
        .withExecutionState(ProcessingStage.TOOL_EXECUTION)
        .build();

      const failingOperation = async () => {
        throw new MCPToolError('Tool execution failed', {
          toolName: 'jenkins_job_trigger',
          operation: 'execute',
          recoveryActions: [RecoveryAction.RETRY_WITH_BACKOFF]
        });
      };

      // Act - Execute multiple times to trigger circuit breaker
      const results = [];
      for (let i = 0; i < 5; i++) {
        const result = await toolBoundary.execute(failingOperation, context);
        results.push(result);
      }

      // Assert
      expect(toolBoundary.getState()).toBe(BoundaryState.ISOLATED);
      expect(results.every(r => !r.success)).toBe(true);
      expect(monitoringOrchestrator.recordError).toHaveBeenCalledTimes(5);
    });

    it('should handle malformed MCP tool responses with validation', async () => {
      // Arrange
      const context = ErrorContextBuilder.create()
        .withSeverity(ErrorSeverity.MEDIUM)
        .withOperation('mcp_response_validation', OperationPhase.RESPONSE_PROCESSING)
        .withExecutionState(ProcessingStage.AI_PROCESSING)
        .build();

      const malformedResponseOperation = async () => {
        // Simulate malformed JSON response
        const malformedResponse = '{"incomplete": json,}';
        throw new MCPToolError('Invalid response format', {
          toolName: 'jenkins_status',
          operation: 'get_job_status',
          rawResponse: malformedResponse,
          recoveryActions: [RecoveryAction.SANITIZE_INPUT, RecoveryAction.USE_DEFAULT_VALUES]
        });
      };

      const sanitizedFallback = async () => {
        return JSON.stringify({
          status: 'unknown',
          message: 'Unable to retrieve job status'
        });
      };

      // Act
      const result = await toolBoundary.execute(malformedResponseOperation, context, sanitizedFallback);

      // Assert
      expect(result.fallbackUsed).toBe(true);
      expect(result.result).toContain('unknown');
      expect(JSON.parse(result.result as string).status).toBe('unknown');
    });
  });

  describe('AI Processing Error Scenarios', () => {
    it('should handle AI service unavailable with fallback model', async () => {
      // Arrange
      const context = ErrorContextBuilder.create()
        .withSeverity(ErrorSeverity.HIGH)
        .withOperation('ai_processing', OperationPhase.AI_INVOCATION)
        .withExecutionState(ProcessingStage.AI_PROCESSING)
        .withUserContext('U123456789', 'C123456789', 'T123456789')
        .withConversationMetadata('ai-test', 'thread-123', 'process user request')
        .build();

      const primaryAIOperation = async () => {
        throw new AIProcessingError('Primary AI service unavailable', {
          model: 'claude-3-5-sonnet',
          operation: 'text_completion',
          statusCode: 503,
          recoveryActions: [RecoveryAction.USE_FALLBACK, RecoveryAction.RETRY_WITH_BACKOFF]
        });
      };

      const fallbackAIOperation = async () => {
        return JSON.stringify({
          intent: 'help_request',
          confidence: 0.8,
          response: 'I understand you need help. Due to temporary service issues, I\'m using a backup system.'
        });
      };

      // Act
      const result = await aiBoundary.execute(primaryAIOperation, context, fallbackAIOperation);

      // Assert
      expect(result.fallbackUsed).toBe(true);
      expect(result.result).toContain('backup system');
      expect(monitoringOrchestrator.updateUserExperience).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'U123456789',
          degradationLevel: expect.any(String)
        })
      );
    });

    it('should validate and sanitize AI responses', async () => {
      // Arrange
      const context = ErrorContextBuilder.create()
        .withSeverity(ErrorSeverity.MEDIUM)
        .withOperation('ai_response_validation', OperationPhase.RESPONSE_PROCESSING)
        .withExecutionState(ProcessingStage.AI_PROCESSING)
        .build();

      const invalidAIResponse = async () => {
        // Simulate AI returning potentially harmful content
        throw new AIValidationError('Response failed security validation', {
          validationRules: ['no_code_injection', 'no_sensitive_data'],
          violatedRules: ['no_code_injection'],
          originalResponse: 'DELETE FROM users; -- malicious content',
          recoveryActions: [RecoveryAction.SANITIZE_INPUT, RecoveryAction.USE_DEFAULT_VALUES]
        });
      };

      const sanitizedResponse = async () => {
        return JSON.stringify({
          intent: 'help_request',
          confidence: 0.7,
          response: 'I can help you with that request. Please provide more details.'
        });
      };

      // Act
      const result = await aiBoundary.execute(invalidAIResponse, context, sanitizedResponse);

      // Assert
      expect(result.fallbackUsed).toBe(true);
      expect(result.result).not.toContain('DELETE');
      expect(result.result).toContain('help you');
    });
  });

  describe('Security Error Scenarios', () => {
    it('should handle security violations with immediate isolation', async () => {
      // Arrange
      const context = ErrorContextBuilder.create()
        .withSeverity(ErrorSeverity.CRITICAL)
        .withOperation('security_validation', OperationPhase.SECURITY_CHECK)
        .withExecutionState(ProcessingStage.SECURITY_VALIDATION)
        .withUserContext('U123456789', 'C123456789', 'T123456789')
        .build();

      const securityViolation = async () => {
        throw new SecurityError('Command injection attempt detected', {
          violationType: 'command_injection',
          inputSource: 'user_message',
          blockedCommand: 'rm -rf /',
          recoveryActions: [RecoveryAction.BLOCK_REQUEST, RecoveryAction.LOG_INCIDENT]
        });
      };

      const secureResponse = async () => {
        return 'Request blocked for security reasons. Please contact administrator.';
      };

      // Act
      const result = await toolBoundary.execute(securityViolation, context, secureResponse);

      // Assert
      expect(result.fallbackUsed).toBe(true);
      expect(result.result).toContain('blocked for security');
      expect(toolBoundary.getState()).toBe(BoundaryState.ISOLATED);
      expect(monitoringOrchestrator.recordError).toHaveBeenCalledWith(
        expect.any(SecurityError),
        expect.objectContaining({
          severity: ErrorSeverity.CRITICAL
        })
      );
    });
  });

  describe('Network and Infrastructure Scenarios', () => {
    it('should handle cascading failures with progressive degradation', async () => {
      // Arrange
      const context = ErrorContextBuilder.create()
        .withSeverity(ErrorSeverity.CRITICAL)
        .withOperation('cascading_failure', OperationPhase.TOOL_INVOCATION)
        .withExecutionState(ProcessingStage.TOOL_EXECUTION)
        .build();

      // Simulate multiple system failures
      const primaryOperation = async () => {
        throw new MCPConnectionError('Primary MCP server unreachable', {
          operation: 'connect',
          serverName: 'jenkins-primary',
          recoveryActions: [RecoveryAction.USE_FALLBACK]
        });
      };

      const secondaryOperation = async () => {
        throw new MCPConnectionError('Secondary MCP server unreachable', {
          operation: 'connect', 
          serverName: 'jenkins-secondary',
          recoveryActions: [RecoveryAction.USE_FALLBACK]
        });
      };

      const emergencyFallback = async () => {
        return 'All external services temporarily unavailable. Your request has been queued for manual processing.';
      };

      // Act
      let result = await toolBoundary.execute(primaryOperation, context, secondaryOperation);
      if (!result.success) {
        result = await toolBoundary.execute(secondaryOperation, context, emergencyFallback);
      }

      // Assert
      expect(result.fallbackUsed).toBe(true);
      expect(result.result).toContain('manually');
      expect(toolBoundary.getState()).toBe(BoundaryState.DEGRADED);
    });

    it('should handle resource exhaustion with backoff', async () => {
      // Arrange
      const context = ErrorContextBuilder.create()
        .withSeverity(ErrorSeverity.HIGH)
        .withOperation('resource_exhaustion', OperationPhase.TOOL_INVOCATION)
        .withExecutionState(ProcessingStage.TOOL_EXECUTION)
        .build();

      let attemptCount = 0;
      const resourceExhaustionOperation = async () => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new MCPToolError('Rate limit exceeded', {
            toolName: 'jenkins_api',
            operation: 'trigger_job',
            statusCode: 429,
            recoveryActions: [RecoveryAction.RETRY_WITH_BACKOFF]
          });
        }
        return 'Job queued successfully';
      };

      // Act
      const startTime = Date.now();
      const result = await toolBoundary.execute(resourceExhaustionOperation, context);
      const duration = Date.now() - startTime;

      // Assert
      expect(result.success).toBe(true);
      expect(result.result).toContain('successfully');
      expect(attemptCount).toBe(3);
      expect(duration).toBeGreaterThan(100); // Should have some delay from backoff
    });
  });

  describe('Recovery and Resilience Validation', () => {
    it('should successfully recover from temporary failures', async () => {
      // Arrange
      const context = ErrorContextBuilder.create()
        .withSeverity(ErrorSeverity.MEDIUM)
        .withOperation('recovery_test', OperationPhase.TOOL_INVOCATION)
        .withExecutionState(ProcessingStage.TOOL_EXECUTION)
        .build();

      let failureCount = 0;
      const intermittentFailure = async () => {
        failureCount++;
        if (failureCount <= 2) {
          throw new MCPConnectionError('Temporary connection issue', {
            operation: 'execute',
            serverName: 'test-server',
            recoveryActions: [RecoveryAction.RETRY_WITH_BACKOFF]
          });
        }
        return 'Recovery successful';
      };

      // Act
      const result = await toolBoundary.execute(intermittentFailure, context);

      // Assert
      expect(result.success).toBe(true);
      expect(result.result).toBe('Recovery successful');
      expect(failureCount).toBe(3);
      expect(monitoringOrchestrator.recordRecovery).toHaveBeenCalled();
    });

    it('should maintain service during partial failures', async () => {
      // Arrange - Test that unrelated operations continue working
      const healthyContext = ErrorContextBuilder.create()
        .withSeverity(ErrorSeverity.LOW)
        .withOperation('healthy_operation', OperationPhase.TOOL_INVOCATION)
        .withExecutionState(ProcessingStage.TOOL_EXECUTION)
        .build();

      const failedContext = ErrorContextBuilder.create()
        .withSeverity(ErrorSeverity.HIGH)
        .withOperation('failed_operation', OperationPhase.TOOL_INVOCATION)
        .withExecutionState(ProcessingStage.TOOL_EXECUTION)
        .build();

      const healthyOperation = async () => 'healthy_result';
      const failedOperation = async () => {
        throw new MCPToolError('Specific tool failure', {
          toolName: 'failing_tool',
          operation: 'execute',
          recoveryActions: [RecoveryAction.ISOLATE_COMPONENT]
        });
      };

      // Create separate boundary for failing operation
      const failingBoundary = new ToolExecutionBoundary();

      // Act
      const failedResult = await failingBoundary.execute(failedOperation, failedContext);
      const healthyResult = await toolBoundary.execute(healthyOperation, healthyContext);

      // Assert
      expect(failedResult.success).toBe(false);
      expect(healthyResult.success).toBe(true);
      expect(healthyResult.result).toBe('healthy_result');
      expect(failingBoundary.getState()).toBe(BoundaryState.DEGRADED);
      expect(toolBoundary.getState()).toBe(BoundaryState.HEALTHY);
    });
  });

  describe('Performance and Monitoring Integration', () => {
    it('should track performance metrics during error conditions', async () => {
      // Arrange
      const context = ErrorContextBuilder.create()
        .withSeverity(ErrorSeverity.MEDIUM)
        .withOperation('performance_test', OperationPhase.TOOL_INVOCATION)
        .withExecutionState(ProcessingStage.TOOL_EXECUTION)
        .build();

      const slowOperation = async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
        throw new MCPToolError('Slow operation failed', {
          toolName: 'slow_tool',
          operation: 'execute',
          recoveryActions: [RecoveryAction.USE_FALLBACK]
        });
      };

      const fastFallback = async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
        return 'fast_fallback_result';
      };

      // Act
      const startTime = Date.now();
      const result = await toolBoundary.execute(slowOperation, context, fastFallback);
      const duration = Date.now() - startTime;

      // Assert
      expect(result.fallbackUsed).toBe(true);
      expect(result.result).toBe('fast_fallback_result');
      expect(duration).toBeGreaterThan(200); // Should include slow operation time
      expect(monitoringOrchestrator.recordPerformanceMetric).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'performance_test',
          duration: expect.any(Number),
          success: false
        })
      );
    });

    it('should maintain monitoring during high error rates', async () => {
      // Arrange
      const contexts = Array.from({ length: 10 }, (_, i) =>
        ErrorContextBuilder.create()
          .withSeverity(ErrorSeverity.MEDIUM)
          .withOperation(`concurrent_test_${i}`, OperationPhase.TOOL_INVOCATION)
          .withExecutionState(ProcessingStage.TOOL_EXECUTION)
          .build()
      );

      const concurrentFailures = contexts.map(context => async () => {
        throw new MCPToolError('Concurrent failure', {
          toolName: 'concurrent_tool',
          operation: 'execute',
          recoveryActions: [RecoveryAction.RETRY_WITH_BACKOFF]
        });
      });

      // Act
      const results = await Promise.all(
        concurrentFailures.map((operation, i) =>
          toolBoundary.execute(operation, contexts[i])
        )
      );

      // Assert
      expect(results.every(r => !r.success)).toBe(true);
      expect(monitoringOrchestrator.recordError).toHaveBeenCalledTimes(10);
      expect(toolBoundary.getState()).toBe(BoundaryState.ISOLATED);
    });
  });

  describe('End-to-End Error Flow Validation', () => {
    it('should handle complete request lifecycle with multiple failure points', async () => {
      // Arrange - Simulate a complete user request with multiple potential failure points
      const userContext = ErrorContextBuilder.create()
        .withSeverity(ErrorSeverity.MEDIUM)
        .withOperation('complete_request', OperationPhase.REQUEST_PROCESSING)
        .withExecutionState(ProcessingStage.SLACK_PROCESSING)
        .withUserContext('U123456789', 'C123456789', 'T123456789')
        .withConversationMetadata('e2e-test', 'thread-456', 'run deployment pipeline')
        .build();

      // Mock a complex operation that could fail at multiple points
      const complexOperation = async () => {
        // Step 1: Slack message parsing (succeeds)
        await new Promise(resolve => setTimeout(resolve, 10));
        
        // Step 2: AI processing (fails)
        throw new AIProcessingError('AI temporarily unavailable', {
          model: 'claude-3-5-sonnet',
          operation: 'intent_analysis',
          statusCode: 503,
          recoveryActions: [RecoveryAction.USE_FALLBACK]
        });
      };

      const fallbackFlow = async () => {
        // Fallback AI with simpler processing
        await new Promise(resolve => setTimeout(resolve, 50));
        
        // Step 3: MCP tool execution (succeeds with fallback AI result)
        return JSON.stringify({
          intent: 'deployment_request',
          confidence: 0.7,
          action: 'trigger_pipeline',
          parameters: { environment: 'staging' },
          fallback_used: true
        });
      };

      // Act
      const result = await aiBoundary.execute(complexOperation, userContext, fallbackFlow);

      // Assert
      expect(result.fallbackUsed).toBe(true);
      expect(result.success).toBe(true);
      const parsedResult = JSON.parse(result.result as string);
      expect(parsedResult.intent).toBe('deployment_request');
      expect(parsedResult.fallback_used).toBe(true);
      expect(result.preservedStateId).toBeDefined();
      
      // Verify monitoring captured the complete flow
      expect(monitoringOrchestrator.recordError).toHaveBeenCalledWith(
        expect.any(AIProcessingError),
        expect.objectContaining({
          operation: 'complete_request'
        })
      );
      expect(monitoringOrchestrator.updateUserExperience).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'U123456789',
          threadId: 'T123456789'
        })
      );
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });
});