/**
 * Resilience Orchestrator
 * Coordinates all resilience patterns to provide comprehensive error handling and recovery
 */

import { EnhancedErrorContext } from '../context/ErrorContext';
import { CircuitBreaker, CircuitBreakerManager, CircuitBreakerResult, CircuitBreakerConfig } from './CircuitBreaker';
import { FallbackChain, FallbackResult, FallbackChainConfig, ToolCapability } from './FallbackChain';
import { GracefulDegradationManager, DegradationResult, DegradationLevel, FeatureConfig } from './GracefulDegradation';
import { ExponentialBackoffManager, BackoffResult, BackoffConfig, BackoffStrategy } from './ExponentialBackoff';
import { TimeoutManager, TimeoutResult, TimeoutConfig, ResourceHandle } from './TimeoutManager';

export interface ResilienceConfig {
  circuitBreaker: Partial<CircuitBreakerConfig>;
  fallbackChain: Partial<FallbackChainConfig>;
  backoff: Partial<BackoffConfig>;
  timeout: Partial<TimeoutConfig>;
  degradation: {
    enableAutoDegrade: boolean;
    degradationThresholds: {
      errorRate: number;
      responseTime: number;
      circuitOpenCount: number;
    };
  };
  coordination: {
    enableMetricsSharing: boolean;
    enableCrossPatternOptimization: boolean;
    healthCheckInterval: number;
  };
}

export interface ResilienceResult<T = any> {
  success: boolean;
  result?: T;
  error?: Error;
  patternsUsed: string[];
  executionPath: ExecutionStep[];
  finalStrategy: string;
  totalExecutionTime: number;
  circuitBreakerResult?: CircuitBreakerResult<T>;
  fallbackResult?: FallbackResult<T>;
  degradationResult?: DegradationResult<T>;
  backoffResult?: BackoffResult<T>;
  timeoutResult?: TimeoutResult<T>;
  metrics: ResilienceMetrics;
}

export interface ExecutionStep {
  pattern: string;
  action: string;
  timestamp: Date;
  duration: number;
  success: boolean;
  metadata?: Record<string, unknown>;
}

export interface ResilienceMetrics {
  circuitBreakersOpen: number;
  fallbacksUsed: number;
  currentDegradationLevel: DegradationLevel;
  averageResponseTime: number;
  successRate: number;
  resourcesActive: number;
  totalErrors: number;
}

export interface OperationDefinition {
  id: string;
  serviceName: string;
  action: string;
  userIntent?: string;
  essential: boolean;
  timeoutMs?: number;
  retryConfig?: Partial<BackoffConfig>;
  circuitBreakerConfig?: Partial<CircuitBreakerConfig>;
  featureConfig?: FeatureConfig;
}

export class ResilienceOrchestrator {
  private config: ResilienceConfig;
  private circuitBreakerManager: CircuitBreakerManager;
  private fallbackChain: FallbackChain;
  private degradationManager: GracefulDegradationManager;
  private backoffManager: ExponentialBackoffManager;
  private timeoutManager: TimeoutManager;
  
  private executionHistory: Array<{
    operationId: string;
    timestamp: Date;
    result: ResilienceResult;
  }> = [];
  
  private healthCheckInterval?: NodeJS.Timeout;
  private metrics: ResilienceMetrics = {
    circuitBreakersOpen: 0,
    fallbacksUsed: 0,
    currentDegradationLevel: DegradationLevel.FULL,
    averageResponseTime: 0,
    successRate: 1.0,
    resourcesActive: 0,
    totalErrors: 0
  };

  constructor(config: Partial<ResilienceConfig> = {}) {
    this.config = {
      circuitBreaker: {
        failureThreshold: 5,
        recoveryTimeout: 60000,
        successThreshold: 3,
        ...config.circuitBreaker
      },
      fallbackChain: {
        maxChainLength: 5,
        fallbackTimeout: 30000,
        enableEmergencyFallback: true,
        ...config.fallbackChain
      },
      backoff: {
        baseDelay: 1000,
        maxDelay: 30000,
        maxAttempts: 5,
        strategy: BackoffStrategy.EXPONENTIAL,
        ...config.backoff
      },
      timeout: {
        operationTimeout: 30000,
        globalTimeout: 300000,
        enableResourceTracking: true,
        ...config.timeout
      },
      degradation: {
        enableAutoDegrade: true,
        degradationThresholds: {
          errorRate: 0.3,
          responseTime: 10000,
          circuitOpenCount: 3
        },
        ...config.degradation
      },
      coordination: {
        enableMetricsSharing: true,
        enableCrossPatternOptimization: true,
        healthCheckInterval: 30000,
        ...config.coordination
      }
    };

    this.initializePatterns();
    this.startHealthMonitoring();
  }

