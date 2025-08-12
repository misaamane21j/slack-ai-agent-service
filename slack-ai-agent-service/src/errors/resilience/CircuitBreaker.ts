/**
 * Circuit Breaker Pattern Implementation
 * Prevents cascading failures by monitoring service health and cutting off traffic to failing services
 */

import { EnhancedErrorContext } from '../context/ErrorContext';

export enum CircuitState {
  CLOSED = 'CLOSED',       // Normal operation
  OPEN = 'OPEN',           // Circuit is open, requests fail fast
  HALF_OPEN = 'HALF_OPEN'  // Testing if service has recovered
}

export interface CircuitBreakerConfig {
  failureThreshold: number;          // Number of failures before opening
  recoveryTimeout: number;           // Time to wait before testing recovery
  successThreshold: number;          // Successful calls needed to close circuit
  volumeThreshold: number;           // Minimum calls before evaluating
  errorRate: number;                 // Error rate threshold (0-1)
  timeWindow: number;                // Time window for error rate calculation
  halfOpenMaxCalls: number;          // Max calls allowed in half-open state
}

export interface CircuitBreakerResult<T = any> {
  success: boolean;
  result?: T;
  error?: Error;
  circuitState: CircuitState;
  executionTime: number;
  fromCache?: boolean;
  circuitOpenTime?: Date;
}

export interface CallRecord {
  timestamp: Date;
  success: boolean;
  duration: number;
  error?: string;
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount: number = 0;
  private successCount: number = 0;
  private lastFailureTime?: Date;
  private lastSuccessTime?: Date;
  private stateChangeTime: Date = new Date();
  private callHistory: CallRecord[] = [];
  private halfOpenCalls: number = 0;
  private config: CircuitBreakerConfig;
  private serviceName: string;

  constructor(serviceName: string, config: Partial<CircuitBreakerConfig> = {}) {
    this.serviceName = serviceName;
    this.config = {
      failureThreshold: 5,
      recoveryTimeout: 60000,      // 1 minute
      successThreshold: 3,
      volumeThreshold: 10,
      errorRate: 0.5,              // 50% error rate
      timeWindow: 120000,          // 2 minutes
      halfOpenMaxCalls: 3,
      ...config
    };
  }

  /**
   * Execute operation with circuit breaker protection
   */
  async execute<T>(
    operation: () => Promise<T>,
    context?: EnhancedErrorContext,
    fallback?: () => Promise<T>
  ): Promise<CircuitBreakerResult<T>> {
    const startTime = Date.now();

    // Check circuit state
    if (this.state === CircuitState.OPEN) {
      return this.handleOpenCircuit(fallback, startTime);
    }

    if (this.state === CircuitState.HALF_OPEN) {
      if (this.halfOpenCalls >= this.config.halfOpenMaxCalls) {
        return this.handleOpenCircuit(fallback, startTime);
      }
      this.halfOpenCalls++;
    }

    try {
      // Execute the operation
      const result = await operation();
      const executionTime = Date.now() - startTime;

      // Record successful call
      this.recordSuccess(executionTime);
      
      return {
        success: true,
        result,
        circuitState: this.state,
        executionTime
      };

    } catch (error) {
      const executionTime = Date.now() - startTime;
      
      // Record failure
      this.recordFailure(error as Error, executionTime);
      
      // Try fallback if available
      if (fallback) {
        try {
          const fallbackResult = await fallback();
          return {
            success: true,
            result: fallbackResult,
            error: error as Error,
            circuitState: this.state,
            executionTime: Date.now() - startTime,
            fromCache: true
          };
        } catch (fallbackError) {
          return {
            success: false,
            error: fallbackError as Error,
            circuitState: this.state,
            executionTime: Date.now() - startTime
          };
        }
      }

      return {
        success: false,
        error: error as Error,
        circuitState: this.state,
        executionTime
      };
    }
  }

