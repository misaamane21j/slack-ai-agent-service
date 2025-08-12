/**
 * Exponential Backoff Tests
 */

import { ExponentialBackoffManager, BackoffStrategy, JitterType } from '../../../../src/errors/resilience/ExponentialBackoff';
import { EnhancedErrorContext } from '../../../../src/errors/context/ErrorContext';

describe('ExponentialBackoffManager', () => {
  let backoffManager: ExponentialBackoffManager;
  let mockContext: EnhancedErrorContext;

  beforeEach(() => {
    backoffManager = new ExponentialBackoffManager({
      baseDelay: 100,
      maxDelay: 1000,
      maxAttempts: 3,
      multiplier: 2.0,
      jitterType: JitterType.NONE,
      strategy: BackoffStrategy.EXPONENTIAL
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

  describe('Successful Operations', () => {
    it('should execute successful operations immediately', async () => {
      const successfulOperation = async () => 'success';
      const startTime = Date.now();

      const result = await backoffManager.executeWithBackoff(
        'test-operation',
        successfulOperation,
        mockContext
      );

      const executionTime = Date.now() - startTime;

      expect(result.success).toBe(true);
      expect(result.result).toBe('success');
      expect(result.attempts).toBe(1);
      expect(result.actualDelays).toHaveLength(0);
      expect(executionTime).toBeLessThan(50); // Should be immediate
    });
  });

  describe('Failed Operations with Retry', () => {
    it('should retry failed operations with exponential backoff', async () => {
      let attemptCount = 0;
      const failingOperation = async () => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new Error('Temporary failure');
        }
        return 'success-after-retries';
      };

      const startTime = Date.now();
      const result = await backoffManager.executeWithBackoff(
        'retry-operation',
        failingOperation,
        mockContext
      );
      const executionTime = Date.now() - startTime;

      expect(result.success).toBe(true);
      expect(result.result).toBe('success-after-retries');
      expect(result.attempts).toBe(3);
      expect(result.actualDelays).toHaveLength(2);
      expect(result.actualDelays[0]).toBe(100); // First delay
      expect(result.actualDelays[1]).toBe(200); // Second delay (2x multiplier)
      expect(executionTime).toBeGreaterThanOrEqual(300); // At least sum of delays
    });

    it('should fail after max attempts exceeded', async () => {
      const alwaysFailingOperation = async () => {
        throw new Error('Persistent failure');
      };

      const result = await backoffManager.executeWithBackoff(
        'failing-operation',
        alwaysFailingOperation,
        mockContext
      );

      expect(result.success).toBe(false);
      expect(result.error?.message).toBe('Persistent failure');
      expect(result.attempts).toBe(3);
      expect(result.actualDelays).toHaveLength(2);
    });
  });

  describe('Backoff Strategies', () => {
    it('should implement exponential backoff strategy', async () => {
      backoffManager.updateConfig({
        strategy: BackoffStrategy.EXPONENTIAL,
        baseDelay: 100,
        multiplier: 2.0
      });

      let attempts = 0;
      const failingOperation = async () => {
        attempts++;
        throw new Error('Test failure');
      };

      const result = await backoffManager.executeWithBackoff(
        'exponential-test',
        failingOperation,
        mockContext
      );

      expect(result.actualDelays[0]).toBe(100); // Base delay
      expect(result.actualDelays[1]).toBe(200); // 100 * 2^1
    });

    it('should implement linear backoff strategy', async () => {
      backoffManager.updateConfig({
        strategy: BackoffStrategy.LINEAR,
        baseDelay: 100
      });

      let attempts = 0;
      const failingOperation = async () => {
        attempts++;
        throw new Error('Test failure');
      };

      const result = await backoffManager.executeWithBackoff(
        'linear-test',
        failingOperation,
        mockContext
      );

      expect(result.actualDelays[0]).toBe(100); // 100 * 1
      expect(result.actualDelays[1]).toBe(200); // 100 * 2
    });

    it('should implement fixed backoff strategy', async () => {
      backoffManager.updateConfig({
        strategy: BackoffStrategy.FIXED,
        baseDelay: 150
      });

      let attempts = 0;
      const failingOperation = async () => {
        attempts++;
        throw new Error('Test failure');
      };

      const result = await backoffManager.executeWithBackoff(
        'fixed-test',
        failingOperation,
        mockContext
      );

      expect(result.actualDelays[0]).toBe(150);
      expect(result.actualDelays[1]).toBe(150);
    });

    it('should implement fibonacci backoff strategy', async () => {
      backoffManager.updateConfig({
        strategy: BackoffStrategy.FIBONACCI,
        baseDelay: 100
      });

      let attempts = 0;
      const failingOperation = async () => {
        attempts++;
        throw new Error('Test failure');
      };

      const result = await backoffManager.executeWithBackoff(
        'fibonacci-test',
        failingOperation,
        mockContext
      );

      expect(result.actualDelays[0]).toBe(100); // 100 * fib(1) = 100 * 1
      expect(result.actualDelays[1]).toBe(200); // 100 * fib(2) = 100 * 2
    });
  });

  describe('Jitter Implementation', () => {
    it('should apply no jitter when configured', async () => {
      backoffManager.updateConfig({
        jitterType: JitterType.NONE,
        baseDelay: 100
      });

      let attempts = 0;
      const failingOperation = async () => {
        attempts++;
        throw new Error('Test failure');
      };

      const result = await backoffManager.executeWithBackoff(
        'no-jitter-test',
        failingOperation,
        mockContext
      );

      expect(result.actualDelays[0]).toBe(100);
    });

    it('should apply full jitter when configured', async () => {
      backoffManager.updateConfig({
        jitterType: JitterType.FULL,
        baseDelay: 100
      });

      let attempts = 0;
      const failingOperation = async () => {
        attempts++;
        throw new Error('Test failure');
      };

      const result = await backoffManager.executeWithBackoff(
        'full-jitter-test',
        failingOperation,
        mockContext
      );

      // Full jitter should be between 0 and base delay
      expect(result.actualDelays[0]).toBeGreaterThanOrEqual(0);
      expect(result.actualDelays[0]).toBeLessThanOrEqual(100);
    });

    it('should apply equal jitter when configured', async () => {
      backoffManager.updateConfig({
        jitterType: JitterType.EQUAL,
        baseDelay: 100
      });

      let attempts = 0;
      const failingOperation = async () => {
        attempts++;
        throw new Error('Test failure');
      };

      const result = await backoffManager.executeWithBackoff(
        'equal-jitter-test',
        failingOperation,
        mockContext
      );

      // Equal jitter should be between 50% and 100% of base delay
      expect(result.actualDelays[0]).toBeGreaterThanOrEqual(50);
      expect(result.actualDelays[0]).toBeLessThanOrEqual(100);
    });
  });

  describe('Adaptive Adjustments', () => {
    it('should adjust delays based on error types', async () => {
      backoffManager.updateConfig({
        adaptiveFactors: {
          errorTypeSensitivity: true,
          successRateSensitivity: false,
          loadSensitivity: false
        }
      });

      let attempts = 0;
      const rateLimitError = async () => {
        attempts++;
        throw new Error('Rate limit exceeded');
      };

      const result = await backoffManager.executeWithBackoff(
        'rate-limit-test',
        rateLimitError,
        mockContext
      );

      // Should have adaptive adjustments for rate limit errors
      expect(result.adaptiveAdjustments.length).toBeGreaterThan(0);
      const rateLimitAdjustment = result.adaptiveAdjustments.find(adj => adj.factor === 'error_type');
      expect(rateLimitAdjustment).toBeDefined();
      expect(rateLimitAdjustment?.reason).toContain('Rate limit');
    });

    it('should adjust delays based on success rate', async () => {
      backoffManager.updateConfig({
        adaptiveFactors: {
          errorTypeSensitivity: false,
          successRateSensitivity: true,
          loadSensitivity: false
        }
      });

      // First, create a poor success rate
      for (let i = 0; i < 5; i++) {
        await backoffManager.executeWithBackoff(
          'success-rate-test',
          async () => { throw new Error('Failure'); },
          mockContext
        );
      }

      let attempts = 0;
      const operation = async () => {
        attempts++;
        throw new Error('Test failure');
      };

      const result = await backoffManager.executeWithBackoff(
        'success-rate-test',
        operation,
        mockContext
      );

      // Should have adaptive adjustments for poor success rate
      const successRateAdjustment = result.adaptiveAdjustments.find(adj => adj.factor === 'success_rate');
      expect(successRateAdjustment).toBeDefined();
    });

    it('should respect non-retryable errors', async () => {
      const authError = async () => {
        throw new Error('Unauthorized access');
      };

      const result = await backoffManager.executeWithBackoff(
        'auth-test',
        authError,
        mockContext
      );

      // Should fail immediately without retries for auth errors
      expect(result.success).toBe(false);
      expect(result.attempts).toBe(1);
      expect(result.actualDelays).toHaveLength(0);
    });
  });

  describe('Timeout Handling', () => {
    it('should respect operation timeout', async () => {
      backoffManager.updateConfig({
        timeouts: {
          operationTimeout: 50,
          totalTimeout: 1000
        }
      });

      const slowOperation = async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return 'slow-result';
      };

      const result = await backoffManager.executeWithBackoff(
        'timeout-test',
        slowOperation,
        mockContext
      );

      expect(result.success).toBe(false);
      expect(result.error?.message).toBe('Operation timeout');
    });

    it('should respect total timeout across retries', async () => {
      backoffManager.updateConfig({
        baseDelay: 200,
        maxAttempts: 10,
        timeouts: {
          operationTimeout: 1000,
          totalTimeout: 300
        }
      });

      let attempts = 0;
      const failingOperation = async () => {
        attempts++;
        throw new Error('Test failure');
      };

      const startTime = Date.now();
      const result = await backoffManager.executeWithBackoff(
        'total-timeout-test',
        failingOperation,
        mockContext
      );
      const totalTime = Date.now() - startTime;

      expect(result.success).toBe(false);
      expect(totalTime).toBeLessThan(400); // Should stop before reaching max attempts
      expect(result.attempts).toBeLessThan(10);
    });
  });

  describe('Metrics and Performance Tracking', () => {
    it('should track operation metrics', async () => {
      const successfulOperation = async () => 'success';

      await backoffManager.executeWithBackoff(
        'metrics-test',
        successfulOperation,
        mockContext
      );

      const metrics = backoffManager.getOperationMetrics('metrics-test');
      expect(metrics).toBeDefined();
      expect(metrics?.successRate).toBeCloseTo(1.0);
      expect(metrics?.averageResponseTime).toBeGreaterThan(0);
    });

    it('should recommend strategies based on history', async () => {
      // Create operation with network errors
      for (let i = 0; i < 3; i++) {
        await backoffManager.executeWithBackoff(
          'network-test',
          async () => { throw new Error('Network connection failed'); },
          mockContext
        );
      }

      const recommendedStrategy = backoffManager.getRecommendedStrategy('network-test');
      expect(recommendedStrategy).toBe(BackoffStrategy.DECORRELATED);
    });

    it('should update system metrics', () => {
      backoffManager.updateSystemMetrics(0.8, 0.6, 10);

      // System metrics should affect adaptive adjustments
      const operation = async () => { throw new Error('Test'); };
      
      backoffManager.executeWithBackoff('system-test', operation, mockContext);
      // The effect would be visible in adaptive adjustments during execution
    });
  });

  describe('Configuration Management', () => {
    it('should allow configuration updates', () => {
      backoffManager.updateConfig({
        baseDelay: 500,
        maxAttempts: 10,
        strategy: BackoffStrategy.LINEAR
      });

      const config = backoffManager['config'];
      expect(config.baseDelay).toBe(500);
      expect(config.maxAttempts).toBe(10);
      expect(config.strategy).toBe(BackoffStrategy.LINEAR);
    });

    it('should reset operation metrics', async () => {
      await backoffManager.executeWithBackoff(
        'reset-test',
        async () => 'success',
        mockContext
      );

      expect(backoffManager.getOperationMetrics('reset-test')).toBeDefined();

      backoffManager.resetOperationMetrics('reset-test');

      expect(backoffManager.getOperationMetrics('reset-test')).toBeUndefined();
    });

    it('should return all metrics', async () => {
      await backoffManager.executeWithBackoff(
        'all-metrics-test1',
        async () => 'success',
        mockContext
      );

      await backoffManager.executeWithBackoff(
        'all-metrics-test2',
        async () => 'success',
        mockContext
      );

      const allMetrics = backoffManager.getAllMetrics();
      expect(Object.keys(allMetrics)).toContain('all-metrics-test1');
      expect(Object.keys(allMetrics)).toContain('all-metrics-test2');
    });
  });
});