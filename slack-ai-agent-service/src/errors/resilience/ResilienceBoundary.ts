/**
 * Resilience Boundary Integration
 * Integrates comprehensive resilience patterns with the Error Boundary system
 */

import { EnhancedErrorContext } from '../context/ErrorContext';
import { ErrorBoundary, BoundaryType, BoundaryState, BoundaryResult, BoundaryConfig } from '../boundaries/ErrorBoundary';
import { ResilienceOrchestrator, ResilienceConfig, ResilienceResult, OperationDefinition } from './ResilienceOrchestrator';
import { RecoveryStrategyManager } from '../recovery/RecoveryStrategy';
import { ContextPreserver } from '../context/ContextPreserver';

export interface ResilienceBoundaryConfig extends BoundaryConfig {
  resilience: Partial<ResilienceConfig>;
  enableResilienceOrchestration: boolean;
  fallbackToOrchestrator: boolean;
  shareMetricsWithOrchestrator: boolean;
}

export interface ResilienceBoundaryResult<T = any> extends BoundaryResult<T> {
  resilienceResult?: ResilienceResult<T>;
  orchestratorUsed: boolean;
  patternsUsed: string[];
  executionPath: Array<{
    component: 'boundary' | 'orchestrator';
    action: string;
    timestamp: Date;
    success: boolean;
  }>;
}

/**
 * Enhanced Error Boundary that integrates with the Resilience Orchestrator
 * Provides both boundary isolation and comprehensive resilience patterns
 */
export class ResilienceBoundary extends ErrorBoundary {
  private resilenceOrchestrator: ResilienceOrchestrator;
  private resilienceConfig: ResilienceBoundaryConfig;
  private orchestratorUsageCount: number = 0;
  private boundaryUsageCount: number = 0;

  constructor(
    boundaryType: BoundaryType,
    config: Partial<ResilienceBoundaryConfig> = {},
    recoveryManager?: RecoveryStrategyManager,
    contextPreserver?: ContextPreserver
  ) {
    const boundaryConfig = {
      maxErrorsBeforeDegradation: 3,
      maxErrorsBeforeIsolation: 5,
      recoveryTimeoutMs: 30000,
      isolationDurationMs: 300000,
      enableAutoRecovery: true,
      escalationThreshold: 10,
      resilience: {},
      enableResilienceOrchestration: true,
      fallbackToOrchestrator: true,
      shareMetricsWithOrchestrator: true,
      ...config
    };

    super(boundaryType, boundaryConfig, recoveryManager, contextPreserver);
    
    this.resilienceConfig = boundaryConfig;
    this.resilenceOrchestrator = new ResilienceOrchestrator(this.resilienceConfig.resilience);
  }

  /**
   * Enhanced execute method that coordinates between boundary and orchestrator
   */
  async executeWithResilience<T>(
    operation: (signal?: AbortSignal) => Promise<T>,
    operationDef: OperationDefinition,
    context: EnhancedErrorContext,
    fallbackOperation?: () => Promise<T>
  ): Promise<ResilienceBoundaryResult<T>> {
    const executionPath: ResilienceBoundaryResult<T>['executionPath'] = [];
    const startTime = Date.now();

    // Determine execution strategy based on boundary state and configuration
    const strategy = this.determineExecutionStrategy(operationDef);
    
    switch (strategy) {
      case 'orchestrator_first':
        return await this.executeOrchestratorFirst(operation, operationDef, context, fallbackOperation, executionPath);
      
      case 'boundary_first':
        return await this.executeBoundaryFirst(operation, operationDef, context, fallbackOperation, executionPath);
      
      case 'hybrid':
        return await this.executeHybridStrategy(operation, operationDef, context, fallbackOperation, executionPath);
      
      default:
        return await this.executeOrchestratorFirst(operation, operationDef, context, fallbackOperation, executionPath);
    }
  }

