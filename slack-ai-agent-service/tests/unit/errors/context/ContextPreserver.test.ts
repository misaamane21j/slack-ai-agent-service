/**
 * Unit tests for Context Preservation system
 */

import {
  ContextPreserver,
  PreservedState,
  PreservationReason,
  PreservationPriority,
  UserState,
  OperationState,
  SystemState,
  ContinuationPlan
} from '../../../../src/errors/context/ContextPreserver';
import {
  EnhancedErrorContext,
  ErrorContextBuilder,
  ProcessingStage,
  OperationPhase
} from '../../../../src/errors/context/ErrorContext';
import { ErrorSeverity } from '../../../../src/errors/types';
import { RecoveryAttempt, RecoveryResult, RecoveryStrategyType } from '../../../../src/errors/recovery/RecoveryStrategy';

// Mock timer functions for testing
jest.useFakeTimers();

describe('ContextPreserver', () => {
  let preserver: ContextPreserver;
  let errorContext: EnhancedErrorContext;
  let userState: UserState;
  let operationState: OperationState;
  let systemState: SystemState;

  beforeEach(() => {
    preserver = new ContextPreserver(100, 5000); // 100 max states, 5s TTL for testing
    
    errorContext = ErrorContextBuilder.create()
      .withSeverity(ErrorSeverity.MEDIUM)
      .withOperation('test_operation', OperationPhase.TOOL_INVOCATION)
      .withExecutionState(ProcessingStage.TOOL_EXECUTION)
      .withUserIntent('test message', 'test_intent', 0.8, 'conv123')
      .build();

    userState = {
      conversationId: 'conv123',
      threadId: 'thread456',
      userId: 'user789',
      originalMessage: 'test message',
      parsedIntent: 'test_intent',
      confidence: 0.8,
      fallbackOptions: ['option1', 'option2']
    };

    operationState = {
      operationId: 'op123',
      stage: ProcessingStage.TOOL_EXECUTION,
      phase: OperationPhase.TOOL_INVOCATION,
      completedSteps: ['initialization', 'validation'],
      partialResults: { data: 'test_data' },
      toolSelections: [],
      retryCount: 0,
      maxRetries: 3
    };

    systemState = {
      activeConnections: ['conn1', 'conn2'],
      resourcesAcquired: ['resource1'],
      temporaryData: { temp: 'value' },
      processingMetrics: {
        startTime: new Date(),
        processingDuration: 1000,
        memoryUsage: 1024,
        networkCalls: 5
      }
    };
  });

  describe('preserve', () => {
    it('should preserve state and return state ID', () => {
      const stateId = preserver.preserve(errorContext, userState, operationState, systemState);

      expect(stateId).toBeDefined();
      expect(typeof stateId).toBe('string');
      expect(stateId).toContain('state_');
    });

    it('should store preserved state internally', () => {
      const stateId = preserver.preserve(errorContext, userState, operationState, systemState);
      const preserved = preserver.restore(stateId);

      expect(preserved).toBeDefined();
      expect(preserved!.id).toBe(stateId);
      expect(preserved!.errorContext).toEqual(errorContext);
      expect(preserved!.userState).toEqual(userState);
      expect(preserved!.operationState).toEqual(operationState);
      expect(preserved!.systemState).toEqual(systemState);
    });

    it('should set expiration time based on TTL', () => {
      const customTtl = 10000;
      const beforePreserve = Date.now();
      
      const stateId = preserver.preserve(errorContext, userState, operationState, systemState, {
        ttlMs: customTtl
      });
      
      const preserved = preserver.restore(stateId);
      const afterPreserve = Date.now();

      expect(preserved!.expiresAt.getTime()).toBeGreaterThanOrEqual(beforePreserve + customTtl);
      expect(preserved!.expiresAt.getTime()).toBeLessThanOrEqual(afterPreserve + customTtl);
    });

    it('should set preservation options', () => {
      const stateId = preserver.preserve(errorContext, userState, operationState, systemState, {
        priority: PreservationPriority.HIGH,
        reason: PreservationReason.FALLBACK_PREPARATION,
        tags: ['custom', 'test']
      });

      const preserved = preserver.restore(stateId);

      expect(preserved!.metadata.priority).toBe(PreservationPriority.HIGH);
      expect(preserved!.metadata.preservationReason).toBe(PreservationReason.FALLBACK_PREPARATION);
      expect(preserved!.metadata.tags).toContain('custom');
      expect(preserved!.metadata.tags).toContain('test');
    });

    it('should evict low priority states when capacity reached', () => {
      // Fill to capacity with low priority states
      const lowPriorityIds: string[] = [];
      for (let i = 0; i < 100; i++) {
        const id = preserver.preserve(errorContext, userState, operationState, systemState, {
          priority: PreservationPriority.LOW
        });
        lowPriorityIds.push(id);
      }

      // Add high priority state (should trigger eviction)
      const highPriorityId = preserver.preserve(errorContext, userState, operationState, systemState, {
        priority: PreservationPriority.HIGH
      });

      // High priority state should be preserved
      expect(preserver.restore(highPriorityId)).toBeDefined();

      // Some low priority states should be evicted
      const remainingLowPriority = lowPriorityIds.filter(id => preserver.restore(id) !== null);
      expect(remainingLowPriority.length).toBeLessThan(lowPriorityIds.length);
    });
  });

  describe('restore', () => {
    it('should restore preserved state', () => {
      const stateId = preserver.preserve(errorContext, userState, operationState, systemState);
      const restored = preserver.restore(stateId);

      expect(restored).toBeDefined();
      expect(restored!.errorContext).toEqual(errorContext);
    });

    it('should return null for non-existent state ID', () => {
      const restored = preserver.restore('non_existent_id');
      expect(restored).toBeNull();
    });

    it('should return null for expired state', () => {
      const stateId = preserver.preserve(errorContext, userState, operationState, systemState, {
        ttlMs: 1000
      });

      // Fast-forward past expiration
      jest.advanceTimersByTime(2000);

      const restored = preserver.restore(stateId);
      expect(restored).toBeNull();
    });

    it('should add accessed tag on restore', () => {
      const stateId = preserver.preserve(errorContext, userState, operationState, systemState);
      const restored = preserver.restore(stateId);

      expect(restored!.metadata.tags).toContain('accessed');
    });
  });

  describe('update', () => {
    it('should update operation state', () => {
      const stateId = preserver.preserve(errorContext, userState, operationState, systemState);
      
      const success = preserver.update(stateId, {
        operationState: {
          completedSteps: ['initialization', 'validation', 'execution']
        }
      });

      expect(success).toBe(true);

      const updated = preserver.restore(stateId);
      expect(updated!.operationState.completedSteps).toContain('execution');
    });

    it('should update system state', () => {
      const stateId = preserver.preserve(errorContext, userState, operationState, systemState);
      
      const success = preserver.update(stateId, {
        systemState: {
          activeConnections: ['conn1', 'conn2', 'conn3']
        }
      });

      expect(success).toBe(true);

      const updated = preserver.restore(stateId);
      expect(updated!.systemState.activeConnections).toContain('conn3');
    });

    it('should increment version on metadata update', () => {
      const stateId = preserver.preserve(errorContext, userState, operationState, systemState);
      
      preserver.update(stateId, {
        metadata: {
          tags: ['updated']
        }
      });

      const updated = preserver.restore(stateId);
      expect(updated!.metadata.version).toBe(2);
      expect(updated!.metadata.tags).toContain('updated');
    });

    it('should return false for non-existent state', () => {
      const success = preserver.update('non_existent', {
        operationState: { completedSteps: [] }
      });

      expect(success).toBe(false);
    });

    it('should return false for expired state', () => {
      const stateId = preserver.preserve(errorContext, userState, operationState, systemState, {
        ttlMs: 1000
      });

      jest.advanceTimersByTime(2000);

      const success = preserver.update(stateId, {
        operationState: { completedSteps: [] }
      });

      expect(success).toBe(false);
    });
  });

  describe('remove', () => {
    it('should remove preserved state', () => {
      const stateId = preserver.preserve(errorContext, userState, operationState, systemState);
      
      const removed = preserver.remove(stateId);
      expect(removed).toBe(true);

      const restored = preserver.restore(stateId);
      expect(restored).toBeNull();
    });

    it('should return false for non-existent state', () => {
      const removed = preserver.remove('non_existent');
      expect(removed).toBe(false);
    });
  });

  describe('createCheckpoint', () => {
    it('should create checkpoint with standard format', () => {
      const checkpointId = preserver.createCheckpoint(errorContext, operationState, 'manual_test');

      const checkpoint = preserver.restore(checkpointId);
      expect(checkpoint).toBeDefined();
      expect(checkpoint!.metadata.preservationReason).toBe(PreservationReason.ERROR_RECOVERY);
      expect(checkpoint!.metadata.priority).toBe(PreservationPriority.HIGH);
      expect(checkpoint!.metadata.tags).toContain('checkpoint');
      expect(checkpoint!.metadata.tags).toContain('manual_test');
    });

    it('should extract user context from error context', () => {
      const checkpointId = preserver.createCheckpoint(errorContext, operationState);

      const checkpoint = preserver.restore(checkpointId);
      expect(checkpoint!.userState.conversationId).toBe('conv123');
      expect(checkpoint!.userState.originalMessage).toBe('test message');
      expect(checkpoint!.userState.parsedIntent).toBe('test_intent');
      expect(checkpoint!.userState.confidence).toBe(0.8);
    });
  });

  describe('continueFromCheckpoint', () => {
    it('should create continuation plan from valid checkpoint', () => {
      const checkpointId = preserver.createCheckpoint(errorContext, operationState);
      const recoveryAttempts: RecoveryAttempt[] = [];

      const continuationPlan = preserver.continueFromCheckpoint(checkpointId, recoveryAttempts);

      expect(continuationPlan).toBeDefined();
      expect(continuationPlan!.stateId).toBe(checkpointId);
      expect(continuationPlan!.canContinue).toBe(true);
      expect(continuationPlan!.continuableSteps.length).toBeGreaterThan(0);
      expect(continuationPlan!.estimatedSavings).toBeGreaterThan(0);
    });

    it('should return null for invalid checkpoint', () => {
      const continuationPlan = preserver.continueFromCheckpoint('invalid_id', []);
      expect(continuationPlan).toBeNull();
    });

    it('should identify risks in continuation plan', () => {
      // Create old checkpoint (simulate stale data)  
      const oldTimestamp = new Date(Date.now() - 15 * 60 * 1000); // 15 minutes ago
      const checkpointId = preserver.preserve(errorContext, userState, operationState, systemState);
      
      // Manually update the preserved state's timestamp to be old
      const preserved = preserver.restore(checkpointId)!;
      preserved.timestamp = oldTimestamp;
      
      const continuationPlan = preserver.continueFromCheckpoint(checkpointId, []);

      expect(continuationPlan!.risks).toContain('Preserved state may be stale');
    });

    it('should adjust for multiple recovery failures', () => {
      const failedAttempts: RecoveryAttempt[] = [
        { strategyType: RecoveryStrategyType.RETRY, timestamp: new Date(), result: RecoveryResult.FAILED },
        { strategyType: RecoveryStrategyType.FALLBACK, timestamp: new Date(), result: RecoveryResult.FAILED }
      ];

      const checkpointId = preserver.createCheckpoint(errorContext, operationState);
      const continuationPlan = preserver.continueFromCheckpoint(checkpointId, failedAttempts);

      expect(continuationPlan!.risks).toContain('Multiple recovery attempts have failed');
    });
  });

  describe('getStatesForUser', () => {
    it('should return states for specific user', () => {
      const user1States: string[] = [];
      const user2States: string[] = [];

      // Create states for user1
      for (let i = 0; i < 3; i++) {
        const state = { ...userState, userId: 'user1' };
        const id = preserver.preserve(errorContext, state, operationState, systemState);
        user1States.push(id);
      }

      // Create states for user2
      for (let i = 0; i < 2; i++) {
        const state = { ...userState, userId: 'user2' };
        const id = preserver.preserve(errorContext, state, operationState, systemState);
        user2States.push(id);
      }

      const user1Retrieved = preserver.getStatesForUser('user1');
      const user2Retrieved = preserver.getStatesForUser('user2');

      expect(user1Retrieved.length).toBe(3);
      expect(user2Retrieved.length).toBe(2);

      expect(user1Retrieved.every(s => s.userState.userId === 'user1')).toBe(true);
      expect(user2Retrieved.every(s => s.userState.userId === 'user2')).toBe(true);
    });

    it('should filter by conversation ID when provided', () => {
      // Create states for same user but different conversations
      const conv1State = { ...userState, userId: 'user1', conversationId: 'conv1' };
      const conv2State = { ...userState, userId: 'user1', conversationId: 'conv2' };

      preserver.preserve(errorContext, conv1State, operationState, systemState);
      preserver.preserve(errorContext, conv2State, operationState, systemState);

      const conv1States = preserver.getStatesForUser('user1', 'conv1');
      const conv2States = preserver.getStatesForUser('user1', 'conv2');

      expect(conv1States.length).toBe(1);
      expect(conv2States.length).toBe(1);
      expect(conv1States[0].userState.conversationId).toBe('conv1');
      expect(conv2States[0].userState.conversationId).toBe('conv2');
    });

    it('should return states sorted by timestamp (newest first)', () => {
      const ids: string[] = [];
      
      for (let i = 0; i < 3; i++) {
        jest.advanceTimersByTime(1000); // Advance time between creations
        const id = preserver.preserve(errorContext, userState, operationState, systemState);
        ids.push(id);
      }

      const states = preserver.getStatesForUser('user789');

      expect(states.length).toBe(3);
      // Should be newest first
      for (let i = 1; i < states.length; i++) {
        expect(states[i - 1].timestamp.getTime()).toBeGreaterThan(states[i].timestamp.getTime());
      }
    });

    it('should exclude expired states', () => {
      const id = preserver.preserve(errorContext, userState, operationState, systemState, {
        ttlMs: 1000
      });

      // State should exist initially
      let states = preserver.getStatesForUser('user789');
      expect(states.length).toBe(1);

      // Fast-forward past expiration
      jest.advanceTimersByTime(2000);

      // State should be filtered out
      states = preserver.getStatesForUser('user789');
      expect(states.length).toBe(0);
    });
  });

  describe('cleanupResources', () => {
    it('should remove state and clear scheduled cleanup', () => {
      const stateId = preserver.preserve(errorContext, userState, operationState, systemState);
      
      // Should exist before cleanup
      expect(preserver.restore(stateId)).toBeDefined();

      preserver.cleanupResources(stateId);

      // Should be removed after cleanup
      expect(preserver.restore(stateId)).toBeNull();
    });

    it('should handle cleanup of non-existent state gracefully', () => {
      expect(() => {
        preserver.cleanupResources('non_existent');
      }).not.toThrow();
    });
  });

  describe('getStatistics', () => {
    it('should provide comprehensive preservation statistics', () => {
      // Create mix of states
      const normalId = preserver.preserve(errorContext, userState, operationState, systemState, {
        priority: PreservationPriority.MEDIUM,
        reason: PreservationReason.ERROR_RECOVERY
      });

      const highPriorityId = preserver.preserve(errorContext, userState, operationState, systemState, {
        priority: PreservationPriority.HIGH,
        reason: PreservationReason.RETRY_ATTEMPT
      });

      const expiredId = preserver.preserve(errorContext, userState, operationState, systemState, {
        ttlMs: 500
      });

      // Let one expire by advancing time
      jest.setSystemTime(Date.now() + 1000);

      const stats = preserver.getStatistics();

      // Note: the statistics count all states in the internal map
      expect(stats.totalStates).toBe(3);
      expect(stats.activeStates).toBe(2);
      expect(stats.expiredStates).toBe(1);
      
      expect(stats.priorityCounts[PreservationPriority.MEDIUM]).toBe(1);
      expect(stats.priorityCounts[PreservationPriority.HIGH]).toBe(1);
      
      expect(stats.reasonCounts[PreservationReason.ERROR_RECOVERY]).toBe(1);
      expect(stats.reasonCounts[PreservationReason.RETRY_ATTEMPT]).toBe(1);
      
      expect(stats.memoryUsage).toBeGreaterThan(0);
      expect(stats.oldestState).toBeDefined();
    });

    it('should calculate memory usage estimate', () => {
      // Create several states to get measurable memory usage
      for (let i = 0; i < 5; i++) {
        preserver.preserve(errorContext, userState, operationState, systemState);
      }

      const stats = preserver.getStatistics();

      expect(stats.memoryUsage).toBeGreaterThan(1000); // Should be substantial
    });
  });

  describe('periodic cleanup', () => {
    it('should clean up expired states periodically', () => {
      // Create state with short TTL
      const stateId = preserver.preserve(errorContext, userState, operationState, systemState, {
        ttlMs: 1000
      });

      // Should exist initially
      expect(preserver.restore(stateId)).toBeDefined();

      // Fast-forward past expiration and periodic cleanup interval
      jest.advanceTimersByTime(6 * 60 * 1000); // 6 minutes (past 5 minute cleanup interval)

      // Should be cleaned up
      expect(preserver.restore(stateId)).toBeNull();
    });
  });

  describe('continuation analysis', () => {
    it('should identify continuable vs restart steps correctly', () => {
      const failedOpState = {
        ...operationState,
        failedStep: 'tool_execution',
        completedSteps: ['initialization', 'validation', 'tool_discovery']
      };

      const checkpointId = preserver.createCheckpoint(errorContext, failedOpState);
      const continuationPlan = preserver.continueFromCheckpoint(checkpointId, []);

      // Steps not dependent on failed step should be continuable
      expect(continuationPlan!.continuableSteps).toContain('initialization');
      expect(continuationPlan!.continuableSteps).toContain('validation');
      expect(continuationPlan!.continuableSteps).toContain('tool_discovery');

      // Should restart from failed step
      expect(continuationPlan!.restartFromStep).toBe('tool_execution');
    });

    it('should estimate time savings from continuable steps', () => {
      const completedSteps = ['context_gathering', 'ai_processing', 'tool_discovery'];
      const checkpointOpState = {
        ...operationState,
        completedSteps
      };

      const checkpointId = preserver.createCheckpoint(errorContext, checkpointOpState);
      const continuationPlan = preserver.continueFromCheckpoint(checkpointId, []);

      // Should estimate savings based on completed steps
      expect(continuationPlan!.estimatedSavings).toBeGreaterThan(5000); // context_gathering + ai_processing + tool_discovery
    });

    it('should recommend full restart after multiple recovery failures', () => {
      const multipleFailures: RecoveryAttempt[] = [
        { strategyType: RecoveryStrategyType.RETRY, timestamp: new Date(), result: RecoveryResult.FAILED },
        { strategyType: RecoveryStrategyType.FALLBACK, timestamp: new Date(), result: RecoveryResult.FAILED },
        { strategyType: RecoveryStrategyType.CIRCUIT_BREAKER, timestamp: new Date(), result: RecoveryResult.FAILED }
      ];

      const checkpointId = preserver.createCheckpoint(errorContext, operationState);
      const continuationPlan = preserver.continueFromCheckpoint(checkpointId, multipleFailures);

      expect(continuationPlan!.restartFromStep).toBe('initialization');
    });
  });
});

afterEach(() => {
  jest.clearAllTimers();
});