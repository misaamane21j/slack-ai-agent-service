/**
 * Unit tests for Error Boundary system
 */

import {
  ErrorBoundary,
  BoundaryType,
  BoundaryState,
  BoundaryConfig,
  BoundaryResult
} from '../../../../src/errors/boundaries/ErrorBoundary';
import {
  EnhancedErrorContext,
  ErrorContextBuilder,
  ProcessingStage,
  OperationPhase
} from '../../../../src/errors/context/ErrorContext';
import { ErrorSeverity } from '../../../../src/errors/types';
import { RecoveryStrategyManager, RecoveryResult } from '../../../../src/errors/recovery/RecoveryStrategy';
import { ContextPreserver } from '../../../../src/errors/context/ContextPreserver';

// Mock timer functions for testing
jest.useFakeTimers();

// Concrete implementation of ErrorBoundary for testing
class TestErrorBoundary extends ErrorBoundary {
  constructor(config?: Partial<BoundaryConfig>) {
    super(BoundaryType.TOOL_EXECUTION, config);
  }

  protected shouldPreserveContext(context: EnhancedErrorContext): boolean {
    return true;
  }

  protected preserveExecutionContext(context: EnhancedErrorContext): string {
    return this.contextPreserver.preserve(
      context,
      { conversationId: 'test', threadId: 'test', userId: 'test', originalMessage: 'test', parsedIntent: 'test', confidence: 1.0, fallbackOptions: [] },
      { operationId: 'test', stage: ProcessingStage.TOOL_EXECUTION, phase: OperationPhase.TOOL_INVOCATION, completedSteps: [], partialResults: {}, toolSelections: [], retryCount: 0, maxRetries: 3 },
      { activeConnections: [], resourcesAcquired: [], temporaryData: {}, processingMetrics: { startTime: new Date(), processingDuration: 0, memoryUsage: 0, networkCalls: 0 } }
    );
  }

  protected getFallbackOperation<T>(originalOperation: () => Promise<T>, context: EnhancedErrorContext): (() => Promise<T>) | undefined {
    return async () => {
      return 'fallback_result' as T;
    };
  }
}

