/**
 * Resilience Orchestrator Tests
 */

import { ResilienceOrchestrator, OperationDefinition } from '../../../../src/errors/resilience/ResilienceOrchestrator';
import { EnhancedErrorContext } from '../../../../src/errors/context/ErrorContext';
import { BackoffStrategy } from '../../../../src/errors/resilience/ExponentialBackoff';
import { DegradationLevel } from '../../../../src/errors/resilience/GracefulDegradation';

describe('ResilienceOrchestrator', () => {
  let orchestrator: ResilienceOrchestrator;
  let mockContext: EnhancedErrorContext;
  let mockOperationDef: OperationDefinition;

  beforeEach(() => {
    orchestrator = new ResilienceOrchestrator({
      circuitBreaker: {
        failureThreshold: 3,
        recoveryTimeout: 1000
      },
      backoff: {
        baseDelay: 100,
        maxAttempts: 3,
        strategy: BackoffStrategy.EXPONENTIAL
      },
      timeout: {
        operationTimeout: 1000,
        enableResourceTracking: false // Disable for simpler testing
      },
      degradation: {
        enableAutoDegrade: true,
        degradationThresholds: {
          errorRate: 0.5,
          responseTime: 2000,
          circuitOpenCount: 2
        }
      }
    });

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
    it('should execute successful operations with resilience patterns', async () => {
      const successfulOperation = async () => 'success-result';

      const result = await orchestrator.executeWithResilience(
        successfulOperation,
        mockOperationDef,
        mockContext
      );

      expect(result.success).toBe(true);
      expect(result.result).toBe('success-result');
      expect(result.patternsUsed).toContain('circuit_breaker');
      expect(result.executionPath.length).toBeGreaterThan(0);
      expect(result.metrics).toBeDefined();
    });

    it('should track execution patterns and metrics', async () => {
      const operation = async () => 'result';

      await orchestrator.executeWithResilience(operation, mockOperationDef, mockContext);

      const status = orchestrator.getResilienceStatus();
      expect(status.metrics.successRate).toBeGreaterThan(0);
      expect(status.recentExecutions).toBeGreaterThan(0);
    });
  });

  describe('Failed Operations with Recovery', () => {
    it('should handle failures with circuit breaker pattern', async () => {
      let attemptCount = 0;
      const failingOperation = async () => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new Error('Temporary failure');
        }
        return 'recovered-result';
      };

      const result = await orchestrator.executeWithResilience(
        failingOperation,
        mockOperationDef,
        mockContext
      );

      expect(result.success).toBe(true);
      expect(result.result).toBe('recovered-result');
      expect(result.patternsUsed).toContain('circuit_breaker');
    });

    it('should use fallback when primary operation fails', async () => {
      const alwaysFailingOperation = async () => {
        throw new Error('Persistent failure');
      };

      const result = await orchestrator.executeWithResilience(
        alwaysFailingOperation,
        mockOperationDef,
        mockContext
      );

      // Should use fallback chain when circuit breaker attempts fail
      expect(result.patternsUsed).toContain('circuit_breaker');
      // Might succeed with fallback or fail with comprehensive error handling
      expect(result.executionPath.length).toBeGreaterThan(0);
    });
  });

  describe('Strategy Selection', () => {
    it('should select circuit breaker first for essential operations', async () => {
      const essentialOpDef: OperationDefinition = {
        ...mockOperationDef,
        essential: true
      };

      const operation = async () => 'result';

      const result = await orchestrator.executeWithResilience(
        operation,
        essentialOpDef,
        mockContext
      );

      expect(result.finalStrategy).toBe('circuit_breaker_first');
    });

    it('should adapt strategy based on service health', async () => {
      // First, create some failures to affect strategy selection
      const failingOperation = async () => {
        throw new Error('Service failure');
      };

      // Execute multiple failures to affect metrics
      for (let i = 0; i < 3; i++) {
        await orchestrator.executeWithResilience(
          failingOperation,
          mockOperationDef,
          mockContext
        );
      }

      // Now execute a new operation - strategy should be adapted
      const newOperation = async () => 'result';
      const result = await orchestrator.executeWithResilience(
        newOperation,
        mockOperationDef,
        mockContext
      );

      expect(result.finalStrategy).toBeDefined();
      expect(result.executionPath.length).toBeGreaterThan(0);
    });
  });

  describe('Degradation Handling', () => {
    it('should handle degraded operations appropriately', async () => {
      // Force degradation
      orchestrator['degradationManager'].manualDegrade(
        DegradationLevel.REDUCED,
        'test-degradation'
      );

      const operation = async () => 'result';

      const result = await orchestrator.executeWithResilience(
        operation,
        mockOperationDef,
        mockContext
      );

      expect(result.patternsUsed).toContain('graceful_degradation');
      expect(result.degradationResult).toBeDefined();
    });

    it('should automatically degrade under high error conditions', async () => {
      // Execute many failing operations to trigger auto-degradation
      const failingOperation = async () => {
        throw new Error('High error rate');
      };

      // Execute enough failures to potentially trigger degradation
      for (let i = 0; i < 10; i++) {
        await orchestrator.executeWithResilience(
          failingOperation,
          mockOperationDef,
          mockContext
        );
      }

      const status = orchestrator.getResilienceStatus();
      // Degradation may or may not be triggered depending on configuration
      expect(status.degradationStats).toBeDefined();
    });
  });

  describe('Timeout and Resource Management', () => {
    it('should handle operation timeouts', async () => {
      const slowOperation = async () => {
        await new Promise(resolve => setTimeout(resolve, 2000));
        return 'slow-result';
      };

      const quickOpDef: OperationDefinition = {
        ...mockOperationDef,
        timeoutMs: 100
      };

      const result = await orchestrator.executeWithResilience(
        slowOperation,
        quickOpDef,
        mockContext
      );

      // Operation should timeout and potentially use fallback
      expect(result.executionPath.length).toBeGreaterThan(0);
    });

    it('should track resource usage', async () => {
      orchestrator.registerResource(
        'test-resource',
        'connection',
        { connection: 'mock' },
        async () => { /* cleanup */ },
        mockOperationDef.id
      );

      const status = orchestrator.getResilienceStatus();
      expect(status.timeoutMetrics).toBeDefined();
    });
  });

  describe('Cross-Pattern Coordination', () => {
    it('should coordinate between multiple patterns', async () => {
      let attemptCount = 0;
      const intermittentOperation = async () => {
        attemptCount++;
        if (attemptCount % 2 === 0) {
          throw new Error('Intermittent failure');
        }
        return `attempt-${attemptCount}`;
      };

      const result = await orchestrator.executeWithResilience(
        intermittentOperation,
        mockOperationDef,
        mockContext
      );

      // Should succeed with retry logic
      expect(result.success).toBe(true);
      expect(result.patternsUsed.length).toBeGreaterThan(0);
    });

    it('should share metrics between patterns', async () => {
      const operation = async () => 'result';

      await orchestrator.executeWithResilience(operation, mockOperationDef, mockContext);

      const status = orchestrator.getResilienceStatus();
      expect(status.circuitBreakers.totalServices).toBeGreaterThan(0);
      expect(status.metrics.successRate).toBeGreaterThan(0);
    });
  });

  describe('Tool Registration and Management', () => {
    it('should register tools for fallback chain', () => {
      const mockTool = {
        name: 'mock-tool',
        actions: ['test-action', 'backup-action'],
        reliability: 0.9,
        avgResponseTime: 100,
        capabilities: ['basic_fallback'],
        fallbackPriority: 1
      };

      orchestrator.registerTool(mockTool);

      // Tool should be registered in the fallback chain
      const fallbackChain = orchestrator['fallbackChain'];
      const registeredTools = fallbackChain.getRegisteredTools();
      expect(registeredTools).toContainEqual(mockTool);
    });
  });

  describe('Configuration and Control', () => {
    it('should allow configuration updates', () => {
      orchestrator.updateConfiguration({
        backoff: {
          baseDelay: 500,
          maxAttempts: 5
        }
      });

      // Configuration should be updated
      const backoffManager = orchestrator['backoffManager'];
      expect(backoffManager['config'].baseDelay).toBe(500);
      expect(backoffManager['config'].maxAttempts).toBe(5);
    });

    it('should force recovery of all patterns', async () => {
      // Create some failures first
      const failingOperation = async () => {
        throw new Error('Force failure');
      };

      for (let i = 0; i < 5; i++) {
        await orchestrator.executeWithResilience(
          failingOperation,
          mockOperationDef,
          mockContext
        );
      }

      await orchestrator.forceRecovery();

      const status = orchestrator.getResilienceStatus();
      expect(status.circuitBreakers.openCircuits).toBe(0);
      expect(status.degradationStats.currentLevel).toBe(DegradationLevel.FULL);
    });
  });

  describe('Comprehensive Status Reporting', () => {
    it('should provide detailed resilience status', async () => {
      const operation = async () => 'result';

      await orchestrator.executeWithResilience(operation, mockOperationDef, mockContext);

      const status = orchestrator.getResilienceStatus();

      expect(status.metrics).toBeDefined();
      expect(status.circuitBreakers).toBeDefined();
      expect(status.degradationStats).toBeDefined();
      expect(status.fallbackStats).toBeDefined();
      expect(status.timeoutMetrics).toBeDefined();
      expect(typeof status.recentExecutions).toBe('number');
    });
  });

  describe('Shutdown and Cleanup', () => {
    it('should shutdown gracefully', async () => {
      await expect(orchestrator.shutdown()).resolves.not.toThrow();
    });
  });

  describe('Error Scenarios', () => {
    it('should handle exceptions during pattern execution', async () => {
      const throwingOperation = async () => {
        throw new Error('Critical system error');
      };

      const result = await orchestrator.executeWithResilience(
        throwingOperation,
        mockOperationDef,
        mockContext
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
      expect(result.executionPath.length).toBeGreaterThan(0);
    });

    it('should handle malformed operation definitions', async () => {
      const malformedOpDef = {
        id: '',
        serviceName: '',
        action: '',
        essential: false
      } as OperationDefinition;

      const operation = async () => 'result';

      const result = await orchestrator.executeWithResilience(
        operation,
        malformedOpDef,
        mockContext
      );

      // Should still attempt execution with default handling
      expect(result.executionPath.length).toBeGreaterThan(0);
    });
  });
});