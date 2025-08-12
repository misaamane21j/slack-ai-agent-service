/**
 * Recovery Strategy system for handling error recovery and resilience
 */

import { EnhancedErrorContext, ProcessingStage, OperationPhase } from '../context/ErrorContext';
import { ErrorSeverity } from '../types';

export enum RecoveryStrategyType {
  RETRY = 'RETRY',
  FALLBACK = 'FALLBACK',
  CIRCUIT_BREAKER = 'CIRCUIT_BREAKER',
  GRACEFUL_DEGRADATION = 'GRACEFUL_DEGRADATION',
  USER_NOTIFICATION = 'USER_NOTIFICATION',
  ESCALATION = 'ESCALATION'
}

export enum RecoveryResult {
  SUCCESS = 'SUCCESS',
  PARTIAL_SUCCESS = 'PARTIAL_SUCCESS',
  FAILED = 'FAILED',
  NEEDS_ESCALATION = 'NEEDS_ESCALATION',
  REQUIRES_USER_INPUT = 'REQUIRES_USER_INPUT'
}

export interface RecoveryAttempt {
  strategyType: RecoveryStrategyType;
  timestamp: Date;
  result: RecoveryResult;
  details?: string;
  nextStrategy?: RecoveryStrategyType;
}

export interface RecoveryContext {
  originalError: Error;
  errorContext: EnhancedErrorContext;
  attempts: RecoveryAttempt[];
  maxAttempts: number;
  timeoutMs: number;
  preservedState?: Record<string, unknown>;
}

/**
 * Abstract base class for all recovery strategies
 */
export abstract class RecoveryStrategy {
  protected strategyType: RecoveryStrategyType;
  protected name: string;
  protected description: string;

  constructor(strategyType: RecoveryStrategyType, name: string, description: string) {
    this.strategyType = strategyType;
    this.name = name;
    this.description = description;
  }

  /**
   * Determine if this strategy can handle the given error context
   */
  abstract canHandle(context: RecoveryContext): boolean;

  /**
   * Execute the recovery strategy
   */
  abstract execute(context: RecoveryContext): Promise<RecoveryResult>;

  /**
   * Estimate the time this recovery might take
   */
  abstract estimateRecoveryTime(context: RecoveryContext): number;

  /**
   * Get the priority of this strategy (higher number = higher priority)
   */
  abstract getPriority(context: RecoveryContext): number;

  /**
   * Get user-friendly description of what this strategy will attempt
   */
  getUserDescription(context: RecoveryContext): string {
    return this.description;
  }

  /**
   * Check if strategy should be attempted based on previous attempts
   */
  shouldAttempt(context: RecoveryContext): boolean {
    const previousAttempts = context.attempts.filter(a => a.strategyType === this.strategyType);
    return previousAttempts.length < this.getMaxAttempts(context);
  }

  /**
   * Get maximum attempts allowed for this strategy
   */
  protected getMaxAttempts(context: RecoveryContext): number {
    return 1; // Default to single attempt, override in subclasses
  }

  /**
   * Record a recovery attempt
   */
  protected recordAttempt(context: RecoveryContext, result: RecoveryResult, details?: string): void {
    const attempt: RecoveryAttempt = {
      strategyType: this.strategyType,
      timestamp: new Date(),
      result,
      details
    };
    context.attempts.push(attempt);
  }
}

/**
 * Retry strategy with exponential backoff
 */
export class RetryStrategy extends RecoveryStrategy {
  private baseDelayMs: number;
  private maxDelayMs: number;
  private jitterFactor: number;

  constructor(baseDelayMs = 1000, maxDelayMs = 30000, jitterFactor = 0.1) {
    super(RecoveryStrategyType.RETRY, 'Retry', 'Retry the failed operation with exponential backoff');
    this.baseDelayMs = baseDelayMs;
    this.maxDelayMs = maxDelayMs;
    this.jitterFactor = jitterFactor;
  }