  /**
   * Execute operation with comprehensive resilience patterns
   */
  async executeWithResilience<T>(
    operation: (signal?: AbortSignal) => Promise<T>,
    operationDef: OperationDefinition,
    context: EnhancedErrorContext
  ): Promise<ResilienceResult<T>> {
    const startTime = Date.now();
    const executionPath: ExecutionStep[] = [];
    const patternsUsed: string[] = [];

    try {
      // Check if system is degraded and operation should be handled differently
      const degradationLevel = this.degradationManager.getCurrentLevel();
      
      if (degradationLevel !== DegradationLevel.FULL) {
        return await this.executeWithDegradation(
          operation,
          operationDef,
          context,
          startTime,
          executionPath,
          patternsUsed
        );
      }

      // Normal execution path with full resilience
      return await this.executeFullResiliencePath(
        operation,
        operationDef,
        context,
        startTime,
        executionPath,
        patternsUsed
      );

    } catch (error) {
      // Final error handling
      const totalTime = Date.now() - startTime;
      this.updateErrorMetrics(error as Error);

      const result: ResilienceResult<T> = {
        success: false,
        error: error as Error,
        patternsUsed,
        executionPath,
        finalStrategy: 'error_fallback',
        totalExecutionTime: totalTime,
        metrics: { ...this.metrics }
      };

      this.recordExecution(operationDef.id, result);
      return result;
    }
  }

  /**
   * Execute with degradation handling
   */
  private async executeWithDegradation<T>(
    operation: (signal?: AbortSignal) => Promise<T>,
    operationDef: OperationDefinition,
    context: EnhancedErrorContext,
    startTime: number,
    executionPath: ExecutionStep[],
    patternsUsed: string[]
  ): Promise<ResilienceResult<T>> {
    const stepStart = Date.now();
    patternsUsed.push('graceful_degradation');

    try {
      const degradationResult = await this.degradationManager.executeWithDegradation(
        operationDef.action,
        () => operation(),
        context,
        operationDef.featureConfig
      );

      executionPath.push({
        pattern: 'graceful_degradation',
        action: 'execute_with_degradation',
        timestamp: new Date(),
        duration: Date.now() - stepStart,
        success: degradationResult.success
      });

      const totalTime = Date.now() - startTime;
      
      if (degradationResult.success) {
        this.updateSuccessMetrics(totalTime);
      } else {
        this.updateErrorMetrics(degradationResult.error || new Error('Degradation failed'));
      }

      const result: ResilienceResult<T> = {
        success: degradationResult.success,
        result: degradationResult.result,
        error: degradationResult.error,
        patternsUsed,
        executionPath,
        finalStrategy: 'graceful_degradation',
        totalExecutionTime: totalTime,
        degradationResult,
        metrics: { ...this.metrics }
      };

      this.recordExecution(operationDef.id, result);
      return result;

    } catch (error) {
      executionPath.push({
        pattern: 'graceful_degradation',
        action: 'execute_with_degradation',
        timestamp: new Date(),
        duration: Date.now() - stepStart,
        success: false
      });

      throw error;
    }
  }