describe('ErrorBoundary', () => {
  let boundary: TestErrorBoundary;
  let errorContext: EnhancedErrorContext;

  beforeEach(() => {
    boundary = new TestErrorBoundary({
      maxErrorsBeforeDegradation: 2,
      maxErrorsBeforeIsolation: 3,
      recoveryTimeoutMs: 1000,
      isolationDurationMs: 2000,
      enableAutoRecovery: false // Disable for faster tests
    });

    errorContext = ErrorContextBuilder.create()
      .withSeverity(ErrorSeverity.MEDIUM)
      .withOperation('test_operation', OperationPhase.TOOL_INVOCATION)
      .withExecutionState(ProcessingStage.TOOL_EXECUTION)
      .build();
  });

  describe('execute', () => {
    it('should execute operation successfully when healthy', async () => {
      const operation = jest.fn().mockResolvedValue('success');
      
      const result = await boundary.execute(operation, errorContext);

      expect(result.success).toBe(true);
      expect(result.result).toBe('success');
      expect(result.boundaryState).toBe(BoundaryState.HEALTHY);
      expect(result.fallbackUsed).toBe(false);
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should handle operation failure and attempt recovery', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('Test error'));
      
      const result = await boundary.execute(operation, errorContext);

      expect(result.success).toBe(false);
      expect(result.error?.message).toBe('Test error');
      expect(boundary.getState()).toBe(BoundaryState.HEALTHY); // Still healthy after one error
    });

    it('should degrade after multiple errors', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('Test error'));
      
      // First error
      await boundary.execute(operation, errorContext);
      expect(boundary.getState()).toBe(BoundaryState.HEALTHY);

      // Second error - should trigger degradation
      await boundary.execute(operation, errorContext);
      expect(boundary.getState()).toBe(BoundaryState.DEGRADED);
    });

    it('should isolate after reaching isolation threshold', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('Test error'));
      
      // Trigger errors to reach isolation threshold
      await boundary.execute(operation, errorContext);
      await boundary.execute(operation, errorContext);
      await boundary.execute(operation, errorContext);
      
      expect(boundary.getState()).toBe(BoundaryState.ISOLATED);
      expect(boundary.isIsolated()).toBe(true);
    });

    it('should use fallback operation when primary fails', async () => {
      const primaryOperation = jest.fn().mockRejectedValue(new Error('Primary failed'));
      const fallbackOperation = jest.fn().mockResolvedValue('fallback_success');
      
      const result = await boundary.execute(primaryOperation, errorContext, fallbackOperation);

      expect(result.success).toBe(true);
      expect(result.result).toBe('fallback_success');
      expect(result.fallbackUsed).toBe(true);
      expect(fallbackOperation).toHaveBeenCalledTimes(1);
    });

    it('should handle isolation period correctly', async () => {
      // Force boundary into isolated state
      boundary.isolate(5000);
      
      const operation = jest.fn().mockResolvedValue('success');
      const fallback = jest.fn().mockResolvedValue('fallback');
      
      const result = await boundary.execute(operation, errorContext, fallback);

      // Should use fallback during isolation
      expect(result.fallbackUsed).toBe(true);
      expect(operation).not.toHaveBeenCalled();
    });

    it('should recover from isolation after timeout', async () => {
      // Force boundary into isolated state with short duration
      boundary.isolate(1000);
      
      // Advance time past isolation period
      jest.advanceTimersByTime(1500);
      
      const operation = jest.fn().mockResolvedValue('success');
      
      const result = await boundary.execute(operation, errorContext);

      expect(result.success).toBe(true);
      expect(boundary.getState()).toBe(BoundaryState.DEGRADED); // Should transition to degraded
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should handle timeout in operations', async () => {
      const slowOperation = () => new Promise(resolve => 
        setTimeout(() => resolve('slow_result'), 10000)
      );
      
      const resultPromise = boundary.execute(slowOperation, errorContext);
      
      // Advance timers to trigger timeout
      await jest.runAllTimersAsync();
      
      const result = await resultPromise;
      
      expect(result.success).toBe(false);
      expect(result.error?.message).toBe('Operation timeout');
    });
  });

  describe('state management', () => {
    it('should reset to healthy state', () => {
      // Force boundary into failed state
      boundary.isolate();
      expect(boundary.getState()).toBe(BoundaryState.ISOLATED);

      boundary.reset();
      expect(boundary.getState()).toBe(BoundaryState.HEALTHY);
      expect(boundary.isIsolated()).toBe(false);
    });

    it('should track metrics correctly', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('Test error'));
      
      await boundary.execute(operation, errorContext);
      await boundary.execute(operation, errorContext);
      
      const metrics = boundary.getMetrics();
      expect(metrics.errorCount).toBe(2);
      expect(metrics.lastErrorTime).toBeDefined();
    });

    it('should record successful operations', async () => {
      const failingOperation = jest.fn().mockRejectedValue(new Error('Test error'));
      const successOperation = jest.fn().mockResolvedValue('success');
      
      // First cause some errors
      await boundary.execute(failingOperation, errorContext);
      await boundary.execute(failingOperation, errorContext);
      expect(boundary.getState()).toBe(BoundaryState.DEGRADED);
      
      // Then succeed
      await boundary.execute(successOperation, errorContext);
      
      // Should reset error count and improve state
      const metrics = boundary.getMetrics();
      expect(metrics.errorCount).toBe(0);
      expect(boundary.getState()).toBe(BoundaryState.HEALTHY);
    });
  });

  describe('context preservation', () => {
    it('should preserve context when configured', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('Test error'));
      
      const result = await boundary.execute(operation, errorContext);
      
      expect(result.preservedStateId).toBeDefined();
      expect(typeof result.preservedStateId).toBe('string');
    });

    it('should handle preserved state in recovery', async () => {
      // Mock recovery manager to return success with preserved data
      const mockRecoveryManager = {
        executeRecovery: jest.fn().mockResolvedValue(RecoveryResult.SUCCESS)
      } as any;
      
      const boundaryWithRecovery = new TestErrorBoundary();
      (boundaryWithRecovery as any).recoveryManager = mockRecoveryManager;
      
      const operation = jest.fn().mockRejectedValue(new Error('Test error'));
      
      const result = await boundaryWithRecovery.execute(operation, errorContext);
      
      expect(mockRecoveryManager.executeRecovery).toHaveBeenCalled();
    });
  });

  describe('configuration', () => {
    it('should use custom configuration', () => {
      const customBoundary = new TestErrorBoundary({
        maxErrorsBeforeDegradation: 5,
        maxErrorsBeforeIsolation: 10,
        isolationDurationMs: 60000
      });
      
      const config = customBoundary.getConfig();
      expect(config.maxErrorsBeforeDegradation).toBe(5);
      expect(config.maxErrorsBeforeIsolation).toBe(10);
      expect(config.isolationDurationMs).toBe(60000);
    });

    it('should disable auto recovery when configured', async () => {
      const noRecoveryBoundary = new TestErrorBoundary({
        enableAutoRecovery: false
      });
      
      const operation = jest.fn().mockRejectedValue(new Error('Test error'));
      
      const result = await noRecoveryBoundary.execute(operation, errorContext);
      
      expect(result.success).toBe(false);
      // Recovery should not be attempted, so no recoveryResult
      expect(result.recoveryResult).toBe(RecoveryResult.FAILED);
    });
  });

  describe('boundary types', () => {
    it('should create boundary with correct type', () => {
      expect((boundary as any).boundaryType).toBe(BoundaryType.TOOL_EXECUTION);
    });

    it('should support different boundary types', () => {
      const registryBoundary = new TestErrorBoundary();
      (registryBoundary as any).boundaryType = BoundaryType.REGISTRY;
      
      expect((registryBoundary as any).boundaryType).toBe(BoundaryType.REGISTRY);
    });
  });

  describe('edge cases', () => {
    it('should handle null/undefined operations gracefully', async () => {
      const nullOperation = null as any;
      
      await expect(boundary.execute(nullOperation, errorContext)).rejects.toThrow();
    });

    it('should handle operations that return undefined', async () => {
      const undefinedOperation = jest.fn().mockResolvedValue(undefined);
      
      const result = await boundary.execute(undefinedOperation, errorContext);
      
      expect(result.success).toBe(true);
      expect(result.result).toBeUndefined();
    });

    it('should handle very long error messages', async () => {
      const longError = new Error('A'.repeat(10000));
      const operation = jest.fn().mockRejectedValue(longError);
      
      const result = await boundary.execute(operation, errorContext);
      
      expect(result.success).toBe(false);
      expect(result.error?.message).toBe(longError.message);
    });

    it('should handle concurrent operations', async () => {
      const operation = jest.fn().mockResolvedValue('success');
      
      const promises = Array(10).fill(0).map(() => 
        boundary.execute(operation, errorContext)
      );
      
      const results = await Promise.all(promises);
      
      expect(results.every(r => r.success)).toBe(true);
      expect(operation).toHaveBeenCalledTimes(10);
    });
  });
});

afterEach(() => {
  jest.clearAllTimers();
  jest.restoreAllMocks();
});