  /**
   * Handle circuit open state
   */
  private async handleOpenCircuit<T>(
    fallback?: () => Promise<T>,
    startTime: number = Date.now()
  ): Promise<CircuitBreakerResult<T>> {
    // Check if recovery timeout has passed
    const timeSinceOpen = Date.now() - this.stateChangeTime.getTime();
    
    if (timeSinceOpen >= this.config.recoveryTimeout) {
      this.transitionToHalfOpen();
      // Allow this call to proceed in half-open state
      this.halfOpenCalls = 1;
      
      // Note: In a real implementation, you'd retry the original operation here
      // For now, we'll just indicate the circuit is attempting recovery
    }

    // Try fallback
    if (fallback) {
      try {
        const fallbackResult = await fallback();
        return {
          success: true,
          result: fallbackResult,
          circuitState: this.state,
          executionTime: Date.now() - startTime,
          fromCache: true,
          circuitOpenTime: this.stateChangeTime
        };
      } catch (fallbackError) {
        return {
          success: false,
          error: fallbackError as Error,
          circuitState: this.state,
          executionTime: Date.now() - startTime,
          circuitOpenTime: this.stateChangeTime
        };
      }
    }

    return {
      success: false,
      error: new Error(`Circuit breaker for ${this.serviceName} is OPEN`),
      circuitState: this.state,
      executionTime: Date.now() - startTime,
      circuitOpenTime: this.stateChangeTime
    };
  }

  /**
   * Record successful operation
   */
  private recordSuccess(duration: number): void {
    const record: CallRecord = {
      timestamp: new Date(),
      success: true,
      duration
    };

    this.callHistory.push(record);
    this.cleanupOldRecords();

    this.lastSuccessTime = new Date();

    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;
      
      if (this.successCount >= this.config.successThreshold) {
        this.transitionToClosed();
      }
    } else if (this.state === CircuitState.CLOSED) {
      // Reset failure count on success
      this.failureCount = Math.max(0, this.failureCount - 1);
    }
  }

  /**
   * Record failed operation
   */
  private recordFailure(error: Error, duration: number): void {
    const record: CallRecord = {
      timestamp: new Date(),
      success: false,
      duration,
      error: error.message
    };

    this.callHistory.push(record);
    this.cleanupOldRecords();

    this.lastFailureTime = new Date();
    this.failureCount++;

    // Check if circuit should open
    if (this.shouldOpenCircuit()) {
      this.transitionToOpen();
    } else if (this.state === CircuitState.HALF_OPEN) {
      // Any failure in half-open state returns to open
      this.transitionToOpen();
    }
  }

  /**
   * Check if circuit should open based on failure criteria
   */
  private shouldOpenCircuit(): boolean {
    if (this.state === CircuitState.OPEN) {
      return false;
    }

    // Check failure threshold
    if (this.failureCount >= this.config.failureThreshold) {
      return true;
    }

    // Check error rate within time window
    const recentCalls = this.getRecentCalls();
    if (recentCalls.length >= this.config.volumeThreshold) {
      const failures = recentCalls.filter(call => !call.success).length;
      const errorRate = failures / recentCalls.length;
      
      if (errorRate >= this.config.errorRate) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get recent calls within time window
   */
  private getRecentCalls(): CallRecord[] {
    const cutoffTime = Date.now() - this.config.timeWindow;
    return this.callHistory.filter(call => call.timestamp.getTime() >= cutoffTime);
  }

  /**
   * Transition to CLOSED state
   */
  private transitionToClosed(): void {
    this.state = CircuitState.CLOSED;
    this.stateChangeTime = new Date();
    this.failureCount = 0;
    this.successCount = 0;
    this.halfOpenCalls = 0;
  }

  /**
   * Transition to OPEN state
   */
  private transitionToOpen(): void {
    this.state = CircuitState.OPEN;
    this.stateChangeTime = new Date();
    this.halfOpenCalls = 0;
  }

  /**
   * Transition to HALF_OPEN state
   */
  private transitionToHalfOpen(): void {
    this.state = CircuitState.HALF_OPEN;
    this.stateChangeTime = new Date();
    this.successCount = 0;
    this.halfOpenCalls = 0;
  }

  /**
   * Clean up old call records
   */
  private cleanupOldRecords(): void {
    const cutoffTime = Date.now() - (this.config.timeWindow * 2); // Keep extra history
    this.callHistory = this.callHistory.filter(call => 
      call.timestamp.getTime() >= cutoffTime
    );

    // Limit total records
    if (this.callHistory.length > 1000) {
      this.callHistory = this.callHistory.slice(-500);
    }
  }

  /**
   * Get current circuit breaker state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Get circuit breaker metrics
   */
  getMetrics(): {
    state: CircuitState;
    failureCount: number;
    successCount: number;
    errorRate: number;
    averageResponseTime: number;
    timeSinceLastStateChange: number;
    recentCalls: number;
    serviceName: string;
  } {
    const recentCalls = this.getRecentCalls();
    const failures = recentCalls.filter(call => !call.success).length;
    const errorRate = recentCalls.length > 0 ? failures / recentCalls.length : 0;
    
    const averageResponseTime = recentCalls.length > 0 
      ? recentCalls.reduce((sum, call) => sum + call.duration, 0) / recentCalls.length
      : 0;

    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      errorRate,
      averageResponseTime,
      timeSinceLastStateChange: Date.now() - this.stateChangeTime.getTime(),
      recentCalls: recentCalls.length,
      serviceName: this.serviceName
    };
  }

  /**
   * Get call history for analysis
   */
  getCallHistory(): CallRecord[] {
    return [...this.callHistory];
  }

  /**
   * Manually reset circuit breaker
   */
  reset(): void {
    this.transitionToClosed();
    this.callHistory = [];
  }

  /**
   * Force circuit open (for testing or maintenance)
   */
  forceOpen(): void {
    this.transitionToOpen();
  }

  /**
   * Check if circuit is healthy
   */
  isHealthy(): boolean {
    return this.state === CircuitState.CLOSED;
  }

  /**
   * Get time until recovery attempt (if circuit is open)
   */
  getTimeUntilRecovery(): number {
    if (this.state !== CircuitState.OPEN) {
      return 0;
    }

    const timeSinceOpen = Date.now() - this.stateChangeTime.getTime();
    return Math.max(0, this.config.recoveryTimeout - timeSinceOpen);
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<CircuitBreakerConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }
}