  /**
   * Execute full resilience path
   */
  private async executeFullResiliencePath<T>(
    operation: (signal?: AbortSignal) => Promise<T>,
    operationDef: OperationDefinition,
    context: EnhancedErrorContext,
    startTime: number,
    executionPath: ExecutionStep[],
    patternsUsed: string[]
  ): Promise<ResilienceResult<T>> {
    // Determine execution strategy based on operation characteristics
    const strategy = this.determineExecutionStrategy(operationDef);
    
    switch (strategy) {
      case 'circuit_breaker_first':
        return await this.executeCircuitBreakerFirst(operation, operationDef, context, startTime, executionPath, patternsUsed);
      
      case 'timeout_with_fallback':
        return await this.executeTimeoutWithFallback(operation, operationDef, context, startTime, executionPath, patternsUsed);
      
      case 'backoff_retry':
        return await this.executeBackoffRetry(operation, operationDef, context, startTime, executionPath, patternsUsed);
      
      default:
        return await this.executeCircuitBreakerFirst(operation, operationDef, context, startTime, executionPath, patternsUsed);
    }
  }

  /**
   * Execute with circuit breaker first strategy
   */
  private async executeCircuitBreakerFirst<T>(
    operation: (signal?: AbortSignal) => Promise<T>,
    operationDef: OperationDefinition,
    context: EnhancedErrorContext,
    startTime: number,
    executionPath: ExecutionStep[],
    patternsUsed: string[]
  ): Promise<ResilienceResult<T>> {
    patternsUsed.push('circuit_breaker');
    
    // Wrap operation with timeout and backoff
    const wrappedOperation = async () => {
      return await this.timeoutManager.executeWithTimeout(
        `${operationDef.id}_timeout`,
        (signal) => {
          // Execute with exponential backoff
          return this.backoffManager.executeWithBackoff(
            operationDef.id,
            () => operation(signal),
            context,
            operationDef.retryConfig
          );
        },
        context,
        { 
          operationTimeout: operationDef.timeoutMs || this.config.timeout.operationTimeout,
          globalTimeout: this.config.timeout.globalTimeout 
        }
      );
    };

    // Create fallback operation
    const fallbackOperation = async () => {
      patternsUsed.push('fallback_chain');
      return await this.fallbackChain.executeWithFallback(
        operationDef.serviceName,
        operationDef.action,
        async (toolName, action) => {
          // Simplified fallback operation
          return `Fallback response for ${action} from ${toolName}`;
        },
        context,
        operationDef.userIntent
      );
    };

    const stepStart = Date.now();
    
    try {
      const circuitResult = await this.circuitBreakerManager.executeWithCircuitBreaker(
        operationDef.serviceName,
        wrappedOperation,
        context,
        fallbackOperation,
        operationDef.circuitBreakerConfig
      );

      executionPath.push({
        pattern: 'circuit_breaker',
        action: 'execute_with_circuit_breaker',
        timestamp: new Date(),
        duration: Date.now() - stepStart,
        success: circuitResult.success,
        metadata: {
          circuitState: circuitResult.circuitState,
          fromCache: circuitResult.fromCache
        }
      });

      const totalTime = Date.now() - startTime;
      
      if (circuitResult.success) {
        this.updateSuccessMetrics(totalTime);
      } else {
        this.updateErrorMetrics(circuitResult.error || new Error('Circuit breaker failed'));
      }

      const result: ResilienceResult<T> = {
        success: circuitResult.success,
        result: this.extractResultFromCircuitBreaker(circuitResult),
        error: circuitResult.error,
        patternsUsed,
        executionPath,
        finalStrategy: 'circuit_breaker_first',
        totalExecutionTime: totalTime,
        circuitBreakerResult: circuitResult,
        metrics: { ...this.metrics }
      };

      this.recordExecution(operationDef.id, result);
      return result;

    } catch (error) {
      executionPath.push({
        pattern: 'circuit_breaker',
        action: 'execute_with_circuit_breaker',
        timestamp: new Date(),
        duration: Date.now() - stepStart,
        success: false
      });

      throw error;
    }
  }