  /**
   * Execute with orchestrator first strategy
   */
  private async executeOrchestratorFirst<T>(
    operation: (signal?: AbortSignal) => Promise<T>,
    operationDef: OperationDefinition,
    context: EnhancedErrorContext,
    fallbackOperation?: () => Promise<T>,
    executionPath: ResilienceBoundaryResult<T>['executionPath']
  ): Promise<ResilienceBoundaryResult<T>> {
    const stepStart = Date.now();
    
    try {
      // Try orchestrator first
      const resilienceResult = await this.resilenceOrchestrator.executeWithResilience(
        operation,
        operationDef,
        context
      );

      executionPath.push({
        component: 'orchestrator',
        action: 'execute_with_resilience',
        timestamp: new Date(),
        success: resilienceResult.success
      });

      this.orchestratorUsageCount++;

      if (resilienceResult.success) {
        // Update boundary metrics on success
        this.recordSuccess();
        
        return {
          success: true,
          result: resilienceResult.result,
          boundaryState: this.state,
          fallbackUsed: false,
          isolationTriggered: false,
          resilienceResult,
          orchestratorUsed: true,
          patternsUsed: resilienceResult.patternsUsed,
          executionPath
        };
      } else {
        // Orchestrator failed, try boundary fallback if enabled
        if (this.resilienceConfig.fallbackToOrchestrator && fallbackOperation) {
          return await this.executeBoundaryFallback(
            fallbackOperation,
            context,
            resilienceResult.error,
            executionPath,
            resilienceResult
          );
        }

        // No fallback, return orchestrator result
        this.recordError(resilienceResult.error || new Error('Orchestrator execution failed'));
        this.updateBoundaryState();

        return {
          success: false,
          error: resilienceResult.error,
          boundaryState: this.state,
          fallbackUsed: false,
          isolationTriggered: this.state === BoundaryState.ISOLATED,
          resilienceResult,
          orchestratorUsed: true,
          patternsUsed: resilienceResult.patternsUsed,
          executionPath
        };
      }

    } catch (error) {
      executionPath.push({
        component: 'orchestrator',
        action: 'execute_with_resilience',
        timestamp: new Date(),
        success: false
      });

      // Orchestrator threw an exception, try boundary fallback
      if (this.resilienceConfig.fallbackToOrchestrator && fallbackOperation) {
        return await this.executeBoundaryFallback(
          fallbackOperation,
          context,
          error as Error,
          executionPath
        );
      }

      throw error;
    }
  }

  /**
   * Execute with boundary first strategy
   */
  private async executeBoundaryFirst<T>(
    operation: (signal?: AbortSignal) => Promise<T>,
    operationDef: OperationDefinition,
    context: EnhancedErrorContext,
    fallbackOperation?: () => Promise<T>,
    executionPath: ResilienceBoundaryResult<T>['executionPath']
  ): Promise<ResilienceBoundaryResult<T>> {
    const stepStart = Date.now();
    
    try {
      // Wrap operation for boundary execution
      const boundaryOperation = () => operation();
      
      const boundaryResult = await super.execute(
        boundaryOperation,
        context,
        fallbackOperation
      );

      executionPath.push({
        component: 'boundary',
        action: 'execute',
        timestamp: new Date(),
        success: boundaryResult.success
      });

      this.boundaryUsageCount++;

      if (boundaryResult.success) {
        return {
          success: true,
          result: boundaryResult.result,
          boundaryState: boundaryResult.boundaryState,
          fallbackUsed: boundaryResult.fallbackUsed,
          isolationTriggered: boundaryResult.isolationTriggered,
          preservedStateId: boundaryResult.preservedStateId,
          orchestratorUsed: false,
          patternsUsed: ['error_boundary'],
          executionPath
        };
      } else {
        // Boundary failed, try orchestrator if enabled
        if (this.resilienceConfig.enableResilienceOrchestration) {
          return await this.executeOrchestratorFallback(
            operation,
            operationDef,
            context,
            boundaryResult.error,
            executionPath
          );
        }

        return {
          success: false,
          error: boundaryResult.error,
          boundaryState: boundaryResult.boundaryState,
          fallbackUsed: boundaryResult.fallbackUsed,
          isolationTriggered: boundaryResult.isolationTriggered,
          preservedStateId: boundaryResult.preservedStateId,
          orchestratorUsed: false,
          patternsUsed: ['error_boundary'],
          executionPath
        };
      }

    } catch (error) {
      executionPath.push({
        component: 'boundary',
        action: 'execute',
        timestamp: new Date(),
        success: false
      });

      // Boundary threw an exception, try orchestrator fallback
      if (this.resilienceConfig.enableResilienceOrchestration) {
        return await this.executeOrchestratorFallback(
          operation,
          operationDef,
          context,
          error as Error,
          executionPath
        );
      }

      throw error;
    }
  }

