/**
 * Context preservation mechanisms to maintain user state during error recovery
 */

import { EnhancedErrorContext, ProcessingStage, OperationPhase } from './ErrorContext';
import { RecoveryAttempt, RecoveryResult } from '../recovery/RecoveryStrategy';

export interface PreservedState {
  id: string;
  timestamp: Date;
  expiresAt: Date;
  errorContext: EnhancedErrorContext;
  userState: UserState;
  operationState: OperationState;
  systemState: SystemState;
  metadata: StateMetadata;
}

export interface UserState {
  conversationId: string;
  threadId?: string;
  userId: string;
  originalMessage: string;
  parsedIntent: string;
  confidence: number;
  fallbackOptions?: string[];
  userPreferences?: Record<string, unknown>;
  sessionData?: Record<string, unknown>;
}

export interface OperationState {
  operationId: string;
  stage: ProcessingStage;
  phase?: OperationPhase;
  completedSteps: string[];
  failedStep?: string;
  partialResults: Record<string, unknown>;
  toolSelections: ToolSelection[];
  retryCount: number;
  maxRetries: number;
}

export interface ToolSelection {
  serverId: string;
  toolName: string;
  parameters: Record<string, unknown>;
  confidence: number;
  fallbacks?: ToolSelection[];
  executionAttempts: number;
}

export interface SystemState {
  activeConnections: string[];
  resourcesAcquired: string[];
  temporaryData: Record<string, unknown>;
  cachingInfo?: CachingInfo;
  processingMetrics: ProcessingMetrics;
}

export interface CachingInfo {
  cacheKeys: string[];
  cacheHits: number;
  cacheMisses: number;
  invalidatedKeys?: string[];
}

export interface ProcessingMetrics {
  startTime: Date;
  processingDuration: number;
  memoryUsage: number;
  cpuUsage?: number;
  networkCalls: number;
}

export interface StateMetadata {
  version: number;
  preservationReason: PreservationReason;
  priority: PreservationPriority;
  tags: string[];
  relatedStates?: string[];
}

export enum PreservationReason {
  ERROR_RECOVERY = 'ERROR_RECOVERY',
  RETRY_ATTEMPT = 'RETRY_ATTEMPT',
  FALLBACK_PREPARATION = 'FALLBACK_PREPARATION',
  USER_REQUEST = 'USER_REQUEST',
  SYSTEM_MAINTENANCE = 'SYSTEM_MAINTENANCE'
}

export enum PreservationPriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL'
}

/**
 * Context preservation service for maintaining state during error recovery
 */
export class ContextPreserver {
  private preservedStates: Map<string, PreservedState>;
  private cleanupIntervals: Map<string, NodeJS.Timeout>;
  private maxStates: number;
  private defaultTtlMs: number;

  constructor(maxStates = 1000, defaultTtlMs = 30 * 60 * 1000) { // 30 minutes default
    this.preservedStates = new Map();
    this.cleanupIntervals = new Map();
    this.maxStates = maxStates;
    this.defaultTtlMs = defaultTtlMs;
    
    // Start periodic cleanup
    this.startPeriodicCleanup();
  }

  /**
   * Preserve current context state for recovery
   */
  preserve(
    errorContext: EnhancedErrorContext,
    userState: UserState,
    operationState: OperationState,
    systemState: SystemState,
    options: {
      ttlMs?: number;
      priority?: PreservationPriority;
      reason?: PreservationReason;
      tags?: string[];
    } = {}
  ): string {
    const stateId = this.generateStateId(errorContext);
    const now = new Date();
    const ttl = options.ttlMs || this.defaultTtlMs;
    const expiresAt = new Date(now.getTime() + ttl);

    const preservedState: PreservedState = {
      id: stateId,
      timestamp: now,
      expiresAt,
      errorContext,
      userState,
      operationState,
      systemState,
      metadata: {
        version: 1,
        preservationReason: options.reason || PreservationReason.ERROR_RECOVERY,
        priority: options.priority || PreservationPriority.MEDIUM,
        tags: options.tags || []
      }
    };

    // Check capacity and remove low priority states if needed
    if (this.preservedStates.size >= this.maxStates) {
      this.evictLowPriorityStates();
    }

    // Store the preserved state
    this.preservedStates.set(stateId, preservedState);

    // Schedule cleanup for this state
    this.scheduleCleanup(stateId, ttl);

    return stateId;
  }