/**
 * Circuit Breaker Manager for multiple services
 */
export class CircuitBreakerManager {
  private breakers: Map<string, CircuitBreaker> = new Map();
  private defaultConfig: CircuitBreakerConfig;

  constructor(defaultConfig: Partial<CircuitBreakerConfig> = {}) {
    this.defaultConfig = {
      failureThreshold: 5,
      recoveryTimeout: 60000,
      successThreshold: 3,
      volumeThreshold: 10,
      errorRate: 0.5,
      timeWindow: 120000,
      halfOpenMaxCalls: 3,
      ...defaultConfig
    };
  }

  /**
   * Get or create circuit breaker for service
   */
  getCircuitBreaker(serviceName: string, config?: Partial<CircuitBreakerConfig>): CircuitBreaker {
    if (!this.breakers.has(serviceName)) {
      const breakerConfig = { ...this.defaultConfig, ...config };
      this.breakers.set(serviceName, new CircuitBreaker(serviceName, breakerConfig));
    }

    return this.breakers.get(serviceName)!;
  }

  /**
   * Execute operation with circuit breaker for specific service
   */
  async executeWithCircuitBreaker<T>(
    serviceName: string,
    operation: () => Promise<T>,
    context?: EnhancedErrorContext,
    fallback?: () => Promise<T>,
    config?: Partial<CircuitBreakerConfig>
  ): Promise<CircuitBreakerResult<T>> {
    const breaker = this.getCircuitBreaker(serviceName, config);
    return breaker.execute(operation, context, fallback);
  }

  /**
   * Get all circuit breaker statuses
   */
  getAllStatuses(): Record<string, CircuitState> {
    const statuses: Record<string, CircuitState> = {};
    for (const [serviceName, breaker] of this.breakers) {
      statuses[serviceName] = breaker.getState();
    }
    return statuses;
  }

  /**
   * Get unhealthy services
   */
  getUnhealthyServices(): string[] {
    const unhealthy: string[] = [];
    for (const [serviceName, breaker] of this.breakers) {
      if (!breaker.isHealthy()) {
        unhealthy.push(serviceName);
      }
    }
    return unhealthy;
  }

  /**
   * Reset all circuit breakers
   */
  resetAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
  }

  /**
   * Get comprehensive health report
   */
  getHealthReport(): {
    totalServices: number;
    healthyServices: number;
    openCircuits: number;
    halfOpenCircuits: number;
    services: Array<{
      name: string;
      state: CircuitState;
      errorRate: number;
      averageResponseTime: number;
    }>;
  } {
    const services = Array.from(this.breakers.entries()).map(([name, breaker]) => {
      const metrics = breaker.getMetrics();
      return {
        name,
        state: metrics.state,
        errorRate: metrics.errorRate,
        averageResponseTime: metrics.averageResponseTime
      };
    });

    return {
      totalServices: services.length,
      healthyServices: services.filter(s => s.state === CircuitState.CLOSED).length,
      openCircuits: services.filter(s => s.state === CircuitState.OPEN).length,
      halfOpenCircuits: services.filter(s => s.state === CircuitState.HALF_OPEN).length,
      services
    };
  }
}