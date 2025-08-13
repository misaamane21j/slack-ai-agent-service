/**
 * Performance and load testing for error handling system
 * Validates error handling performance under stress conditions
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { ToolExecutionBoundary } from '../../src/errors/boundaries/ToolExecutionBoundary';
import { AIProcessingBoundary } from '../../src/errors/boundaries/AIProcessingBoundary';
import { ResilienceOrchestrator } from '../../src/errors/resilience/ResilienceOrchestrator';
import { MonitoringOrchestrator } from '../../src/monitoring/MonitoringOrchestrator';
import { CircuitBreaker } from '../../src/errors/resilience/CircuitBreaker';
import { ErrorContextBuilder, ProcessingStage, OperationPhase } from '../../src/errors/context/ErrorContext';
import { ErrorSeverity, RecoveryAction } from '../../src/errors/types';
import { MCPToolError, MCPConnectionError } from '../../src/errors/mcp-tool';
import { AIProcessingError } from '../../src/errors/ai-processing';
import { BoundaryState } from '../../src/errors/boundaries/ErrorBoundary';

// Mock dependencies
jest.mock('../../src/monitoring/MonitoringOrchestrator');

// Use real timers for performance testing
jest.useRealTimers();

describe('Error Handling Performance Tests', () => {
  let toolBoundary: ToolExecutionBoundary;
  let aiBoundary: AIProcessingBoundary;
  let monitoringOrchestrator: jest.Mocked<MonitoringOrchestrator>;
  let circuitBreaker: CircuitBreaker;

  beforeEach(() => {
    toolBoundary = new ToolExecutionBoundary();
    aiBoundary = new AIProcessingBoundary();
    monitoringOrchestrator = new MonitoringOrchestrator() as jest.Mocked<MonitoringOrchestrator>;
    circuitBreaker = new CircuitBreaker({
      failureThreshold: 5,
      recoveryTimeoutMs: 1000,
      monitoringWindowMs: 5000
    });

    // Setup monitoring mocks
    monitoringOrchestrator.recordError = jest.fn();
    monitoringOrchestrator.recordPerformanceMetric = jest.fn();
    monitoringOrchestrator.recordRecovery = jest.fn();
  });

  describe('High Load Error Scenarios', () => {
    it('should handle 100 concurrent error operations efficiently', async () => {
      // Arrange
      const operationCount = 100;
      const contexts = Array.from({ length: operationCount }, (_, i) =>
        ErrorContextBuilder.create()
          .withSeverity(ErrorSeverity.MEDIUM)
          .withOperation(`concurrent_op_${i}`, OperationPhase.TOOL_INVOCATION)
          .withExecutionState(ProcessingStage.TOOL_EXECUTION)
          .withUserContext(`U${i}`, `C${i}`, `T${i}`)
          .build()
      );

      const failingOperation = async () => {
        // Add small random delay to simulate real-world variance
        await new Promise(resolve => setTimeout(resolve, Math.random() * 10));
        throw new MCPToolError('Load test error', {
          toolName: 'load_test_tool',
          operation: 'execute',
          recoveryActions: [RecoveryAction.USE_FALLBACK]
        });
      };

      const fallbackOperation = async () => {
        await new Promise(resolve => setTimeout(resolve, 5));
        return 'fallback_success';
      };

      // Act
      const startTime = Date.now();
      const promises = contexts.map(context =>
        toolBoundary.execute(failingOperation, context, fallbackOperation)
      );
      
      const results = await Promise.all(promises);
      const endTime = Date.now();
      const totalDuration = endTime - startTime;

      // Assert
      expect(results.length).toBe(operationCount);
      expect(results.every(r => r.fallbackUsed)).toBe(true);
      expect(results.every(r => r.result === 'fallback_success')).toBe(true);
      
      // Performance assertions
      expect(totalDuration).toBeLessThan(2000); // Should complete within 2 seconds
      
      const avgDuration = totalDuration / operationCount;
      expect(avgDuration).toBeLessThan(50); // Average per operation should be under 50ms

      // Boundary should handle the load without becoming isolated
      expect(toolBoundary.getState()).not.toBe(BoundaryState.ISOLATED);
    });

    it('should maintain performance during mixed success/failure scenarios', async () => {
      // Arrange
      const totalOperations = 200;
      const failureRate = 0.3; // 30% failure rate
      
      const contexts = Array.from({ length: totalOperations }, (_, i) =>
        ErrorContextBuilder.create()
          .withSeverity(ErrorSeverity.LOW)
          .withOperation(`mixed_op_${i}`, OperationPhase.TOOL_INVOCATION)
          .withExecutionState(ProcessingStage.TOOL_EXECUTION)
          .build()
      );

      const mixedOperation = (index: number) => async () => {
        const processingTime = Math.random() * 20 + 5; // 5-25ms processing time
        await new Promise(resolve => setTimeout(resolve, processingTime));
        
        if (Math.random() < failureRate) {
          throw new MCPToolError(`Simulated failure ${index}`, {
            toolName: 'mixed_test_tool',
            operation: 'execute',
            recoveryActions: [RecoveryAction.USE_FALLBACK]
          });
        }
        return `success_${index}`;
      };

      const fallbackOperation = async () => 'fallback_result';

      // Act
      const startTime = Date.now();
      const promises = contexts.map((context, i) =>
        toolBoundary.execute(mixedOperation(i), context, fallbackOperation)
      );
      
      const results = await Promise.all(promises);
      const endTime = Date.now();

      // Assert
      const successResults = results.filter(r => r.success && !r.fallbackUsed);
      const fallbackResults = results.filter(r => r.fallbackUsed);
      
      expect(successResults.length).toBeGreaterThan(totalOperations * 0.6); // At least 60% success
      expect(fallbackResults.length).toBeLessThan(totalOperations * 0.4); // At most 40% fallback
      
      const totalDuration = endTime - startTime;
      expect(totalDuration).toBeLessThan(3000); // Should complete within 3 seconds
      
      // All operations should complete successfully (either primary or fallback)
      expect(results.every(r => r.success || r.fallbackUsed)).toBe(true);
    });
  });

  describe('Memory and Resource Management', () => {
    it('should not leak memory during repeated error handling', async () => {
      // Arrange
      const iterations = 50;
      const initialMemory = process.memoryUsage().heapUsed;
      
      const context = ErrorContextBuilder.create()
        .withSeverity(ErrorSeverity.MEDIUM)
        .withOperation('memory_test', OperationPhase.TOOL_INVOCATION)
        .withExecutionState(ProcessingStage.TOOL_EXECUTION)
        .build();

      const errorOperation = async () => {
        // Create some objects that should be garbage collected
        const largeArray = new Array(1000).fill('test_data');
        throw new MCPToolError('Memory test error', {
          toolName: 'memory_test_tool',
          operation: 'execute',
          additionalData: largeArray,
          recoveryActions: [RecoveryAction.USE_FALLBACK]
        });
      };

      const fallbackOperation = async () => 'cleanup_success';

      // Act
      for (let i = 0; i < iterations; i++) {
        await toolBoundary.execute(errorOperation, context, fallbackOperation);
        
        // Force garbage collection if available (in Node.js with --expose-gc)
        if (global.gc) {
          global.gc();
        }
      }

      // Allow some time for garbage collection
      await new Promise(resolve => setTimeout(resolve, 100));

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;

      // Assert
      // Memory increase should be reasonable (less than 50MB for 50 iterations)
      expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024);
    });

    it('should clean up preserved context efficiently', async () => {
      // Arrange
      const operationCount = 100;
      const contexts = Array.from({ length: operationCount }, (_, i) =>
        ErrorContextBuilder.create()
          .withSeverity(ErrorSeverity.HIGH)
          .withOperation(`context_cleanup_${i}`, OperationPhase.TOOL_INVOCATION)
          .withExecutionState(ProcessingStage.TOOL_EXECUTION)
          .withUserContext(`U${i}`, `C${i}`, `T${i}`)
          .withConversationMetadata(`conv_${i}`, `thread_${i}`, `large_context_data_${i}`)
          .build()
      );

      const contextPreservingOperation = async () => {
        // Create operation that will preserve context
        throw new MCPConnectionError('Context preservation test', {
          operation: 'context_test',
          serverName: 'test_server',
          recoveryActions: [RecoveryAction.PRESERVE_CONTEXT, RecoveryAction.USE_FALLBACK]
        });
      };

      const fallbackOperation = async () => 'context_preserved';

      // Act
      const results = await Promise.all(
        contexts.map(context =>
          toolBoundary.execute(contextPreservingOperation, context, fallbackOperation)
        )
      );

      // Assert
      expect(results.every(r => r.preservedStateId)).toBe(true);
      expect(results.every(r => r.fallbackUsed)).toBe(true);
      
      // All preserved state IDs should be unique
      const stateIds = results.map(r => r.preservedStateId).filter(Boolean);
      const uniqueStateIds = new Set(stateIds);
      expect(uniqueStateIds.size).toBe(operationCount);
    });
  });

  describe('Circuit Breaker Performance', () => {
    it('should trip circuit breaker efficiently under high error rates', async () => {
      // Arrange
      const rapidFailureCount = 20;
      const context = ErrorContextBuilder.create()
        .withSeverity(ErrorSeverity.HIGH)
        .withOperation('circuit_breaker_test', OperationPhase.TOOL_INVOCATION)
        .withExecutionState(ProcessingStage.TOOL_EXECUTION)
        .build();

      const alwaysFailOperation = async () => {
        throw new MCPToolError('Circuit breaker test failure', {
          toolName: 'circuit_test_tool',
          operation: 'execute',
          recoveryActions: [RecoveryAction.USE_FALLBACK]
        });
      };

      const fallbackOperation = async () => 'circuit_fallback';

      // Act
      const startTime = Date.now();
      const results = [];
      
      for (let i = 0; i < rapidFailureCount; i++) {
        const result = await toolBoundary.execute(alwaysFailOperation, context, fallbackOperation);
        results.push(result);
        
        // Stop early if boundary becomes isolated (circuit breaker trips)
        if (toolBoundary.getState() === BoundaryState.ISOLATED) {
          break;
        }
      }
      
      const endTime = Date.now();
      const duration = endTime - startTime;

      // Assert
      expect(toolBoundary.getState()).toBe(BoundaryState.ISOLATED);
      expect(results.length).toBeLessThan(rapidFailureCount); // Should trip before all operations
      expect(duration).toBeLessThan(1000); // Should trip quickly
      
      // After circuit trips, subsequent operations should fail fast
      const fastFailStart = Date.now();
      const fastFailResult = await toolBoundary.execute(alwaysFailOperation, context, fallbackOperation);
      const fastFailDuration = Date.now() - fastFailStart;
      
      expect(fastFailResult.fallbackUsed).toBe(true);
      expect(fastFailDuration).toBeLessThan(50); // Should be very fast when circuit is open
    });
  });

  describe('Recovery Performance', () => {
    it('should recover efficiently from temporary failures', async () => {
      // Arrange
      let operationCount = 0;
      const context = ErrorContextBuilder.create()
        .withSeverity(ErrorSeverity.MEDIUM)
        .withOperation('recovery_performance', OperationPhase.TOOL_INVOCATION)
        .withExecutionState(ProcessingStage.TOOL_EXECUTION)
        .build();

      const recoveryOperation = async () => {
        operationCount++;
        if (operationCount <= 3) {
          throw new MCPConnectionError('Temporary failure', {
            operation: 'recovery_test',
            serverName: 'recovery_server',
            recoveryActions: [RecoveryAction.RETRY_WITH_BACKOFF]
          });
        }
        return 'recovery_successful';
      };

      // Act
      const startTime = Date.now();
      const result = await toolBoundary.execute(recoveryOperation, context);
      const endTime = Date.now();
      const duration = endTime - startTime;

      // Assert
      expect(result.success).toBe(true);
      expect(result.result).toBe('recovery_successful');
      expect(operationCount).toBe(4); // 3 failures + 1 success
      
      // Recovery should happen with reasonable backoff (not too slow, not too fast)
      expect(duration).toBeGreaterThan(100); // Should have some backoff delay
      expect(duration).toBeLessThan(2000); // But not excessive delay
      
      expect(monitoringOrchestrator.recordRecovery).toHaveBeenCalled();
    });

    it('should handle recovery under concurrent load', async () => {
      // Arrange
      const concurrentRequests = 20;
      const contexts = Array.from({ length: concurrentRequests }, (_, i) =>
        ErrorContextBuilder.create()
          .withSeverity(ErrorSeverity.MEDIUM)
          .withOperation(`concurrent_recovery_${i}`, OperationPhase.TOOL_INVOCATION)
          .withExecutionState(ProcessingStage.TOOL_EXECUTION)
          .build()
      );

      let globalOperationCount = 0;
      const concurrentRecoveryOperation = async () => {
        const operationId = ++globalOperationCount;
        if (operationId <= concurrentRequests) {
          // First wave fails
          throw new MCPToolError('Initial concurrent failure', {
            toolName: 'concurrent_recovery_tool',
            operation: 'execute',
            recoveryActions: [RecoveryAction.RETRY_WITH_BACKOFF]
          });
        }
        return `concurrent_recovery_${operationId}`;
      };

      // Act
      const startTime = Date.now();
      const results = await Promise.all(
        contexts.map(context =>
          toolBoundary.execute(concurrentRecoveryOperation, context)
        )
      );
      const endTime = Date.now();

      // Assert
      expect(results.every(r => r.success)).toBe(true);
      expect(results.every(r => typeof r.result === 'string')).toBe(true);
      
      const duration = endTime - startTime;
      expect(duration).toBeLessThan(3000); // Should recover efficiently under load
      
      // Boundary should remain healthy after successful recovery
      expect(toolBoundary.getState()).toBe(BoundaryState.HEALTHY);
    });
  });

  describe('Monitoring Performance Impact', () => {
    it('should not significantly impact operation performance', async () => {
      // Arrange
      const operationCount = 100;
      const context = ErrorContextBuilder.create()
        .withSeverity(ErrorSeverity.LOW)
        .withOperation('monitoring_impact', OperationPhase.TOOL_INVOCATION)
        .withExecutionState(ProcessingStage.TOOL_EXECUTION)
        .build();

      const lightweightOperation = async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return 'lightweight_success';
      };

      // Act - Measure with monitoring
      const withMonitoringStart = Date.now();
      const withMonitoringPromises = Array.from({ length: operationCount }, () =>
        toolBoundary.execute(lightweightOperation, context)
      );
      await Promise.all(withMonitoringPromises);
      const withMonitoringDuration = Date.now() - withMonitoringStart;

      // Act - Measure without monitoring (simulate by not calling monitoring methods)
      const originalRecordPerf = monitoringOrchestrator.recordPerformanceMetric;
      monitoringOrchestrator.recordPerformanceMetric = jest.fn(); // No-op mock

      const withoutMonitoringStart = Date.now();
      const withoutMonitoringPromises = Array.from({ length: operationCount }, () =>
        toolBoundary.execute(lightweightOperation, context)
      );
      await Promise.all(withoutMonitoringPromises);
      const withoutMonitoringDuration = Date.now() - withoutMonitoringStart;

      // Restore original mock
      monitoringOrchestrator.recordPerformanceMetric = originalRecordPerf;

      // Assert
      const monitoringOverhead = withMonitoringDuration - withoutMonitoringDuration;
      const overheadPercentage = (monitoringOverhead / withoutMonitoringDuration) * 100;

      // Monitoring overhead should be less than 20% of total operation time
      expect(overheadPercentage).toBeLessThan(20);
      expect(monitoringOverhead).toBeLessThan(500); // Less than 500ms overhead for 100 operations
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });
});