  /**
   * Restore preserved context state
   */
  restore(stateId: string): PreservedState | null {
    const state = this.preservedStates.get(stateId);
    
    if (!state) {
      return null;
    }

    // Check if state has expired
    if (state.expiresAt.getTime() < Date.now()) {
      this.remove(stateId);
      return null;
    }

    // Update access time (for LRU if needed)
    state.metadata = {
      ...state.metadata,
      tags: [...state.metadata.tags, 'accessed']
    };

    return state;
  }

  /**
   * Update preserved state with new information
   */
  update(
    stateId: string,
    updates: {
      operationState?: Partial<OperationState>;
      systemState?: Partial<SystemState>;
      userState?: Partial<UserState>;
      metadata?: Partial<StateMetadata>;
    }
  ): boolean {
    const state = this.preservedStates.get(stateId);
    
    if (!state || state.expiresAt.getTime() < Date.now()) {
      return false;
    }

    // Apply updates
    if (updates.operationState) {
      state.operationState = { ...state.operationState, ...updates.operationState };
    }
    
    if (updates.systemState) {
      state.systemState = { ...state.systemState, ...updates.systemState };
    }
    
    if (updates.userState) {
      state.userState = { ...state.userState, ...updates.userState };
    }
    
    if (updates.metadata) {
      state.metadata = { ...state.metadata, ...updates.metadata };
      state.metadata.version += 1;
    }

    return true;
  }

  /**
   * Remove preserved state
   */
  remove(stateId: string): boolean {
    const removed = this.preservedStates.delete(stateId);
    
    // Clear any scheduled cleanup
    const interval = this.cleanupIntervals.get(stateId);
    if (interval) {
      clearTimeout(interval);
      this.cleanupIntervals.delete(stateId);
    }

    return removed;
  }

  /**
   * Create a recovery checkpoint from current state
   */
  createCheckpoint(
    errorContext: EnhancedErrorContext,
    operationState: OperationState,
    reason: string = 'manual_checkpoint'
  ): string {
    const userState: UserState = {
      conversationId: errorContext.userIntent?.conversationId || 'unknown',
      threadId: errorContext.userIntent?.threadId,
      userId: errorContext.additionalContext?.userId as string || 'unknown',
      originalMessage: errorContext.userIntent?.originalMessage || '',
      parsedIntent: errorContext.userIntent?.parsedIntent || '',
      confidence: errorContext.userIntent?.confidence || 0,
      fallbackOptions: errorContext.userIntent?.fallbackOptions
    };

    const systemState: SystemState = {
      activeConnections: [],
      resourcesAcquired: operationState.completedSteps,
      temporaryData: errorContext.additionalContext || {},
      processingMetrics: {
        startTime: errorContext.operation?.startTime || errorContext.timestamp,
        processingDuration: errorContext.operation?.duration || 0,
        memoryUsage: errorContext.systemContext?.memoryUsage || 0,
        networkCalls: 0
      }
    };

    return this.preserve(errorContext, userState, operationState, systemState, {
      reason: PreservationReason.ERROR_RECOVERY,
      priority: PreservationPriority.HIGH,
      tags: ['checkpoint', reason]
    });
  }

  /**
   * Restore from recovery checkpoint and continue operation
   */
  continueFromCheckpoint(
    stateId: string,
    recoveryAttempts: RecoveryAttempt[]
  ): ContinuationPlan | null {
    const state = this.restore(stateId);
    
    if (!state) {
      return null;
    }

    // Analyze what can be continued vs what needs to be restarted
    const continuationPlan = this.analyzeContinuationOptions(state, recoveryAttempts);
    
    // Update state with recovery information
    this.update(stateId, {
      metadata: {
        tags: [...state.metadata.tags, 'continued', `attempts_${recoveryAttempts.length}`]
      }
    });

    return continuationPlan;
  }