  /**
   * Execute with hybrid strategy (boundary for isolation, orchestrator for resilience)
   */
  private async executeHybridStrategy<T>(
    operation: (signal?: AbortSignal) => Promise<T>,
    operationDef: OperationDefinition,
    context: EnhancedErrorContext,
    fallbackOperation?: () => Promise<T>,
    executionPath: ResilienceBoundaryResult<T>['executionPath']
  ): Promise<ResilienceBoundaryResult<T>> {
    // Check if boundary is isolated first
    if (this.isIsolated()) {
      return await this.executeBoundaryFirst(operation, operationDef, context, fallbackOperation, executionPath);
    }

    // Wrap orchestrator execution within boundary
    const hybridOperation = async () => {
      const resilienceResult = await this.resilenceOrchestrator.executeWithResilience(
        operation,
        operationDef,
        context
      );

      executionPath.push({
        component: 'orchestrator',
        action: 'execute_with_resilience',
        timestamp: new Date(),
        success: resilienceResult.success
      });

      if (!resilienceResult.success) {
        throw resilienceResult.error || new Error('Orchestrator execution failed');
      }

      return {
        result: resilienceResult.result,
        resilienceResult,
        patternsUsed: resilienceResult.patternsUsed
      };
    };

    const boundaryResult = await super.execute(
      hybridOperation,
      context,
      fallbackOperation ? async () => {
        const fallbackRes = await fallbackOperation();
        return { result: fallbackRes, resilienceResult: undefined, patternsUsed: ['fallback'] };
      } : undefined
    );

    executionPath.push({
      component: 'boundary',
      action: 'execute_hybrid',
      timestamp: new Date(),
      success: boundaryResult.success
    });

    this.boundaryUsageCount++;
    this.orchestratorUsageCount++;

    const hybridData = boundaryResult.result as any;
    
    return {
      success: boundaryResult.success,
      result: hybridData?.result,
      error: boundaryResult.error,
      boundaryState: boundaryResult.boundaryState,
      fallbackUsed: boundaryResult.fallbackUsed,
      isolationTriggered: boundaryResult.isolationTriggered,
      preservedStateId: boundaryResult.preservedStateId,
      resilienceResult: hybridData?.resilienceResult,
      orchestratorUsed: true,
      patternsUsed: [...(hybridData?.patternsUsed || []), 'error_boundary'],
      executionPath
    };
  }

  /**
   * Execute boundary fallback when orchestrator fails
   */
  private async executeBoundaryFallback<T>(
    fallbackOperation: () => Promise<T>,
    context: EnhancedErrorContext,
    originalError?: Error,
    executionPath: ResilienceBoundaryResult<T>['executionPath'] = [],
    originalResilienceResult?: ResilienceResult<T>
  ): Promise<ResilienceBoundaryResult<T>> {
    const stepStart = Date.now();
    
    try {
      const boundaryResult = await super.execute(
        fallbackOperation,
        context
      );

      executionPath.push({
        component: 'boundary',
        action: 'execute_fallback',
        timestamp: new Date(),
        success: boundaryResult.success
      });

      this.boundaryUsageCount++;

      return {
        success: boundaryResult.success,
        result: boundaryResult.result,
        error: originalError || boundaryResult.error,
        boundaryState: boundaryResult.boundaryState,
        fallbackUsed: true,
        isolationTriggered: boundaryResult.isolationTriggered,
        preservedStateId: boundaryResult.preservedStateId,
        resilienceResult: originalResilienceResult,
        orchestratorUsed: true,
        patternsUsed: ['error_boundary', 'fallback'],
        executionPath
      };

    } catch (error) {
      executionPath.push({
        component: 'boundary',
        action: 'execute_fallback',
        timestamp: new Date(),
        success: false
      });

      return {
        success: false,
        error: error as Error,
        boundaryState: this.state,
        fallbackUsed: true,
        isolationTriggered: false,
        resilienceResult: originalResilienceResult,
        orchestratorUsed: true,
        patternsUsed: ['error_boundary', 'fallback'],
        executionPath
      };
    }
  }

