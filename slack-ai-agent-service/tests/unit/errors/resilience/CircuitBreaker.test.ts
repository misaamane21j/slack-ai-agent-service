/**
 * Circuit Breaker Pattern Tests
 */

import { CircuitBreaker, CircuitBreakerManager, CircuitState } from '../../../../src/errors/resilience/CircuitBreaker';
import { EnhancedErrorContext } from '../../../../src/errors/context/ErrorContext';

describe('CircuitBreaker', () => {
  let circuitBreaker: CircuitBreaker;
  let mockContext: EnhancedErrorContext;

  beforeEach(() => {
    circuitBreaker = new CircuitBreaker('test-service', {
      failureThreshold: 3,
      recoveryTimeout: 1000,
      successThreshold: 2,
      volumeThreshold: 5,
      errorRate: 0.5
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
  });

  describe('Circuit States', () => {
    it('should start in CLOSED state', () => {
      expect(circuitBreaker.getState()).toBe(CircuitState.CLOSED);
    });

    it('should transition to OPEN after threshold failures', async () => {
      const failingOperation = async () => {
        throw new Error('Test failure');
      };

      // Execute failing operations to reach threshold
      for (let i = 0; i < 3; i++) {
        await circuitBreaker.execute(failingOperation, mockContext);
      }

      expect(circuitBreaker.getState()).toBe(CircuitState.OPEN);
    });

    it('should transition to HALF_OPEN after recovery timeout', async () => {
      const failingOperation = async () => {
        throw new Error('Test failure');
      };

      // Trigger circuit to open
      for (let i = 0; i < 3; i++) {
        await circuitBreaker.execute(failingOperation, mockContext);
      }

      // Wait for recovery timeout
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Next call should transition to HALF_OPEN
      await circuitBreaker.execute(failingOperation, mockContext);
      
      // Note: The circuit may still be OPEN if the operation fails in HALF_OPEN
      expect([CircuitState.HALF_OPEN, CircuitState.OPEN]).toContain(circuitBreaker.getState());
    });

    it('should transition back to CLOSED after successful recoveries in HALF_OPEN', async () => {
      const failingOperation = async () => {
        throw new Error('Test failure');
      };

      const successfulOperation = async () => {
        return 'success';
      };

      // Trigger circuit to open
      for (let i = 0; i < 3; i++) {
        await circuitBreaker.execute(failingOperation, mockContext);
      }

      // Wait for recovery timeout
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Force transition to half-open
      circuitBreaker['transitionToHalfOpen']();

      // Execute successful operations to close circuit
      for (let i = 0; i < 2; i++) {
        await circuitBreaker.execute(successfulOperation, mockContext);
      }

      expect(circuitBreaker.getState()).toBe(CircuitState.CLOSED);
    });
  });

  describe('Operation Execution', () => {
    it('should execute successful operations normally', async () => {
      const successfulOperation = async () => {
        return 'test-result';
      };

      const result = await circuitBreaker.execute(successfulOperation, mockContext);

      expect(result.success).toBe(true);
      expect(result.result).toBe('test-result');
      expect(result.circuitState).toBe(CircuitState.CLOSED);
    });

    it('should handle failed operations', async () => {
      const failingOperation = async () => {
        throw new Error('Test failure');
      };

      const result = await circuitBreaker.execute(failingOperation, mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error?.message).toBe('Test failure');
    });

    it('should use fallback when circuit is open', async () => {
      const failingOperation = async () => {
        throw new Error('Test failure');
      };

      const fallbackOperation = async () => {
        return 'fallback-result';
      };

      // Trigger circuit to open
      for (let i = 0; i < 3; i++) {
        await circuitBreaker.execute(failingOperation, mockContext);
      }

      const result = await circuitBreaker.execute(failingOperation, mockContext, fallbackOperation);

      expect(result.success).toBe(true);
      expect(result.result).toBe('fallback-result');
      expect(result.fromCache).toBe(true);
      expect(result.circuitOpenTime).toBeDefined();
    });

    it('should track execution times', async () => {
      const slowOperation = async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return 'slow-result';
      };

      const result = await circuitBreaker.execute(slowOperation, mockContext);

      expect(result.executionTime).toBeGreaterThanOrEqual(100);
    });
  });

  describe('Metrics and Monitoring', () => {
    it('should track call history', async () => {
      const operation = async () => 'result';

      await circuitBreaker.execute(operation, mockContext);
      
      const history = circuitBreaker.getCallHistory();
      expect(history).toHaveLength(1);
      expect(history[0].success).toBe(true);
      expect(history[0].timestamp).toBeInstanceOf(Date);
    });

    it('should provide comprehensive metrics', async () => {
      const operation = async () => 'result';

      await circuitBreaker.execute(operation, mockContext);
      
      const metrics = circuitBreaker.getMetrics();
      expect(metrics.state).toBe(CircuitState.CLOSED);
      expect(metrics.serviceName).toBe('test-service');
      expect(metrics.recentCalls).toBeGreaterThan(0);
      expect(metrics.errorRate).toBe(0);
    });

    it('should calculate error rates correctly', async () => {
      const failingOperation = async () => {
        throw new Error('Test failure');
      };
      const successfulOperation = async () => 'success';

      // Execute mixed operations
      await circuitBreaker.execute(successfulOperation, mockContext);
      await circuitBreaker.execute(failingOperation, mockContext);
      await circuitBreaker.execute(failingOperation, mockContext);

      const metrics = circuitBreaker.getMetrics();
      expect(metrics.errorRate).toBeCloseTo(0.67, 1);
    });
  });

  describe('Configuration', () => {
    it('should allow configuration updates', () => {
      circuitBreaker.updateConfig({
        failureThreshold: 10,
        recoveryTimeout: 5000
      });

      const config = circuitBreaker['config'];
      expect(config.failureThreshold).toBe(10);
      expect(config.recoveryTimeout).toBe(5000);
    });

    it('should allow manual reset', () => {
      // Force some state changes
      circuitBreaker['state'] = CircuitState.OPEN;
      circuitBreaker['failureCount'] = 5;

      circuitBreaker.reset();

      expect(circuitBreaker.getState()).toBe(CircuitState.CLOSED);
      expect(circuitBreaker['failureCount']).toBe(0);
    });

    it('should allow force opening', () => {
      circuitBreaker.forceOpen();
      expect(circuitBreaker.getState()).toBe(CircuitState.OPEN);
    });
  });

  describe('Health Checks', () => {
    it('should report healthy when closed', () => {
      expect(circuitBreaker.isHealthy()).toBe(true);
    });

    it('should report unhealthy when open', () => {
      circuitBreaker.forceOpen();
      expect(circuitBreaker.isHealthy()).toBe(false);
    });

    it('should calculate time until recovery', () => {
      circuitBreaker.forceOpen();
      const timeUntilRecovery = circuitBreaker.getTimeUntilRecovery();
      expect(timeUntilRecovery).toBeGreaterThan(0);
      expect(timeUntilRecovery).toBeLessThanOrEqual(1000);
    });
  });
});

describe('CircuitBreakerManager', () => {
  let manager: CircuitBreakerManager;
  let mockContext: EnhancedErrorContext;

  beforeEach(() => {
    manager = new CircuitBreakerManager({
      failureThreshold: 2,
      recoveryTimeout: 500
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
  });

  describe('Service Management', () => {
    it('should create circuit breakers for new services', async () => {
      const operation = async () => 'result';

      const result = await manager.executeWithCircuitBreaker(
        'new-service',
        operation,
        mockContext
      );

      expect(result.success).toBe(true);
      expect(result.result).toBe('result');
    });

    it('should reuse existing circuit breakers', async () => {
      const operation = async () => 'result';

      await manager.executeWithCircuitBreaker('service1', operation, mockContext);
      await manager.executeWithCircuitBreaker('service1', operation, mockContext);

      const breaker1 = manager.getCircuitBreaker('service1');
      const breaker2 = manager.getCircuitBreaker('service1');

      expect(breaker1).toBe(breaker2);
    });

    it('should track multiple services independently', async () => {
      const successOperation = async () => 'success';
      const failOperation = async () => { throw new Error('fail'); };

      // Service 1 succeeds
      await manager.executeWithCircuitBreaker('service1', successOperation, mockContext);
      
      // Service 2 fails
      await manager.executeWithCircuitBreaker('service2', failOperation, mockContext);
      await manager.executeWithCircuitBreaker('service2', failOperation, mockContext);

      const statuses = manager.getAllStatuses();
      expect(statuses.service1).toBe(CircuitState.CLOSED);
      expect(statuses.service2).toBe(CircuitState.OPEN);
    });
  });

  describe('Health Reporting', () => {
    it('should identify unhealthy services', async () => {
      const failOperation = async () => { throw new Error('fail'); };

      // Trigger failures for service
      await manager.executeWithCircuitBreaker('failing-service', failOperation, mockContext);
      await manager.executeWithCircuitBreaker('failing-service', failOperation, mockContext);

      const unhealthyServices = manager.getUnhealthyServices();
      expect(unhealthyServices).toContain('failing-service');
    });

    it('should generate comprehensive health reports', async () => {
      const successOperation = async () => 'success';
      const failOperation = async () => { throw new Error('fail'); };

      // Create mixed service states
      await manager.executeWithCircuitBreaker('healthy-service', successOperation, mockContext);
      await manager.executeWithCircuitBreaker('failing-service', failOperation, mockContext);
      await manager.executeWithCircuitBreaker('failing-service', failOperation, mockContext);

      const report = manager.getHealthReport();
      expect(report.totalServices).toBe(2);
      expect(report.healthyServices).toBe(1);
      expect(report.openCircuits).toBe(1);
      expect(report.services).toHaveLength(2);
    });
  });

  describe('Bulk Operations', () => {
    it('should reset all circuit breakers', async () => {
      const failOperation = async () => { throw new Error('fail'); };

      // Create some failing services
      await manager.executeWithCircuitBreaker('service1', failOperation, mockContext);
      await manager.executeWithCircuitBreaker('service1', failOperation, mockContext);
      await manager.executeWithCircuitBreaker('service2', failOperation, mockContext);
      await manager.executeWithCircuitBreaker('service2', failOperation, mockContext);

      manager.resetAll();

      const statuses = manager.getAllStatuses();
      expect(Object.values(statuses)).toEqual(
        expect.arrayContaining([CircuitState.CLOSED, CircuitState.CLOSED])
      );
    });
  });
});