  /**
   * Execute with timeout and fallback strategy
   */
  private async executeTimeoutWithFallback<T>(
    operation: (signal?: AbortSignal) => Promise<T>,
    operationDef: OperationDefinition,
    context: EnhancedErrorContext,
    startTime: number,
    executionPath: ExecutionStep[],
    patternsUsed: string[]
  ): Promise<ResilienceResult<T>> {
    patternsUsed.push('timeout_manager', 'fallback_chain');
    
    const stepStart = Date.now();
    
    try {
      const timeoutResult = await this.timeoutManager.executeWithTimeout(
        operationDef.id,
        operation,
        context,
        { 
          operationTimeout: operationDef.timeoutMs || this.config.timeout.operationTimeout 
        }
      );

      executionPath.push({
        pattern: 'timeout_manager',
        action: 'execute_with_timeout',
        timestamp: new Date(),
        duration: Date.now() - stepStart,
        success: timeoutResult.success,
        metadata: {
          timedOut: timeoutResult.timedOut,
          resourcesCreated: timeoutResult.resourcesCreated
        }
      });

      if (timeoutResult.success) {
        const totalTime = Date.now() - startTime;
        this.updateSuccessMetrics(totalTime);

        const result: ResilienceResult<T> = {
          success: true,
          result: timeoutResult.result,
          patternsUsed,
          executionPath,
          finalStrategy: 'timeout_with_fallback',
          totalExecutionTime: totalTime,
          timeoutResult,
          metrics: { ...this.metrics }
        };

        this.recordExecution(operationDef.id, result);
        return result;
      } else {
        // Execute fallback chain
        return await this.executeFallbackChain(operationDef, context, startTime, executionPath, patternsUsed, timeoutResult.error);
      }

    } catch (error) {
      executionPath.push({
        pattern: 'timeout_manager',
        action: 'execute_with_timeout',
        timestamp: new Date(),
        duration: Date.now() - stepStart,
        success: false
      });

      return await this.executeFallbackChain(operationDef, context, startTime, executionPath, patternsUsed, error as Error);
    }
  }

  /**
   * Execute fallback chain
   */
  private async executeFallbackChain<T>(
    operationDef: OperationDefinition,
    context: EnhancedErrorContext,
    startTime: number,
    executionPath: ExecutionStep[],
    patternsUsed: string[],
    originalError?: Error
  ): Promise<ResilienceResult<T>> {
    const stepStart = Date.now();
    
    try {
      const fallbackResult = await this.fallbackChain.executeWithFallback(
        operationDef.serviceName,
        operationDef.action,
        async (toolName, action) => {
          return `Fallback response for ${action} from ${toolName}`;
        },
        context,
        operationDef.userIntent
      );

      executionPath.push({
        pattern: 'fallback_chain',
        action: 'execute_with_fallback',
        timestamp: new Date(),
        duration: Date.now() - stepStart,
        success: fallbackResult.success,
        metadata: {
          usedLevel: fallbackResult.usedLevel,
          emergencyFallbackUsed: fallbackResult.emergencyFallbackUsed
        }
      });

      const totalTime = Date.now() - startTime;
      
      if (fallbackResult.success) {
        this.updateSuccessMetrics(totalTime);
      } else {
        this.updateErrorMetrics(fallbackResult.error || originalError || new Error('Fallback failed'));
      }

      const result: ResilienceResult<T> = {
        success: fallbackResult.success,
        result: fallbackResult.result,
        error: fallbackResult.error || originalError,
        patternsUsed,
        executionPath,
        finalStrategy: 'fallback_chain',
        totalExecutionTime: totalTime,
        fallbackResult,
        metrics: { ...this.metrics }
      };

      this.recordExecution(operationDef.id, result);
      return result;

    } catch (error) {
      executionPath.push({
        pattern: 'fallback_chain',
        action: 'execute_with_fallback',
        timestamp: new Date(),
        duration: Date.now() - stepStart,
        success: false
      });

      throw error;
    }
  }

