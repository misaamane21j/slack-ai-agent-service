/**
 * Error Boundary system for MCP tool integration
 * Provides isolation patterns to prevent cascading failures
 */

import { EnhancedErrorContext } from '../context/ErrorContext';
import { RecoveryStrategyManager, RecoveryContext, RecoveryResult } from '../recovery/RecoveryStrategy';
import { ErrorImpactAssessment, ErrorImpactFactory } from '../impact/ErrorImpact';
import { ErrorMessageBuilder, ErrorMessageFactory } from '../messaging/ErrorMessageBuilder';
import { ContextPreserver } from '../context/ContextPreserver';

export enum BoundaryType {
  TOOL_EXECUTION = 'TOOL_EXECUTION',
  REGISTRY = 'REGISTRY',
  AI_PROCESSING = 'AI_PROCESSING',
  CONFIGURATION = 'CONFIGURATION',
  SLACK_RESPONSE = 'SLACK_RESPONSE'
}

export enum BoundaryState {
  HEALTHY = 'HEALTHY',
  DEGRADED = 'DEGRADED',
  FAILED = 'FAILED',
  ISOLATED = 'ISOLATED'
}

export interface BoundaryMetrics {
  errorCount: number;
  lastErrorTime?: Date;
  recoveryAttempts: number;
  successfulRecoveries: number;
  averageRecoveryTime: number;
  isolationCount: number;
}

export interface BoundaryConfig {
  maxErrorsBeforeDegradation: number;
  maxErrorsBeforeIsolation: number;
  recoveryTimeoutMs: number;
  isolationDurationMs: number;
  enableAutoRecovery: boolean;
  escalationThreshold: number;
}

export interface BoundaryResult<T = any> {
  success: boolean;
  result?: T;
  error?: Error;
  boundaryState: BoundaryState;
  recoveryResult?: RecoveryResult;
  preservedStateId?: string;
  fallbackUsed: boolean;
  isolationTriggered: boolean;
}

export abstract class ErrorBoundary {
  protected boundaryType: BoundaryType;
  protected state: BoundaryState = BoundaryState.HEALTHY;
  protected metrics: BoundaryMetrics = {
    errorCount: 0,
    recoveryAttempts: 0,
    successfulRecoveries: 0,
    averageRecoveryTime: 0,
    isolationCount: 0
  };
  protected config: BoundaryConfig;
  protected recoveryManager: RecoveryStrategyManager;
  protected contextPreserver: ContextPreserver;
  protected isolationEndTime?: Date;

  constructor(
    boundaryType: BoundaryType,
    config: Partial<BoundaryConfig> = {},
    recoveryManager?: RecoveryStrategyManager,
    contextPreserver?: ContextPreserver
  ) {
    this.boundaryType = boundaryType;
    this.config = {
      maxErrorsBeforeDegradation: 3,
      maxErrorsBeforeIsolation: 5,
      recoveryTimeoutMs: 30000,
      isolationDurationMs: 300000, // 5 minutes
      enableAutoRecovery: true,
      escalationThreshold: 10,
      ...config
    };
    this.recoveryManager = recoveryManager || new RecoveryStrategyManager();
    this.contextPreserver = contextPreserver || new ContextPreserver();
  }