  /**
   * Execute orchestrator fallback when boundary fails
   */
  private async executeOrchestratorFallback<T>(
    operation: (signal?: AbortSignal) => Promise<T>,
    operationDef: OperationDefinition,
    context: EnhancedErrorContext,
    originalError?: Error,
    executionPath: ResilienceBoundaryResult<T>['executionPath'] = []
  ): Promise<ResilienceBoundaryResult<T>> {
    const stepStart = Date.now();
    
    try {
      const resilienceResult = await this.resilenceOrchestrator.executeWithResilience(
        operation,
        operationDef,
        context
      );

      executionPath.push({
        component: 'orchestrator',
        action: 'execute_fallback',
        timestamp: new Date(),
        success: resilienceResult.success
      });

      this.orchestratorUsageCount++;

      return {
        success: resilienceResult.success,
        result: resilienceResult.result,
        error: originalError || resilienceResult.error,
        boundaryState: this.state,
        fallbackUsed: true,
        isolationTriggered: false,
        resilienceResult,
        orchestratorUsed: true,
        patternsUsed: [...resilienceResult.patternsUsed, 'orchestrator_fallback'],
        executionPath
      };

    } catch (error) {
      executionPath.push({
        component: 'orchestrator',
        action: 'execute_fallback',
        timestamp: new Date(),
        success: false
      });

      return {
        success: false,
        error: error as Error,
        boundaryState: this.state,
        fallbackUsed: true,
        isolationTriggered: false,
        orchestratorUsed: true,
        patternsUsed: ['orchestrator_fallback'],
        executionPath
      };
    }
  }

  /**
   * Determine optimal execution strategy
   */
  private determineExecutionStrategy(operationDef: OperationDefinition): 'orchestrator_first' | 'boundary_first' | 'hybrid' {
    // If boundary is isolated, use boundary first to respect isolation
    if (this.isIsolated()) {
      return 'boundary_first';
    }

    // If orchestration is disabled, use boundary only
    if (!this.resilienceConfig.enableResilienceOrchestration) {
      return 'boundary_first';
    }

    // For essential operations, use hybrid approach for maximum protection
    if (operationDef.essential) {
      return 'hybrid';
    }

    // If boundary has had many failures, prefer orchestrator
    if (this.metrics.errorCount >= this.config.maxErrorsBeforeDegradation) {
      return 'orchestrator_first';
    }

    // If orchestrator has been more successful recently, prefer it
    const orchestratorSuccessRate = this.orchestratorUsageCount > 0 
      ? this.orchestratorUsageCount / (this.orchestratorUsageCount + this.boundaryUsageCount)
      : 0.5;
    
    if (orchestratorSuccessRate > 0.7) {
      return 'orchestrator_first';
    }

    // Default to hybrid for balanced approach
    return 'hybrid';
  }