  canHandle(context: RecoveryContext): boolean {
    // Can retry if error context indicates retryable operation
    const retryablePhases = [
      OperationPhase.TOOL_DISCOVERY,
      OperationPhase.TOOL_INVOCATION,
      OperationPhase.RESULT_PROCESSING
    ];

    const retryableStages = [
      ProcessingStage.AI_PROCESSING,
      ProcessingStage.TOOL_EXECUTION,
      ProcessingStage.RESULT_VALIDATION
    ];

    const operation = context.errorContext.operation;
    const execution = context.errorContext.executionState;

    return operation && retryablePhases.includes(operation.phase) ||
           retryableStages.includes(execution.processingStage);
  }

  async execute(context: RecoveryContext): Promise<RecoveryResult> {
    const attemptCount = context.attempts.filter(a => a.strategyType === this.strategyType).length;
    
    if (attemptCount >= this.getMaxAttempts(context)) {
      this.recordAttempt(context, RecoveryResult.FAILED, 'Maximum retry attempts exceeded');
      return RecoveryResult.FAILED;
    }

    // Calculate delay with exponential backoff and jitter
    const delay = this.calculateDelay(attemptCount);
    
    try {
      await this.sleep(delay);
      
      // Here would be the actual retry logic - for now we simulate
      // In real implementation, this would re-invoke the failed operation
      const success = Math.random() > 0.3; // Simulate 70% success rate
      
      if (success) {
        this.recordAttempt(context, RecoveryResult.SUCCESS, `Retry successful after ${delay}ms delay`);
        return RecoveryResult.SUCCESS;
      } else {
        this.recordAttempt(context, RecoveryResult.FAILED, `Retry failed after ${delay}ms delay`);
        return RecoveryResult.FAILED;
      }
    } catch (error) {
      this.recordAttempt(context, RecoveryResult.FAILED, `Retry threw error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return RecoveryResult.FAILED;
    }
  }

  estimateRecoveryTime(context: RecoveryContext): number {
    const attemptCount = context.attempts.filter(a => a.strategyType === this.strategyType).length;
    return this.calculateDelay(attemptCount);
  }

  getPriority(context: RecoveryContext): number {
    // Higher priority for transient errors, lower for persistent ones
    const attemptCount = context.attempts.length;
    return Math.max(10 - attemptCount * 2, 1);
  }

  protected getMaxAttempts(context: RecoveryContext): number {
    // Adjust based on error severity
    switch (context.errorContext.severity) {
      case ErrorSeverity.LOW:
        return 5;
      case ErrorSeverity.MEDIUM:
        return 3;
      case ErrorSeverity.HIGH:
        return 2;
      case ErrorSeverity.CRITICAL:
        return 1;
      default:
        return 3;
    }
  }

  private calculateDelay(attemptCount: number): number {
    const exponentialDelay = Math.min(this.baseDelayMs * Math.pow(2, attemptCount), this.maxDelayMs);
    const jitter = exponentialDelay * this.jitterFactor * Math.random();
    return Math.round(exponentialDelay + jitter);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Fallback strategy to alternative tools or operations
 */
export class FallbackStrategy extends RecoveryStrategy {
  private fallbackOptions: Map<string, string[]>;

  constructor(fallbackOptions?: Map<string, string[]>) {
    super(RecoveryStrategyType.FALLBACK, 'Fallback', 'Switch to alternative tool or method');
    this.fallbackOptions = fallbackOptions || new Map();
    this.setupDefaultFallbacks();
  }

  canHandle(context: RecoveryContext): boolean {
    const toolName = context.errorContext.tool?.toolName;
    const serverId = context.errorContext.tool?.serverId;
    
    return (toolName && this.fallbackOptions.has(toolName)) ||
           (serverId && this.fallbackOptions.has(serverId)) ||
           context.errorContext.userIntent?.fallbackOptions !== undefined;
  }

  async execute(context: RecoveryContext): Promise<RecoveryResult> {
    const toolName = context.errorContext.tool?.toolName;
    const serverId = context.errorContext.tool?.serverId;
    
    let fallbacks: string[] = [];
    
    // Check for user intent fallbacks first
    if (context.errorContext.userIntent?.fallbackOptions) {
      fallbacks = context.errorContext.userIntent.fallbackOptions;
    }
    // Then check tool-specific fallbacks
    else if (toolName && this.fallbackOptions.has(toolName)) {
      fallbacks = this.fallbackOptions.get(toolName)!;
    }
    // Finally check server-specific fallbacks
    else if (serverId && this.fallbackOptions.has(serverId)) {
      fallbacks = this.fallbackOptions.get(serverId)!;
    }

    if (fallbacks.length === 0) {
      this.recordAttempt(context, RecoveryResult.FAILED, 'No fallback options available');
      return RecoveryResult.FAILED;
    }

    // Try the first available fallback option
    const fallbackOption = fallbacks[0];
    
    try {
      // In real implementation, this would attempt the fallback operation
      // For now, we simulate the fallback attempt
      const success = Math.random() > 0.2; // Simulate 80% success rate for fallbacks
      
      if (success) {
        this.recordAttempt(context, RecoveryResult.SUCCESS, `Fallback to '${fallbackOption}' successful`);
        return RecoveryResult.SUCCESS;
      } else {
        this.recordAttempt(context, RecoveryResult.PARTIAL_SUCCESS, `Fallback to '${fallbackOption}' partially successful`);
        return RecoveryResult.PARTIAL_SUCCESS;
      }
    } catch (error) {
      this.recordAttempt(context, RecoveryResult.FAILED, `Fallback to '${fallbackOption}' failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return RecoveryResult.FAILED;
    }
  }

  estimateRecoveryTime(context: RecoveryContext): number {
    // Fallbacks typically take longer as they involve different tools
    return 5000; // 5 seconds estimate
  }

  getPriority(context: RecoveryContext): number {
    // Medium priority - try after quick retries but before more complex strategies
    return 5;
  }

  private setupDefaultFallbacks(): void {
    // Default fallback mappings for common tools
    this.fallbackOptions.set('jenkins_trigger_job', ['jenkins_manual_build', 'notification_only']);
    this.fallbackOptions.set('database_query', ['cached_result', 'manual_lookup']);
    this.fallbackOptions.set('github_create_issue', ['email_notification', 'slack_reminder']);
  }
}

/**
 * Circuit breaker strategy to prevent cascading failures
 */
export class CircuitBreakerStrategy extends RecoveryStrategy {
  private circuitState: Map<string, { failures: number; lastFailure: Date; state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' }>;
  private failureThreshold: number;
  private recoveryTimeMs: number;

  constructor(failureThreshold = 5, recoveryTimeMs = 60000) {
    super(RecoveryStrategyType.CIRCUIT_BREAKER, 'Circuit Breaker', 'Temporarily disable failing services');
    this.circuitState = new Map();
    this.failureThreshold = failureThreshold;
    this.recoveryTimeMs = recoveryTimeMs;
  }

  canHandle(context: RecoveryContext): boolean {
    // Can handle any tool-related failure
    return context.errorContext.tool !== undefined;
  }

  async execute(context: RecoveryContext): Promise<RecoveryResult> {
    const serviceKey = this.getServiceKey(context);
    const circuitInfo = this.getCircuitInfo(serviceKey);
    
    const now = new Date();
    
    switch (circuitInfo.state) {
      case 'CLOSED':
        // Normal operation, but increment failure count
        circuitInfo.failures++;
        circuitInfo.lastFailure = now;
        
        if (circuitInfo.failures >= this.failureThreshold) {
          circuitInfo.state = 'OPEN';
          this.recordAttempt(context, RecoveryResult.FAILED, `Circuit breaker opened for ${serviceKey} after ${circuitInfo.failures} failures`);
          return RecoveryResult.NEEDS_ESCALATION;
        }
        
        this.recordAttempt(context, RecoveryResult.PARTIAL_SUCCESS, `Circuit breaker recorded failure ${circuitInfo.failures}/${this.failureThreshold} for ${serviceKey}`);
        return RecoveryResult.PARTIAL_SUCCESS;
        
      case 'OPEN':
        // Circuit is open, check if enough time has passed to try half-open
        const timeSinceFailure = now.getTime() - circuitInfo.lastFailure.getTime();
        
        if (timeSinceFailure >= this.recoveryTimeMs) {
          circuitInfo.state = 'HALF_OPEN';
          this.recordAttempt(context, RecoveryResult.PARTIAL_SUCCESS, `Circuit breaker moving to half-open for ${serviceKey}`);
          return RecoveryResult.REQUIRES_USER_INPUT;
        }
        
        this.recordAttempt(context, RecoveryResult.FAILED, `Circuit breaker open for ${serviceKey}, ${Math.ceil((this.recoveryTimeMs - timeSinceFailure) / 1000)}s remaining`);
        return RecoveryResult.FAILED;
        
      case 'HALF_OPEN':
        // Allow limited testing - if this fails, go back to open
        // If it succeeds, close the circuit
        const testSuccess = Math.random() > 0.4; // Simulate 60% success in half-open state
        
        if (testSuccess) {
          circuitInfo.state = 'CLOSED';
          circuitInfo.failures = 0;
          this.recordAttempt(context, RecoveryResult.SUCCESS, `Circuit breaker closed for ${serviceKey} - service recovered`);
          return RecoveryResult.SUCCESS;
        } else {
          circuitInfo.state = 'OPEN';
          circuitInfo.lastFailure = now;
          this.recordAttempt(context, RecoveryResult.FAILED, `Circuit breaker reopened for ${serviceKey} - service still failing`);
          return RecoveryResult.FAILED;
        }
        
      default:
        return RecoveryResult.FAILED;
    }
  }

  estimateRecoveryTime(context: RecoveryContext): number {
    const serviceKey = this.getServiceKey(context);
    const circuitInfo = this.getCircuitInfo(serviceKey);
    
    if (circuitInfo.state === 'OPEN') {
      const timeSinceFailure = Date.now() - circuitInfo.lastFailure.getTime();
      return Math.max(this.recoveryTimeMs - timeSinceFailure, 0);
    }
    
    return 1000; // Quick check for closed or half-open states
  }

  getPriority(context: RecoveryContext): number {
    // High priority for preventing cascading failures
    return 8;
  }

  private getServiceKey(context: RecoveryContext): string {
    const tool = context.errorContext.tool;
    return tool ? `${tool.serverId}:${tool.toolName}` : 'unknown';
  }

  private getCircuitInfo(serviceKey: string) {
    if (!this.circuitState.has(serviceKey)) {
      this.circuitState.set(serviceKey, {
        failures: 0,
        lastFailure: new Date(),
        state: 'CLOSED'
      });
    }
    return this.circuitState.get(serviceKey)!;
  }
}

/**
 * Recovery strategy manager that coordinates multiple strategies
 */
export class RecoveryStrategyManager {
  private strategies: RecoveryStrategy[];