  /**
   * Execute with backoff retry strategy
   */
  private async executeBackoffRetry<T>(
    operation: (signal?: AbortSignal) => Promise<T>,
    operationDef: OperationDefinition,
    context: EnhancedErrorContext,
    startTime: number,
    executionPath: ExecutionStep[],
    patternsUsed: string[]
  ): Promise<ResilienceResult<T>> {
    patternsUsed.push('exponential_backoff');
    
    const stepStart = Date.now();
    
    try {
      const backoffResult = await this.backoffManager.executeWithBackoff(
        operationDef.id,
        () => operation(),
        context,
        operationDef.retryConfig
      );

      executionPath.push({
        pattern: 'exponential_backoff',
        action: 'execute_with_backoff',
        timestamp: new Date(),
        duration: Date.now() - stepStart,
        success: backoffResult.success,
        metadata: {
          attempts: backoffResult.attempts,
          strategyUsed: backoffResult.strategyUsed
        }
      });

      const totalTime = Date.now() - startTime;
      
      if (backoffResult.success) {
        this.updateSuccessMetrics(totalTime);
      } else {
        this.updateErrorMetrics(backoffResult.error || new Error('Backoff retry failed'));
      }

      const result: ResilienceResult<T> = {
        success: backoffResult.success,
        result: backoffResult.result,
        error: backoffResult.error,
        patternsUsed,
        executionPath,
        finalStrategy: 'backoff_retry',
        totalExecutionTime: totalTime,
        backoffResult,
        metrics: { ...this.metrics }
      };

      this.recordExecution(operationDef.id, result);
      return result;

    } catch (error) {
      executionPath.push({
        pattern: 'exponential_backoff',
        action: 'execute_with_backoff',
        timestamp: new Date(),
        duration: Date.now() - stepStart,
        success: false
      });

      throw error;
    }
  }

  /**
   * Determine optimal execution strategy
   */
  private determineExecutionStrategy(operationDef: OperationDefinition): string {
    // Get operation metrics
    const backoffMetrics = this.backoffManager.getOperationMetrics(operationDef.id);
    const circuitStatus = this.circuitBreakerManager.getAllStatuses();
    
    // If service has circuit breaker open, use fallback first
    if (circuitStatus[operationDef.serviceName] === 'OPEN') {
      return 'timeout_with_fallback';
    }
    
    // If operation has low success rate, use backoff retry
    if (backoffMetrics && backoffMetrics.successRate < 0.5) {
      return 'backoff_retry';
    }
    
    // For essential operations, use circuit breaker for protection
    if (operationDef.essential) {
      return 'circuit_breaker_first';
    }
    
    // Default strategy
    return 'circuit_breaker_first';
  }

  /**
   * Initialize all resilience patterns
   */
  private initializePatterns(): void {
    this.circuitBreakerManager = new CircuitBreakerManager(this.config.circuitBreaker);
    this.fallbackChain = new FallbackChain(this.config.fallbackChain);
    this.degradationManager = new GracefulDegradationManager();
    this.backoffManager = new ExponentialBackoffManager(this.config.backoff);
    this.timeoutManager = new TimeoutManager(this.config.timeout);
  }

  /**
   * Start health monitoring and coordination
   */
  private startHealthMonitoring(): void {
    if (!this.config.coordination.enableMetricsSharing) return;

    this.healthCheckInterval = setInterval(() => {
      this.updateCoordinatedMetrics();
      this.checkDegradationTriggers();
    }, this.config.coordination.healthCheckInterval);
  }

  /**
   * Update coordinated metrics across patterns
   */
  private updateCoordinatedMetrics(): void {
    // Update circuit breaker metrics
    const circuitHealth = this.circuitBreakerManager.getHealthReport();
    this.metrics.circuitBreakersOpen = circuitHealth.openCircuits;
    
    // Update degradation level
    this.metrics.currentDegradationLevel = this.degradationManager.getCurrentLevel();
    
    // Update resource metrics
    this.metrics.resourcesActive = this.timeoutManager.getRegisteredResourcesCount();
    
    // Update fallback usage from history
    const recentExecutions = this.executionHistory.slice(-100);
    this.metrics.fallbacksUsed = recentExecutions.filter(exec => 
      exec.result.patternsUsed.includes('fallback_chain')
    ).length;
  }

  /**
   * Check if degradation should be triggered
   */
  private checkDegradationTriggers(): void {
    if (!this.config.degradation.enableAutoDegrade) return;

    const thresholds = this.config.degradation.degradationThresholds;
    
    // Check error rate
    if (this.metrics.successRate < (1 - thresholds.errorRate)) {
      this.degradationManager.manualDegrade(DegradationLevel.REDUCED, 'high_error_rate');
    }
    
    // Check response time
    if (this.metrics.averageResponseTime > thresholds.responseTime) {
      this.degradationManager.manualDegrade(DegradationLevel.REDUCED, 'high_response_time');
    }
    
    // Check circuit breaker count
    if (this.metrics.circuitBreakersOpen >= thresholds.circuitOpenCount) {
      this.degradationManager.manualDegrade(DegradationLevel.MINIMAL, 'multiple_circuit_breakers_open');
    }
  }