  /**
   * Legacy execute method for compatibility
   */
  async execute<T>(
    operation: () => Promise<T>,
    context: EnhancedErrorContext,
    fallbackOperation?: () => Promise<T>
  ): Promise<BoundaryResult<T>> {
    // Create operation definition for orchestrator
    const operationDef: OperationDefinition = {
      id: `boundary_${this.boundaryType}_${Date.now()}`,
      serviceName: this.boundaryType,
      action: 'execute',
      essential: this.boundaryType === BoundaryType.AI_PROCESSING || this.boundaryType === BoundaryType.TOOL_EXECUTION,
      timeoutMs: this.config.recoveryTimeoutMs
    };

    // Convert signal-aware operation to regular operation
    const signalAwareOperation = (signal?: AbortSignal) => operation();

    const result = await this.executeWithResilience(
      signalAwareOperation,
      operationDef,
      context,
      fallbackOperation
    );

    // Convert to legacy result format
    return {
      success: result.success,
      result: result.result,
      error: result.error,
      boundaryState: result.boundaryState,
      recoveryResult: result.resilienceResult?.backoffResult?.success ? 'SUCCESS' as any : 'FAILED' as any,
      preservedStateId: result.preservedStateId,
      fallbackUsed: result.fallbackUsed,
      isolationTriggered: result.isolationTriggered
    };
  }

  /**
   * Abstract method implementations for ErrorBoundary
   */
  protected shouldPreserveContext(context: EnhancedErrorContext): boolean {
    return context.operationType === 'tool_execution' || 
           context.operationType === 'ai_processing' ||
           this.boundaryType === BoundaryType.AI_PROCESSING ||
           this.boundaryType === BoundaryType.TOOL_EXECUTION;
  }

  protected preserveExecutionContext(context: EnhancedErrorContext): string {
    return this.contextPreserver.preserve(context, {
      preserveOperationState: true,
      preserveUserContext: true,
      preserveSystemState: this.boundaryType === BoundaryType.REGISTRY
    });
  }

  protected getFallbackOperation<T>(
    originalOperation: () => Promise<T>,
    context: EnhancedErrorContext
  ): (() => Promise<T>) | undefined {
    // Boundary-specific fallback logic based on type
    switch (this.boundaryType) {
      case BoundaryType.AI_PROCESSING:
        return async () => {
          return 'AI processing temporarily unavailable. Please try again.' as T;
        };
      
      case BoundaryType.TOOL_EXECUTION:
        return async () => {
          return 'Tool execution failed. Operation logged for retry.' as T;
        };
      
      case BoundaryType.SLACK_RESPONSE:
        return async () => {
          return 'I\'m experiencing technical difficulties. Please try your request again.' as T;
        };
      
      default:
        return undefined;
    }
  }

  /**
   * Get resilience orchestrator instance
   */
  getResilienceOrchestrator(): ResilienceOrchestrator {
    return this.resilenceOrchestrator;
  }

  /**
   * Get usage statistics
   */
  getUsageStats(): {
    orchestratorUsage: number;
    boundaryUsage: number;
    totalUsage: number;
    orchestratorSuccessRate: number;
  } {
    const total = this.orchestratorUsageCount + this.boundaryUsageCount;
    return {
      orchestratorUsage: this.orchestratorUsageCount,
      boundaryUsage: this.boundaryUsageCount,
      totalUsage: total,
      orchestratorSuccessRate: total > 0 ? this.orchestratorUsageCount / total : 0
    };
  }

  /**
   * Update resilience configuration
   */
  updateResilienceConfig(newConfig: Partial<ResilienceConfig>): void {
    this.resilenceOrchestrator.updateConfiguration(newConfig);
  }

  /**
   * Get comprehensive status including orchestrator
   */
  getComprehensiveStatus(): {
    boundary: {
      type: BoundaryType;
      state: BoundaryState;
      metrics: ReturnType<ErrorBoundary['getMetrics']>;
    };
    orchestrator: ReturnType<ResilienceOrchestrator['getResilienceStatus']>;
    usage: ReturnType<ResilienceBoundary['getUsageStats']>;
  } {
    return {
      boundary: {
        type: this.boundaryType,
        state: this.state,
        metrics: this.getMetrics()
      },
      orchestrator: this.resilenceOrchestrator.getResilienceStatus(),
      usage: this.getUsageStats()
    };
  }

  /**
   * Shutdown resilience boundary and cleanup resources
   */
  async shutdown(): Promise<void> {
    await this.resilenceOrchestrator.shutdown();
  }
}