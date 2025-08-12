/**
 * Enhanced Exponential Backoff with Jitter and Adaptive Algorithms
 * Implements intelligent retry strategies for transient failures
 */

import { EnhancedErrorContext } from '../context/ErrorContext';

export enum BackoffStrategy {
  EXPONENTIAL = 'EXPONENTIAL',
  LINEAR = 'LINEAR',
  FIXED = 'FIXED',
  FIBONACCI = 'FIBONACCI',
  DECORRELATED = 'DECORRELATED'
}

export enum JitterType {
  NONE = 'NONE',
  FULL = 'FULL',           // Random between 0 and calculated delay
  EQUAL = 'EQUAL',         // Half calculated delay + random half
  DECORRELATED = 'DECORRELATED'  // Decorrelated jitter algorithm
}

export interface BackoffConfig {
  baseDelay: number;              // Initial delay in milliseconds
  maxDelay: number;               // Maximum delay cap
  maxAttempts: number;            // Maximum retry attempts
  multiplier: number;             // Backoff multiplier
  jitterType: JitterType;         // Jitter algorithm
  strategy: BackoffStrategy;      // Backoff strategy
  adaptiveFactors: {
    errorTypeSensitivity: boolean;    // Adjust based on error type
    successRateSensitivity: boolean;  // Adjust based on recent success rate
    loadSensitivity: boolean;         // Adjust based on system load
  };
  timeouts: {
    operationTimeout: number;     // Individual operation timeout
    totalTimeout: number;         // Total retry window timeout
  };
}

export interface BackoffResult<T = any> {
  success: boolean;
  result?: T;
  error?: Error;
  attempts: number;
  totalTime: number;
  actualDelays: number[];
  strategyUsed: BackoffStrategy;
  adaptiveAdjustments: AdaptiveAdjustment[];
}

export interface AdaptiveAdjustment {
  factor: string;
  originalDelay: number;
  adjustedDelay: number;
  reason: string;
  timestamp: Date;
}

export interface RetryContext {
  attempt: number;
  previousDelay: number;
  lastError?: Error;
  cumulativeTime: number;
  errorHistory: Array<{
    error: Error;
    timestamp: Date;
    recoveryTime?: number;
  }>;
}

export class ExponentialBackoffManager {
  private config: BackoffConfig;
  private performanceMetrics: Map<string, {
    successRate: number;
    averageResponseTime: number;
    lastAttemptTime: Date;
    errorTypes: Record<string, number>;
  }> = new Map();
  private systemLoadMetrics: {
    cpuUsage: number;
    memoryUsage: number;
    activeOperations: number;
  } = { cpuUsage: 0, memoryUsage: 0, activeOperations: 0 };

  constructor(config: Partial<BackoffConfig> = {}) {
    this.config = {
      baseDelay: 1000,
      maxDelay: 30000,
      maxAttempts: 5,
      multiplier: 2.0,
      jitterType: JitterType.EQUAL,
      strategy: BackoffStrategy.EXPONENTIAL,
      adaptiveFactors: {
        errorTypeSensitivity: true,
        successRateSensitivity: true,
        loadSensitivity: true
      },
      timeouts: {
        operationTimeout: 10000,
        totalTimeout: 60000
      },
      ...config
    };
  }