  constructor() {
    this.strategies = [
      new RetryStrategy(),
      new FallbackStrategy(),
      new CircuitBreakerStrategy()
    ];
  }

  addStrategy(strategy: RecoveryStrategy): void {
    this.strategies.push(strategy);
  }

  removeStrategy(strategyType: RecoveryStrategyType): void {
    this.strategies = this.strategies.filter(s => s['strategyType'] !== strategyType);
  }

  /**
   * Find all applicable strategies for a given error context
   */
  getApplicableStrategies(context: RecoveryContext): RecoveryStrategy[] {
    return this.strategies
      .filter(strategy => strategy.canHandle(context) && strategy.shouldAttempt(context))
      .sort((a, b) => b.getPriority(context) - a.getPriority(context));
  }

  /**
   * Execute recovery strategies in priority order until one succeeds
   */
  async executeRecovery(context: RecoveryContext): Promise<RecoveryResult> {
    const applicableStrategies = this.getApplicableStrategies(context);
    
    if (applicableStrategies.length === 0) {
      return RecoveryResult.NEEDS_ESCALATION;
    }

    for (const strategy of applicableStrategies) {
      try {
        const result = await strategy.execute(context);
        
        if (result === RecoveryResult.SUCCESS) {
          return result;
        }
        
        // Continue trying other strategies unless escalation is needed
        if (result === RecoveryResult.NEEDS_ESCALATION) {
          return result;
        }
        
      } catch (error) {
        // Log strategy failure but continue with next strategy
        console.error(`Recovery strategy ${strategy.constructor.name} failed:`, error);
      }
    }

    return RecoveryResult.FAILED;
  }

  /**
   * Get estimated total recovery time for all applicable strategies
   */
  estimateTotalRecoveryTime(context: RecoveryContext): number {
    const strategies = this.getApplicableStrategies(context);
    return strategies.reduce((total, strategy) => {
      return total + strategy.estimateRecoveryTime(context);
    }, 0);
  }
}