  /**
   * Execute an operation within the error boundary
   */
  async execute<T>(
    operation: () => Promise<T>,
    context: EnhancedErrorContext,
    fallbackOperation?: () => Promise<T>
  ): Promise<BoundaryResult<T>> {
    // Check if boundary is isolated
    if (this.isIsolated()) {
      return this.handleIsolatedExecution(operation, context, fallbackOperation);
    }

    const startTime = Date.now();
    let preservedStateId: string | undefined;

    try {
      // Preserve context before execution
      if (this.shouldPreserveContext(context)) {
        preservedStateId = this.preserveExecutionContext(context);
      }

      // Execute the operation
      const result = await this.executeWithTimeout(operation, this.config.recoveryTimeoutMs);
      
      // Record successful execution
      this.recordSuccess();
      
      return {
        success: true,
        result,
        boundaryState: this.state,
        fallbackUsed: false,
        isolationTriggered: false,
        preservedStateId
      };

    } catch (error) {
      // Record the error
      this.recordError(error as Error);
      
      // Update boundary state
      this.updateBoundaryState();

      // Attempt recovery
      const recoveryResult = await this.attemptRecovery(
        error as Error,
        context,
        preservedStateId
      );

      // If recovery failed and fallback available, try fallback
      if (recoveryResult.result !== RecoveryResult.SUCCESS && fallbackOperation) {
        try {
          const fallbackResult = await this.executeWithTimeout(
            fallbackOperation,
            this.config.recoveryTimeoutMs
          );
          
          return {
            success: true,
            result: fallbackResult,
            error: error as Error,
            boundaryState: this.state,
            recoveryResult: recoveryResult.result,
            preservedStateId,
            fallbackUsed: true,
            isolationTriggered: this.state === BoundaryState.ISOLATED
          };
        } catch (fallbackError) {
          // Both primary and fallback failed
          return this.createFailureResult(
            error as Error,
            recoveryResult.result,
            preservedStateId,
            true
          );
        }
      }

      // Check if recovery was successful
      if (recoveryResult.result === RecoveryResult.SUCCESS && recoveryResult.recoveredData) {
        return {
          success: true,
          result: recoveryResult.recoveredData,
          error: error as Error,
          boundaryState: this.state,
          recoveryResult: recoveryResult.result,
          preservedStateId,
          fallbackUsed: false,
          isolationTriggered: this.state === BoundaryState.ISOLATED
        };
      }

      // Recovery failed
      return this.createFailureResult(
        error as Error,
        recoveryResult.result,
        preservedStateId,
        false
      );
    }
  }

  /**
   * Check if the boundary should preserve context before execution
   */
  protected abstract shouldPreserveContext(context: EnhancedErrorContext): boolean;

  /**
   * Preserve execution context specific to this boundary type
   */
  protected abstract preserveExecutionContext(context: EnhancedErrorContext): string;

  /**
   * Get boundary-specific fallback operation
   */
  protected abstract getFallbackOperation<T>(
    originalOperation: () => Promise<T>,
    context: EnhancedErrorContext
  ): (() => Promise<T>) | undefined;

  /**
   * Handle execution when boundary is isolated
   */
  protected async handleIsolatedExecution<T>(
    operation: () => Promise<T>,
    context: EnhancedErrorContext,
    fallbackOperation?: () => Promise<T>
  ): Promise<BoundaryResult<T>> {
    // Check if isolation period has ended
    if (this.isolationEndTime && Date.now() > this.isolationEndTime.getTime()) {
      this.state = BoundaryState.DEGRADED;
      this.isolationEndTime = undefined;
      return this.execute(operation, context, fallbackOperation);
    }

    // Try fallback if available
    if (fallbackOperation) {
      try {
        const result = await this.executeWithTimeout(
          fallbackOperation,
          this.config.recoveryTimeoutMs
        );
        
        return {
          success: true,
          result,
          boundaryState: this.state,
          fallbackUsed: true,
          isolationTriggered: false
        };
      } catch (error) {
        return this.createFailureResult(error as Error, RecoveryResult.FAILED, undefined, true);
      }
    }

    // No fallback available during isolation
    return this.createFailureResult(
      new Error(`${this.boundaryType} boundary is isolated`),
      RecoveryResult.FAILED,
      undefined,
      false
    );
  }

  /**
   * Execute operation with timeout
   */
  protected async executeWithTimeout<T>(
    operation: () => Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    return Promise.race([
      operation(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Operation timeout')), timeoutMs)
      )
    ]);
  }