  /**
   * Execute operation with exponential backoff retry logic
   */
  async executeWithBackoff<T>(
    operationId: string,
    operation: () => Promise<T>,
    context: EnhancedErrorContext,
    customConfig?: Partial<BackoffConfig>
  ): Promise<BackoffResult<T>> {
    const effectiveConfig = { ...this.config, ...customConfig };
    const startTime = Date.now();
    const retryContext: RetryContext = {
      attempt: 0,
      previousDelay: 0,
      cumulativeTime: 0,
      errorHistory: []
    };
    const actualDelays: number[] = [];
    const adaptiveAdjustments: AdaptiveAdjustment[] = [];
    let lastError: Error | undefined;

    // Initialize metrics for operation if not exists
    if (!this.performanceMetrics.has(operationId)) {
      this.performanceMetrics.set(operationId, {
        successRate: 1.0,
        averageResponseTime: 1000,
        lastAttemptTime: new Date(),
        errorTypes: {}
      });
    }

    while (retryContext.attempt < effectiveConfig.maxAttempts) {
      // Check total timeout
      if (Date.now() - startTime >= effectiveConfig.timeouts.totalTimeout) {
        break;
      }

      retryContext.attempt++;

      try {
        // Execute operation with timeout
        const operationResult = await this.executeWithTimeout(
          operation,
          effectiveConfig.timeouts.operationTimeout
        );

        // Update success metrics
        this.updateSuccessMetrics(operationId, Date.now() - startTime);

        return {
          success: true,
          result: operationResult,
          attempts: retryContext.attempt,
          totalTime: Date.now() - startTime,
          actualDelays,
          strategyUsed: effectiveConfig.strategy,
          adaptiveAdjustments
        };

      } catch (error) {
        lastError = error as Error;
        retryContext.lastError = lastError;
        
        // Record error in history
        retryContext.errorHistory.push({
          error: lastError,
          timestamp: new Date()
        });

        // Update failure metrics
        this.updateFailureMetrics(operationId, lastError);

        // Check if we should retry based on error type
        if (!this.shouldRetryError(lastError)) {
          break;
        }

        // If this is the last attempt, don't wait
        if (retryContext.attempt >= effectiveConfig.maxAttempts) {
          break;
        }

        // Calculate next delay with adaptive adjustments
        const baseDelay = this.calculateBaseDelay(effectiveConfig, retryContext);
        const adaptiveDelay = this.applyAdaptiveFactors(
          operationId,
          baseDelay,
          retryContext,
          effectiveConfig
        );
        const finalDelay = this.applyJitter(adaptiveDelay.adjustedDelay, effectiveConfig.jitterType);

        // Record adaptive adjustments
        adaptiveAdjustments.push(...adaptiveDelay.adjustments);
        actualDelays.push(finalDelay);
        retryContext.previousDelay = finalDelay;
        retryContext.cumulativeTime += finalDelay;

        // Wait before retry
        await this.delay(finalDelay);
      }
    }

    // All retries exhausted
    return {
      success: false,
      error: lastError || new Error('Maximum retry attempts exceeded'),
      attempts: retryContext.attempt,
      totalTime: Date.now() - startTime,
      actualDelays,
      strategyUsed: effectiveConfig.strategy,
      adaptiveAdjustments
    };
  }

  /**
   * Calculate base delay using selected strategy
   */
  private calculateBaseDelay(config: BackoffConfig, context: RetryContext): number {
    let delay: number;

    switch (config.strategy) {
      case BackoffStrategy.EXPONENTIAL:
        delay = config.baseDelay * Math.pow(config.multiplier, context.attempt - 1);
        break;

      case BackoffStrategy.LINEAR:
        delay = config.baseDelay * context.attempt;
        break;

      case BackoffStrategy.FIXED:
        delay = config.baseDelay;
        break;

      case BackoffStrategy.FIBONACCI:
        delay = this.calculateFibonacciDelay(config.baseDelay, context.attempt);
        break;

      case BackoffStrategy.DECORRELATED:
        delay = this.calculateDecorrelatedDelay(config.baseDelay, context.previousDelay);
        break;

      default:
        delay = config.baseDelay * Math.pow(config.multiplier, context.attempt - 1);
    }

    return Math.min(delay, config.maxDelay);
  }

  /**
   * Apply adaptive factors to adjust delay
   */
  private applyAdaptiveFactors(
    operationId: string,
    baseDelay: number,
    context: RetryContext,
    config: BackoffConfig
  ): { adjustedDelay: number; adjustments: AdaptiveAdjustment[] } {
    let adjustedDelay = baseDelay;
    const adjustments: AdaptiveAdjustment[] = [];
    const metrics = this.performanceMetrics.get(operationId);

    if (!metrics) {
      return { adjustedDelay, adjustments };
    }

    // Error type sensitivity
    if (config.adaptiveFactors.errorTypeSensitivity && context.lastError) {
      const errorTypeAdjustment = this.getErrorTypeAdjustment(context.lastError);
      const newDelay = adjustedDelay * errorTypeAdjustment.factor;
      
      adjustments.push({
        factor: 'error_type',
        originalDelay: adjustedDelay,
        adjustedDelay: newDelay,
        reason: errorTypeAdjustment.reason,
        timestamp: new Date()
      });
      
      adjustedDelay = newDelay;
    }

    // Success rate sensitivity
    if (config.adaptiveFactors.successRateSensitivity) {
      const successRateAdjustment = this.getSuccessRateAdjustment(metrics.successRate);
      const newDelay = adjustedDelay * successRateAdjustment.factor;
      
      adjustments.push({
        factor: 'success_rate',
        originalDelay: adjustedDelay,
        adjustedDelay: newDelay,
        reason: successRateAdjustment.reason,
        timestamp: new Date()
      });
      
      adjustedDelay = newDelay;
    }

    // System load sensitivity
    if (config.adaptiveFactors.loadSensitivity) {
      const loadAdjustment = this.getLoadAdjustment();
      const newDelay = adjustedDelay * loadAdjustment.factor;
      
      adjustments.push({
        factor: 'system_load',
        originalDelay: adjustedDelay,
        adjustedDelay: newDelay,
        reason: loadAdjustment.reason,
        timestamp: new Date()
      });
      
      adjustedDelay = newDelay;
    }

    return { adjustedDelay: Math.min(adjustedDelay, config.maxDelay), adjustments };
  }