  /**
   * Get all preserved states for a user/conversation
   */
  getStatesForUser(userId: string, conversationId?: string): PreservedState[] {
    const states: PreservedState[] = [];
    
    for (const state of this.preservedStates.values()) {
      if (state.userState.userId === userId) {
        if (!conversationId || state.userState.conversationId === conversationId) {
          if (state.expiresAt.getTime() > Date.now()) {
            states.push(state);
          }
        }
      }
    }
    
    return states.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * Clean up resources associated with a preserved state
   */
  cleanupResources(stateId: string): void {
    const state = this.preservedStates.get(stateId);
    
    if (!state) {
      return;
    }

    // Clean up system resources
    const systemState = state.systemState;
    
    // Clear cache entries
    if (systemState.cachingInfo?.invalidatedKeys) {
      // In a real implementation, this would clear cache entries
      console.log(`Would clear cache keys: ${systemState.cachingInfo.invalidatedKeys.join(', ')}`);
    }
    
    // Release temporary resources
    if (systemState.resourcesAcquired.length > 0) {
      console.log(`Would release resources: ${systemState.resourcesAcquired.join(', ')}`);
    }
    
    // Close active connections
    if (systemState.activeConnections.length > 0) {
      console.log(`Would close connections: ${systemState.activeConnections.join(', ')}`);
    }

    this.remove(stateId);
  }

  /**
   * Get preservation statistics
   */
  getStatistics(): PreservationStatistics {
    const now = Date.now();
    const states = Array.from(this.preservedStates.values());
    
    const activeStates = states.filter(s => s.expiresAt.getTime() > now);
    const expiredStates = states.filter(s => s.expiresAt.getTime() <= now);
    
    const priorityCounts = activeStates.reduce((counts, state) => {
      counts[state.metadata.priority] = (counts[state.metadata.priority] || 0) + 1;
      return counts;
    }, {} as Record<string, number>);

    const reasonCounts = activeStates.reduce((counts, state) => {
      counts[state.metadata.preservationReason] = (counts[state.metadata.preservationReason] || 0) + 1;
      return counts;
    }, {} as Record<string, number>);

    return {
      totalStates: states.length,
      activeStates: activeStates.length,
      expiredStates: expiredStates.length,
      priorityCounts,
      reasonCounts,
      memoryUsage: this.estimateMemoryUsage(),
      oldestState: activeStates.reduce((oldest, state) => 
        !oldest || state.timestamp.getTime() < oldest.timestamp.getTime() ? state : oldest, 
        null as PreservedState | null
      )?.timestamp
    };
  }

  private generateStateId(errorContext: EnhancedErrorContext): string {
    const timestamp = errorContext.timestamp.getTime().toString(36);
    const random = Math.random().toString(36).substr(2, 9);
    const correlation = errorContext.correlationId?.substr(-4) || 'xxxx';
    return `state_${timestamp}_${correlation}_${random}`;
  }

  private scheduleCleanup(stateId: string, ttlMs: number): void {
    const existingInterval = this.cleanupIntervals.get(stateId);
    if (existingInterval) {
      clearTimeout(existingInterval);
    }

    const interval = setTimeout(() => {
      this.cleanupResources(stateId);
    }, ttlMs);

    this.cleanupIntervals.set(stateId, interval);
  }

  private evictLowPriorityStates(): void {
    const states = Array.from(this.preservedStates.entries());
    
    // Sort by priority (low priority first) and age (oldest first)
    states.sort(([, a], [, b]) => {
      const priorityOrder = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
      const priorityDiff = priorityOrder[a.metadata.priority] - priorityOrder[b.metadata.priority];
      
      if (priorityDiff !== 0) {
        return priorityDiff;
      }
      
      return a.timestamp.getTime() - b.timestamp.getTime();
    });

    // Remove oldest low priority states
    const toRemove = Math.ceil(this.maxStates * 0.1); // Remove 10%
    for (let i = 0; i < toRemove && i < states.length; i++) {
      const [stateId] = states[i];
      this.cleanupResources(stateId);
    }
  }

  private startPeriodicCleanup(): void {
    // Clean up expired states every 5 minutes
    setInterval(() => {
      const now = Date.now();
      const expiredStates: string[] = [];
      
      for (const [stateId, state] of this.preservedStates) {
        if (state.expiresAt.getTime() <= now) {
          expiredStates.push(stateId);
        }
      }
      
      expiredStates.forEach(stateId => this.cleanupResources(stateId));
    }, 5 * 60 * 1000);
  }

  private analyzeContinuationOptions(
    state: PreservedState, 
    recoveryAttempts: RecoveryAttempt[]
  ): ContinuationPlan {
    const operationState = state.operationState;
    const lastFailedStep = operationState.failedStep;
    const completedSteps = operationState.completedSteps;
    
    // Determine what can be continued
    const continuableSteps = completedSteps.filter(step => 
      !this.isStepInvalidatedByFailure(step, lastFailedStep)
    );
    
    // Determine what needs to be restarted
    const restartFromStep = this.findRestartPoint(operationState, recoveryAttempts);
    
    return {
      stateId: state.id,
      canContinue: continuableSteps.length > 0,
      continuableSteps,
      restartFromStep,
      partialResults: operationState.partialResults,
      estimatedSavings: this.estimateTimeSavings(continuableSteps),
      risks: this.identifyRisks(state, recoveryAttempts)
    };
  }

  private isStepInvalidatedByFailure(step: string, failedStep?: string): boolean {
    // Define step dependencies - if a step depends on the failed step, it's invalidated
    const stepDependencies: Record<string, string[]> = {
      'result_processing': ['tool_execution'],
      'response_formatting': ['result_processing'],
      'delivery': ['response_formatting']
    };
    
    if (!failedStep) return false;
    
    return stepDependencies[step]?.includes(failedStep) || false;
  }

  private findRestartPoint(
    operationState: OperationState, 
    recoveryAttempts: RecoveryAttempt[]
  ): string {
    // If we have multiple failed recovery attempts, restart earlier
    const failedRecoveryCount = recoveryAttempts.filter(a => a.result === RecoveryResult.FAILED).length;
    
    if (failedRecoveryCount > 2) {
      return 'initialization'; // Restart from the beginning
    }
    
    if (operationState.failedStep) {
      return operationState.failedStep;
    }
    
    return 'tool_execution'; // Default restart point
  }

  private estimateTimeSavings(continuableSteps: string[]): number {
    // Estimate time savings based on completed steps
    const stepTimings: Record<string, number> = {
      'context_gathering': 2000,
      'ai_processing': 5000,
      'tool_discovery': 3000,
      'tool_selection': 1000,
      'validation': 1500
    };
    
    return continuableSteps.reduce((savings, step) => {
      return savings + (stepTimings[step] || 1000);
    }, 0);
  }

  private identifyRisks(state: PreservedState, recoveryAttempts: RecoveryAttempt[]): string[] {
    const risks: string[] = [];
    
    // Stale data risk
    const stateAge = Date.now() - state.timestamp.getTime();
    if (stateAge > 10 * 60 * 1000) { // 10 minutes
      risks.push('Preserved state may be stale');
    }
    
    // Multiple failure risk
    const failedAttempts = recoveryAttempts.filter(a => a.result === RecoveryResult.FAILED);
    if (failedAttempts.length > 1) {
      risks.push('Multiple recovery attempts have failed');
    }
    
    // Data consistency risk
    if (state.operationState.partialResults && Object.keys(state.operationState.partialResults).length > 0) {
      risks.push('Partial results may be inconsistent');
    }
    
    return risks;
  }

  private estimateMemoryUsage(): number {
    // Rough estimate of memory usage
    let totalSize = 0;
    
    for (const state of this.preservedStates.values()) {
      // Estimate size of JSON serialization
      totalSize += JSON.stringify(state).length * 2; // Rough Unicode factor
    }
    
    return totalSize;
  }
}

export interface ContinuationPlan {
  stateId: string;
  canContinue: boolean;
  continuableSteps: string[];
  restartFromStep: string;
  partialResults: Record<string, unknown>;
  estimatedSavings: number; // milliseconds
  risks: string[];
}

export interface PreservationStatistics {
  totalStates: number;
  activeStates: number;
  expiredStates: number;
  priorityCounts: Record<string, number>;
  reasonCounts: Record<string, number>;
  memoryUsage: number;
  oldestState?: Date;
}