  /**
   * Extract result from circuit breaker response
   */
  private extractResultFromCircuitBreaker<T>(circuitResult: CircuitBreakerResult): T | undefined {
    if (circuitResult.result) {
      // If result is from timeout/backoff wrapper, extract nested result
      if (typeof circuitResult.result === 'object' && 
          circuitResult.result && 
          'result' in circuitResult.result) {
        return (circuitResult.result as any).result;
      }
      return circuitResult.result;
    }
    return undefined;
  }

  /**
   * Update success metrics
   */
  private updateSuccessMetrics(executionTime: number): void {
    const alpha = 0.1;
    this.metrics.successRate = this.metrics.successRate * (1 - alpha) + alpha;
    this.metrics.averageResponseTime = this.metrics.averageResponseTime * (1 - alpha) + executionTime * alpha;
  }

  /**
   * Update error metrics
   */
  private updateErrorMetrics(error: Error): void {
    const alpha = 0.1;
    this.metrics.successRate = this.metrics.successRate * (1 - alpha);
    this.metrics.totalErrors++;
  }

  /**
   * Record execution in history
   */
  private recordExecution(operationId: string, result: ResilienceResult): void {
    this.executionHistory.push({
      operationId,
      timestamp: new Date(),
      result
    });

    // Keep only last 1000 executions
    if (this.executionHistory.length > 1000) {
      this.executionHistory = this.executionHistory.slice(-500);
    }
  }

  /**
   * Register tool capability for fallback chain
   */
  registerTool(tool: ToolCapability): void {
    this.fallbackChain.registerTool(tool);
  }

  /**
   * Register resource for timeout management
   */
  registerResource(
    resourceId: string,
    type: ResourceHandle['type'],
    resource: any,
    cleanup: () => Promise<void> | void,
    operationId?: string,
    metadata?: Record<string, unknown>
  ): void {
    this.timeoutManager.registerResource(resourceId, type, resource, cleanup, operationId, metadata);
  }

  /**
   * Get comprehensive resilience status
   */
  getResilienceStatus(): {
    metrics: ResilienceMetrics;
    circuitBreakers: ReturnType<CircuitBreakerManager['getHealthReport']>;
    degradationStats: ReturnType<GracefulDegradationManager['getDegradationStats']>;
    fallbackStats: ReturnType<FallbackChain['getFallbackStats']>;
    timeoutMetrics: ReturnType<TimeoutManager['getMetrics']>;
    recentExecutions: number;
  } {
    return {
      metrics: { ...this.metrics },
      circuitBreakers: this.circuitBreakerManager.getHealthReport(),
      degradationStats: this.degradationManager.getDegradationStats(),
      fallbackStats: this.fallbackChain.getFallbackStats(),
      timeoutMetrics: this.timeoutManager.getMetrics(),
      recentExecutions: this.executionHistory.length
    };
  }

  /**
   * Force recovery of all patterns
   */
  async forceRecovery(): Promise<void> {
    // Reset circuit breakers
    this.circuitBreakerManager.resetAll();
    
    // Force degradation recovery
    this.degradationManager.forceFullRecovery();
    
    // Clear fallback history
    this.fallbackChain.clearHistory();
  }

  /**
   * Update configuration for all patterns
   */
  updateConfiguration(newConfig: Partial<ResilienceConfig>): void {
    this.config = { ...this.config, ...newConfig };
    
    // Update individual pattern configurations
    if (newConfig.timeout) {
      this.timeoutManager.updateConfig(newConfig.timeout);
    }
    
    if (newConfig.backoff) {
      this.backoffManager.updateConfig(newConfig.backoff);
    }
  }

  /**
   * Shutdown orchestrator and cleanup all resources
   */
  async shutdown(): Promise<void> {
    // Clear health monitoring
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    
    // Shutdown timeout manager
    await this.timeoutManager.shutdown();
    
    // Force cleanup all
    await this.timeoutManager.forceCleanupAll();
  }
}