  /**
   * Apply jitter to delay
   */
  private applyJitter(delay: number, jitterType: JitterType): number {
    switch (jitterType) {
      case JitterType.NONE:
        return delay;

      case JitterType.FULL:
        return Math.random() * delay;

      case JitterType.EQUAL:
        return delay * 0.5 + Math.random() * delay * 0.5;

      case JitterType.DECORRELATED:
        // Decorrelated jitter prevents thundering herd
        return Math.random() * delay * 3;

      default:
        return delay;
    }
  }

  /**
   * Calculate Fibonacci-based delay
   */
  private calculateFibonacciDelay(baseDelay: number, attempt: number): number {
    const fibonacci = (n: number): number => {
      if (n <= 1) return 1;
      let a = 1, b = 1;
      for (let i = 2; i <= n; i++) {
        [a, b] = [b, a + b];
      }
      return b;
    };

    return baseDelay * fibonacci(attempt);
  }

  /**
   * Calculate decorrelated delay
   */
  private calculateDecorrelatedDelay(baseDelay: number, previousDelay: number): number {
    if (previousDelay === 0) return baseDelay;
    return baseDelay + Math.random() * previousDelay;
  }

  /**
   * Get error type specific adjustment
   */
  private getErrorTypeAdjustment(error: Error): { factor: number; reason: string } {
    const errorMessage = error.message.toLowerCase();
    
    // Network/connection errors - longer delays
    if (errorMessage.includes('network') || 
        errorMessage.includes('connection') || 
        errorMessage.includes('timeout')) {
      return { factor: 1.5, reason: 'Network error detected, increasing delay' };
    }
    
    // Rate limiting - much longer delays
    if (errorMessage.includes('rate limit') || 
        errorMessage.includes('too many requests')) {
      return { factor: 3.0, reason: 'Rate limit detected, significantly increasing delay' };
    }
    
    // Server errors - moderate increase
    if (errorMessage.includes('server error') || 
        errorMessage.includes('internal error')) {
      return { factor: 1.2, reason: 'Server error detected, slightly increasing delay' };
    }
    
    // Authentication errors - no retry recommended
    if (errorMessage.includes('unauthorized') || 
        errorMessage.includes('forbidden') || 
        errorMessage.includes('authentication')) {
      return { factor: 0.5, reason: 'Auth error detected, reducing delay' };
    }

    return { factor: 1.0, reason: 'Standard error, no adjustment' };
  }

  /**
   * Get success rate based adjustment
   */
  private getSuccessRateAdjustment(successRate: number): { factor: number; reason: string } {
    if (successRate < 0.3) {
      return { factor: 2.0, reason: 'Low success rate, doubling delay' };
    } else if (successRate < 0.5) {
      return { factor: 1.5, reason: 'Poor success rate, increasing delay' };
    } else if (successRate < 0.7) {
      return { factor: 1.2, reason: 'Moderate success rate, slight increase' };
    } else if (successRate > 0.9) {
      return { factor: 0.8, reason: 'High success rate, reducing delay' };
    }
    
    return { factor: 1.0, reason: 'Normal success rate, no adjustment' };
  }

  /**
   * Get system load based adjustment
   */
  private getLoadAdjustment(): { factor: number; reason: string } {
    const avgLoad = (this.systemLoadMetrics.cpuUsage + this.systemLoadMetrics.memoryUsage) / 2;
    
    if (avgLoad > 0.9) {
      return { factor: 2.5, reason: 'Very high system load, significantly increasing delay' };
    } else if (avgLoad > 0.7) {
      return { factor: 1.8, reason: 'High system load, increasing delay' };
    } else if (avgLoad > 0.5) {
      return { factor: 1.3, reason: 'Moderate system load, slightly increasing delay' };
    } else if (avgLoad < 0.2) {
      return { factor: 0.7, reason: 'Low system load, reducing delay' };
    }
    
    return { factor: 1.0, reason: 'Normal system load, no adjustment' };
  }