  /**
   * Attempt recovery using the recovery strategy manager
   */
  protected async attemptRecovery(
    error: Error,
    context: EnhancedErrorContext,
    preservedStateId?: string
  ): Promise<{ result: RecoveryResult; recoveredData?: any }> {
    if (!this.config.enableAutoRecovery) {
      return { result: RecoveryResult.FAILED };
    }

    const recoveryContext: RecoveryContext = {
      originalError: error,
      errorContext: context,
      attempts: [],
      maxAttempts: 3,
      timeoutMs: this.config.recoveryTimeoutMs
    };

    this.metrics.recoveryAttempts++;
    const startTime = Date.now();

    try {
      const result = await this.recoveryManager.executeRecovery(recoveryContext);
      const recoveryTime = Date.now() - startTime;
      
      if (result === RecoveryResult.SUCCESS) {
        this.metrics.successfulRecoveries++;
        this.updateAverageRecoveryTime(recoveryTime);
        
        // Try to restore from preserved state if available
        if (preservedStateId) {
          const preservedState = this.contextPreserver.restore(preservedStateId);
          return { 
            result, 
            recoveredData: preservedState?.operationState.partialResults 
          };
        }
      }

      return { result };
    } catch (recoveryError) {
      return { result: RecoveryResult.FAILED };
    }
  }

  /**
   * Record successful execution
   */
  protected recordSuccess(): void {
    // Reset error count on success if not in failed state
    if (this.state !== BoundaryState.FAILED) {
      this.metrics.errorCount = 0;
      
      // Improve state if possible
      if (this.state === BoundaryState.DEGRADED && this.metrics.errorCount === 0) {
        this.state = BoundaryState.HEALTHY;
      }
    }
  }

  /**
   * Record error occurrence
   */
  protected recordError(error: Error): void {
    this.metrics.errorCount++;
    this.metrics.lastErrorTime = new Date();
  }

  /**
   * Update boundary state based on error count
   */
  protected updateBoundaryState(): void {
    if (this.metrics.errorCount >= this.config.maxErrorsBeforeIsolation) {
      this.state = BoundaryState.ISOLATED;
      this.metrics.isolationCount++;
      this.isolationEndTime = new Date(Date.now() + this.config.isolationDurationMs);
    } else if (this.metrics.errorCount >= this.config.maxErrorsBeforeDegradation) {
      this.state = BoundaryState.DEGRADED;
    } else if (this.metrics.errorCount >= this.config.escalationThreshold) {
      this.state = BoundaryState.FAILED;
    }
  }

  /**
   * Update average recovery time
   */
  protected updateAverageRecoveryTime(newRecoveryTime: number): void {
    if (this.metrics.successfulRecoveries === 1) {
      this.metrics.averageRecoveryTime = newRecoveryTime;
    } else {
      this.metrics.averageRecoveryTime = 
        (this.metrics.averageRecoveryTime * (this.metrics.successfulRecoveries - 1) + newRecoveryTime) /
        this.metrics.successfulRecoveries;
    }
  }

  /**
   * Create failure result
   */
  protected createFailureResult<T>(
    error: Error,
    recoveryResult?: RecoveryResult,
    preservedStateId?: string,
    fallbackUsed: boolean = false
  ): BoundaryResult<T> {
    return {
      success: false,
      error,
      boundaryState: this.state,
      recoveryResult,
      preservedStateId,
      fallbackUsed,
      isolationTriggered: this.state === BoundaryState.ISOLATED
    };
  }

  /**
   * Check if boundary is isolated
   */
  isIsolated(): boolean {
    return this.state === BoundaryState.ISOLATED && 
           this.isolationEndTime !== undefined && 
           Date.now() < this.isolationEndTime.getTime();
  }

  /**
   * Get current boundary state
   */
  getState(): BoundaryState {
    return this.state;
  }

  /**
   * Get boundary metrics
   */
  getMetrics(): BoundaryMetrics {
    return { ...this.metrics };
  }

  /**
   * Get boundary configuration
   */
  getConfig(): BoundaryConfig {
    return { ...this.config };
  }

  /**
   * Reset boundary to healthy state
   */
  reset(): void {
    this.state = BoundaryState.HEALTHY;
    this.metrics = {
      errorCount: 0,
      recoveryAttempts: 0,
      successfulRecoveries: 0,
      averageRecoveryTime: 0,
      isolationCount: 0
    };
    this.isolationEndTime = undefined;
  }

  /**
   * Force boundary into isolated state
   */
  isolate(durationMs?: number): void {
    this.state = BoundaryState.ISOLATED;
    this.metrics.isolationCount++;
    this.isolationEndTime = new Date(
      Date.now() + (durationMs || this.config.isolationDurationMs)
    );
  }
}