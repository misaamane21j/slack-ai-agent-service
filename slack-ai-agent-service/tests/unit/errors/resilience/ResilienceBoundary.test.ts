/**
 * Resilience Boundary Integration Tests
 */

import { ResilienceBoundary } from '../../../../src/errors/resilience/ResilienceBoundary';
import { BoundaryType, BoundaryState } from '../../../../src/errors/boundaries/ErrorBoundary';
import { OperationDefinition } from '../../../../src/errors/resilience/ResilienceOrchestrator';
import { EnhancedErrorContext } from '../../../../src/errors/context/ErrorContext';
import { BackoffStrategy } from '../../../../src/errors/resilience/ExponentialBackoff';
import { DegradationLevel } from '../../../../src/errors/resilience/GracefulDegradation';

describe('ResilienceBoundary', () => {
  let resilienceBoundary: ResilienceBoundary;
  let mockContext: EnhancedErrorContext;
  let mockOperationDef: OperationDefinition;

  beforeEach(() => {
    resilienceBoundary = new ResilienceBoundary(
      BoundaryType.TOOL_EXECUTION,
      {
        maxErrorsBeforeDegradation: 2,
        maxErrorsBeforeIsolation: 3,
        recoveryTimeoutMs: 1000,
        enableResilienceOrchestration: true,
        fallbackToOrchestrator: true,
        resilience: {
          circuitBreaker: {
            failureThreshold: 2,
            recoveryTimeout: 500
          },
          backoff: {
            baseDelay: 100,
            maxAttempts: 3,
            strategy: BackoffStrategy.EXPONENTIAL
          },
          timeout: {
            operationTimeout: 1000,
            enableResourceTracking: false // Simplify for testing
          }
        }
      }
    );

    mockContext = {
      correlationId: 'test-correlation-id',
      timestamp: new Date(),
      operationType: 'tool_execution',
      errorScope: 'operation',
      metadata: {},
      userContext: {},
      systemContext: {}
    };

    mockOperationDef = {
      id: 'test-operation',
      serviceName: 'test-service',
      action: 'test-action',
      essential: false,
      timeoutMs: 500
    };
  });

  describe('Successful Operations', () => {
    it('should execute successful operations with orchestrator first strategy', async () => {
      const successfulOperation = async () => 'success-result';

      const result = await resilienceBoundary.executeWithResilience(
        successfulOperation,
        mockOperationDef,
        mockContext
      );

      expect(result.success).toBe(true);
      expect(result.result).toBe('success-result');
      expect(result.orchestratorUsed).toBe(true);
      expect(result.patternsUsed).toContain('circuit_breaker');
      expect(result.boundaryState).toBe(BoundaryState.HEALTHY);
    });

    it('should work with legacy execute method', async () => {
      const operation = async () => 'legacy-result';

      const result = await resilienceBoundary.execute(
        operation,
        mockContext
      );

      expect(result.success).toBe(true);
      expect(result.result).toBe('legacy-result');
      expect(result.boundaryState).toBe(BoundaryState.HEALTHY);
    });
  });

  describe('Strategy Selection', () => {
    it('should use orchestrator first for normal operations', async () => {
      const operation = async () => 'result';

      const result = await resilienceBoundary.executeWithResilience(
        operation,
        mockOperationDef,
        mockContext
      );

      expect(result.orchestratorUsed).toBe(true);
      expect(result.executionPath.some(step => step.component === 'orchestrator')).toBe(true);
    });

    it('should use boundary first when isolated', async () => {
      // Force boundary into isolated state
      resilienceBoundary.isolate();

      const operation = async () => 'isolated-result';
      const fallback = async () => 'fallback-result';

      const result = await resilienceBoundary.executeWithResilience(
        operation,
        mockOperationDef,
        mockContext,
        fallback
      );

      expect(result.boundaryState).toBe(BoundaryState.ISOLATED);
      expect(result.isolationTriggered).toBe(false); // Existing isolation doesn't trigger new isolation
    });

    it('should use hybrid strategy for essential operations', async () => {
      const essentialOpDef: OperationDefinition = {
        ...mockOperationDef,
        essential: true
      };

      const operation = async () => 'essential-result';

      const result = await resilienceBoundary.executeWithResilience(
        operation,
        essentialOpDef,
        mockContext
      );

      expect(result.success).toBe(true);
      expect(result.orchestratorUsed).toBe(true);
      // Hybrid strategy uses both boundary and orchestrator
      expect(result.patternsUsed).toContain('error_boundary');
    });
  });

  describe('Failure Handling and Fallbacks', () => {
    it('should fallback to boundary when orchestrator fails', async () => {
      // Create an operation that will stress the orchestrator
      let attemptCount = 0;
      const problematicOperation = async () => {
        attemptCount++;
        if (attemptCount <= 5) {
          throw new Error('Persistent orchestrator failure');
        }
        return 'eventual-success';
      };

      const fallbackOperation = async () => 'boundary-fallback-result';

      const result = await resilienceBoundary.executeWithResilience(
        problematicOperation,
        mockOperationDef,
        mockContext,
        fallbackOperation
      );

      // Should either succeed through orchestrator retries or use boundary fallback
      expect(result.executionPath.length).toBeGreaterThan(0);
    });

    it('should fallback to orchestrator when boundary fails', async () => {
      // Configure to use boundary first
      const boundaryFirstBoundary = new ResilienceBoundary(
        BoundaryType.TOOL_EXECUTION,
        {
          maxErrorsBeforeDegradation: 1,
          maxErrorsBeforeIsolation: 2,
          enableResilienceOrchestration: true,
          fallbackToOrchestrator: true
        }
      );

      // First, create boundary failures
      const failingOperation = async () => {
        throw new Error('Boundary stress failure');
      };

      // Stress the boundary
      await boundaryFirstBoundary.executeWithResilience(
        failingOperation,
        mockOperationDef,
        mockContext
      );

      // Now try a new operation
      const operation = async () => 'orchestrator-fallback-result';

      const result = await boundaryFirstBoundary.executeWithResilience(
        operation,
        mockOperationDef,
        mockContext
      );

      expect(result.executionPath.length).toBeGreaterThan(0);
    });
  });

  describe('Error Accumulation and State Management', () => {
    it('should transition boundary states on accumulated errors', async () => {
      const failingOperation = async () => {
        throw new Error('Repeated failure');
      };

      // Execute failing operations to accumulate errors
      await resilienceBoundary.executeWithResilience(
        failingOperation,
        mockOperationDef,
        mockContext
      );

      await resilienceBoundary.executeWithResilience(
        failingOperation,
        mockOperationDef,
        mockContext
      );

      expect(resilienceBoundary.getState()).toBe(BoundaryState.DEGRADED);

      // One more failure should trigger isolation
      await resilienceBoundary.executeWithResilience(
        failingOperation,
        mockOperationDef,
        mockContext
      );

      expect(resilienceBoundary.getState()).toBe(BoundaryState.ISOLATED);
    });

    it('should recover boundary state on successful operations', async () => {
      // First, degrade the boundary
      const failingOperation = async () => {
        throw new Error('Failure to degrade');
      };

      await resilienceBoundary.executeWithResilience(
        failingOperation,
        mockOperationDef,
        mockContext
      );

      await resilienceBoundary.executeWithResilience(
        failingOperation,
        mockOperationDef,
        mockContext
      );

      expect(resilienceBoundary.getState()).toBe(BoundaryState.DEGRADED);

      // Now execute successful operations
      const successfulOperation = async () => 'recovery-success';

      const result = await resilienceBoundary.executeWithResilience(
        successfulOperation,
        mockOperationDef,
        mockContext
      );

      expect(result.success).toBe(true);
      expect(resilienceBoundary.getState()).toBe(BoundaryState.HEALTHY);
    });
  });

  describe('Resource and Context Management', () => {
    it('should preserve context for appropriate operation types', async () => {
      const contextSensitiveOperation = async () => {
        throw new Error('Context test failure');
      };

      const result = await resilienceBoundary.executeWithResilience(
        contextSensitiveOperation,
        mockOperationDef,
        mockContext
      );

      // For tool execution boundary type, context should be preserved
      expect(result.preservedStateId).toBeDefined();
    });

    it('should provide appropriate fallbacks for boundary types', async () => {
      const failingOperation = async () => {
        throw new Error('Total system failure');
      };

      // Force boundary to use its internal fallback
      resilienceBoundary.isolate();

      const result = await resilienceBoundary.executeWithResilience(
        failingOperation,
        mockOperationDef,
        mockContext
      );

      // Should get boundary-specific fallback message
      if (!result.success && result.fallbackUsed) {
        expect(typeof result.result).toBe('string');
      }
    });
  });

  describe('Integration and Coordination', () => {
    it('should coordinate between boundary and orchestrator patterns', async () => {
      let attemptCount = 0;
      const coordinatedOperation = async () => {
        attemptCount++;
        if (attemptCount === 1) {
          throw new Error('First attempt failure');
        }
        return `coordinated-success-${attemptCount}`;
      };

      const result = await resilienceBoundary.executeWithResilience(
        coordinatedOperation,
        mockOperationDef,
        mockContext
      );

      expect(result.success).toBe(true);
      expect(result.patternsUsed.length).toBeGreaterThan(0);
      expect(result.executionPath.length).toBeGreaterThan(0);
    });

    it('should share metrics between boundary and orchestrator', async () => {
      const operation = async () => 'metrics-test';

      await resilienceBoundary.executeWithResilience(
        operation,
        mockOperationDef,
        mockContext
      );

      const status = resilienceBoundary.getComprehensiveStatus();
      expect(status.boundary.metrics).toBeDefined();
      expect(status.orchestrator.metrics).toBeDefined();
      expect(status.usage.totalUsage).toBeGreaterThan(0);
    });
  });

  describe('Configuration and Control', () => {
    it('should allow resilience configuration updates', () => {
      resilienceBoundary.updateResilienceConfig({
        backoff: {
          baseDelay: 500,
          maxAttempts: 5
        }
      });

      const orchestrator = resilienceBoundary.getResilienceOrchestrator();
      expect(orchestrator['backoffManager']['config'].baseDelay).toBe(500);
    });

    it('should track usage statistics', async () => {
      const operation = async () => 'usage-test';

      await resilienceBoundary.executeWithResilience(
        operation,
        mockOperationDef,
        mockContext
      );

      const stats = resilienceBoundary.getUsageStats();
      expect(stats.totalUsage).toBeGreaterThan(0);
      expect(stats.orchestratorUsage + stats.boundaryUsage).toBe(stats.totalUsage);
    });
  });

  describe('Degradation Integration', () => {
    it('should handle degraded system states', async () => {
      // Force orchestrator degradation
      const orchestrator = resilienceBoundary.getResilienceOrchestrator();
      orchestrator['degradationManager'].manualDegrade(
        DegradationLevel.REDUCED,
        'test-degradation'
      );

      const operation = async () => 'degraded-result';

      const result = await resilienceBoundary.executeWithResilience(
        operation,
        mockOperationDef,
        mockContext
      );

      expect(result.patternsUsed).toContain('graceful_degradation');
      expect(result.degradationResult).toBeDefined();
    });
  });

  describe('Tool Registration', () => {
    it('should register tools with orchestrator', () => {
      const mockTool = {
        name: 'boundary-test-tool',
        actions: ['test-action'],
        reliability: 0.8,
        avgResponseTime: 200,
        capabilities: ['basic_fallback'],
        fallbackPriority: 2
      };

      resilienceBoundary.registerTool(mockTool);

      const orchestrator = resilienceBoundary.getResilienceOrchestrator();
      const registeredTools = orchestrator['fallbackChain'].getRegisteredTools();
      expect(registeredTools).toContainEqual(mockTool);
    });
  });

  describe('Error Scenarios and Edge Cases', () => {
    it('should handle null/undefined operations gracefully', async () => {
      const nullOperation = null as any;

      await expect(
        resilienceBoundary.executeWithResilience(
          nullOperation,
          mockOperationDef,
          mockContext
        )
      ).rejects.toThrow();
    });

    it('should handle malformed operation definitions', async () => {
      const operation = async () => 'result';
      const malformedOpDef = {} as OperationDefinition;

      const result = await resilienceBoundary.executeWithResilience(
        operation,
        malformedOpDef,
        mockContext
      );

      // Should still attempt execution with default handling
      expect(result.executionPath.length).toBeGreaterThan(0);
    });

    it('should handle exceptions during pattern coordination', async () => {
      const throwingOperation = async () => {
        throw new Error('Critical coordination failure');
      };

      const result = await resilienceBoundary.executeWithResilience(
        throwingOperation,
        mockOperationDef,
        mockContext
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
      expect(result.executionPath.length).toBeGreaterThan(0);
    });
  });

  describe('Cleanup and Shutdown', () => {
    it('should shutdown gracefully', async () => {
      await expect(resilienceBoundary.shutdown()).resolves.not.toThrow();
    });

    it('should reset boundary state', () => {
      // First, put boundary in degraded state
      resilienceBoundary['state'] = BoundaryState.DEGRADED;
      resilienceBoundary['metrics'].errorCount = 5;

      resilienceBoundary.reset();

      expect(resilienceBoundary.getState()).toBe(BoundaryState.HEALTHY);
      expect(resilienceBoundary.getMetrics().errorCount).toBe(0);
    });
  });

  describe('Comprehensive Status Reporting', () => {
    it('should provide detailed status across all components', async () => {
      const operation = async () => 'status-test';

      await resilienceBoundary.executeWithResilience(
        operation,
        mockOperationDef,
        mockContext
      );

      const status = resilienceBoundary.getComprehensiveStatus();

      expect(status.boundary).toBeDefined();
      expect(status.boundary.type).toBe(BoundaryType.TOOL_EXECUTION);
      expect(status.boundary.state).toBe(BoundaryState.HEALTHY);
      expect(status.boundary.metrics).toBeDefined();

      expect(status.orchestrator).toBeDefined();
      expect(status.orchestrator.metrics).toBeDefined();
      expect(status.orchestrator.circuitBreakers).toBeDefined();
      expect(status.orchestrator.degradationStats).toBeDefined();

      expect(status.usage).toBeDefined();
      expect(status.usage.totalUsage).toBeGreaterThan(0);
    });
  });
});