  /**
   * Check if error type should trigger retry
   */
  private shouldRetryError(error: Error): boolean {
    const errorMessage = error.message.toLowerCase();
    
    // Don't retry on authentication/authorization errors
    if (errorMessage.includes('unauthorized') || 
        errorMessage.includes('forbidden') || 
        errorMessage.includes('authentication') ||
        errorMessage.includes('invalid credentials')) {
      return false;
    }
    
    // Don't retry on validation errors
    if (errorMessage.includes('validation') || 
        errorMessage.includes('invalid input') ||
        errorMessage.includes('bad request')) {
      return false;
    }
    
    // Retry on transient errors
    return true;
  }

  /**
   * Execute operation with timeout
   */
  private async executeWithTimeout<T>(
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
   * Simple delay function
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Update success metrics
   */
  private updateSuccessMetrics(operationId: string, responseTime: number): void {
    const metrics = this.performanceMetrics.get(operationId);
    if (!metrics) return;

    // Update success rate with exponential moving average
    const alpha = 0.1;
    metrics.successRate = metrics.successRate * (1 - alpha) + alpha;
    
    // Update average response time
    metrics.averageResponseTime = metrics.averageResponseTime * (1 - alpha) + responseTime * alpha;
    
    metrics.lastAttemptTime = new Date();
  }

  /**
   * Update failure metrics
   */
  private updateFailureMetrics(operationId: string, error: Error): void {
    const metrics = this.performanceMetrics.get(operationId);
    if (!metrics) return;

    // Update success rate
    const alpha = 0.1;
    metrics.successRate = metrics.successRate * (1 - alpha);
    
    // Track error types
    const errorType = this.categorizeError(error);
    metrics.errorTypes[errorType] = (metrics.errorTypes[errorType] || 0) + 1;
    
    metrics.lastAttemptTime = new Date();
  }

  /**
   * Categorize error for tracking
   */
  private categorizeError(error: Error): string {
    const message = error.message.toLowerCase();
    
    if (message.includes('network') || message.includes('connection')) {
      return 'network';
    } else if (message.includes('timeout')) {
      return 'timeout';
    } else if (message.includes('rate limit')) {
      return 'rate_limit';
    } else if (message.includes('server error')) {
      return 'server_error';
    } else if (message.includes('unauthorized') || message.includes('forbidden')) {
      return 'auth_error';
    }
    
    return 'unknown';
  }

  /**
   * Update system load metrics (called externally)
   */
  updateSystemMetrics(cpuUsage: number, memoryUsage: number, activeOperations: number): void {
    this.systemLoadMetrics = { cpuUsage, memoryUsage, activeOperations };
  }

  /**
   * Get performance metrics for operation
   */
  getOperationMetrics(operationId: string): typeof this.performanceMetrics extends Map<string, infer T> ? T | undefined : never {
    return this.performanceMetrics.get(operationId);
  }

  /**
   * Get all performance metrics
   */
  getAllMetrics(): Record<string, any> {
    return Object.fromEntries(this.performanceMetrics);
  }

  /**
   * Reset metrics for operation
   */
  resetOperationMetrics(operationId: string): void {
    this.performanceMetrics.delete(operationId);
  }

  /**
   * Get recommended strategy for operation based on history
   */
  getRecommendedStrategy(operationId: string): BackoffStrategy {
    const metrics = this.performanceMetrics.get(operationId);
    if (!metrics) return BackoffStrategy.EXPONENTIAL;

    const { successRate, errorTypes } = metrics;
    
    // If mostly network errors, use decorrelated to avoid thundering herd
    if (errorTypes.network > (errorTypes.timeout || 0) + (errorTypes.server_error || 0)) {
      return BackoffStrategy.DECORRELATED;
    }
    
    // If low success rate, use fibonacci for gentler ramp-up
    if (successRate < 0.3) {
      return BackoffStrategy.FIBONACCI;
    }
    
    // Default to exponential
    return BackoffStrategy.EXPONENTIAL;
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<BackoffConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }
}