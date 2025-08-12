/**
 * Graceful Degradation Strategies
 * Maintains core functionality when advanced features fail by providing simplified alternatives
 */

import { EnhancedErrorContext } from '../context/ErrorContext';
import { CircuitState } from './CircuitBreaker';

export enum DegradationLevel {
  FULL = 'FULL',                    // All features available
  REDUCED = 'REDUCED',              // Some features disabled
  MINIMAL = 'MINIMAL',              // Only core features
  EMERGENCY = 'EMERGENCY'           // Basic survival mode
}

export interface DegradationStrategy {
  level: DegradationLevel;
  trigger: DegradationTrigger;
  features: FeatureConfig[];
  fallbackBehavior: FallbackBehavior;
  recoveryConditions: RecoveryCondition[];
}

export interface DegradationTrigger {
  errorRate?: number;               // Error rate threshold
  responseTime?: number;            // Response time threshold
  circuitBreakerState?: CircuitState[];
  resourceUsage?: number;           // CPU/Memory usage threshold
  failedServices?: string[];        // Critical service failures
  customCondition?: () => boolean;  // Custom trigger logic
}

export interface FeatureConfig {
  name: string;
  essential: boolean;               // Required for core functionality
  degradedBehavior?: 'disable' | 'simplify' | 'cache' | 'fallback';
  fallbackValue?: any;
  simplifiedImplementation?: () => Promise<any>;
}

export interface FallbackBehavior {
  showNotification: boolean;
  userMessage?: string;
  logLevel: 'info' | 'warn' | 'error';
  preserveContext: boolean;
  allowRetry: boolean;
}

export interface RecoveryCondition {
  type: 'time' | 'health' | 'manual' | 'metric';
  threshold?: number;
  duration?: number;
  checkInterval?: number;
}

export interface DegradationResult<T = any> {
  success: boolean;
  result?: T;
  degradationLevel: DegradationLevel;
  featuresDisabled: string[];
  userMessage?: string;
  canRetry: boolean;
  estimatedRecoveryTime?: number;
}

export class GracefulDegradationManager {
  private currentLevel: DegradationLevel = DegradationLevel.FULL;
  private strategies: Map<DegradationLevel, DegradationStrategy> = new Map();
  private disabledFeatures: Set<string> = new Set();
  private degradationHistory: Array<{
    timestamp: Date;
    level: DegradationLevel;
    trigger: string;
    duration?: number;
  }> = [];
  private recoveryChecks: Map<string, NodeJS.Timeout> = new Map();
  private healthMetrics: Map<string, number> = new Map();

  constructor() {
    this.initializeDefaultStrategies();
    this.startHealthMonitoring();
  }

  /**
   * Execute operation with graceful degradation support
   */
  async executeWithDegradation<T>(
    operationName: string,
    primaryOperation: () => Promise<T>,
    context: EnhancedErrorContext,
    featureConfig?: FeatureConfig
  ): Promise<DegradationResult<T>> {
    const feature = featureConfig || this.getFeatureConfig(operationName);
    
    // Check if feature is disabled due to degradation
    if (this.isFeatureDisabled(feature.name)) {
      return this.handleDisabledFeature(feature, context);
    }

    try {
      // Execute primary operation
      const result = await primaryOperation();
      
      // Record successful execution
      this.recordSuccess(operationName);
      
      return {
        success: true,
        result,
        degradationLevel: this.currentLevel,
        featuresDisabled: Array.from(this.disabledFeatures),
        canRetry: false
      };

    } catch (error) {
      // Record failure and check for degradation triggers
      this.recordFailure(operationName, error as Error);
      
      // Handle failure based on current degradation level
      return this.handleOperationFailure(feature, error as Error, context);
    }
  }

  /**
   * Handle disabled feature based on its configuration
   */
  private async handleDisabledFeature<T>(
    feature: FeatureConfig,
    context: EnhancedErrorContext
  ): Promise<DegradationResult<T>> {
    const strategy = this.strategies.get(this.currentLevel);
    
    switch (feature.degradedBehavior) {
      case 'simplify':
        if (feature.simplifiedImplementation) {
          try {
            const result = await feature.simplifiedImplementation();
            return {
              success: true,
              result,
              degradationLevel: this.currentLevel,
              featuresDisabled: Array.from(this.disabledFeatures),
              userMessage: this.createDegradationMessage(feature.name),
              canRetry: strategy?.fallbackBehavior.allowRetry || false
            };
          } catch (simplifiedError) {
            return this.createFailureResult(feature, simplifiedError as Error);
          }
        }
        break;

      case 'fallback':
        if (feature.fallbackValue !== undefined) {
          return {
            success: true,
            result: feature.fallbackValue,
            degradationLevel: this.currentLevel,
            featuresDisabled: Array.from(this.disabledFeatures),
            userMessage: this.createDegradationMessage(feature.name),
            canRetry: strategy?.fallbackBehavior.allowRetry || false
          };
        }
        break;

      case 'cache':
        // In a real implementation, this would return cached data
        const cachedResult = this.getCachedResult(feature.name);
        if (cachedResult) {
          return {
            success: true,
            result: cachedResult,
            degradationLevel: this.currentLevel,
            featuresDisabled: Array.from(this.disabledFeatures),
            userMessage: 'Showing cached data due to service issues',
            canRetry: true
          };
        }
        break;

      case 'disable':
      default:
        return this.createFailureResult(feature, new Error(`Feature ${feature.name} is temporarily disabled`));
    }

    return this.createFailureResult(feature, new Error(`Feature ${feature.name} is unavailable`));
  }

  /**
   * Handle operation failure based on degradation strategy
   */
  private async handleOperationFailure<T>(
    feature: FeatureConfig,
    error: Error,
    context: EnhancedErrorContext
  ): Promise<DegradationResult<T>> {
    // Check if this should trigger further degradation
    this.evaluateDegradationTriggers();

    // If feature is essential, try alternative approaches
    if (feature.essential) {
      // For essential features, try simplified implementation
      if (feature.simplifiedImplementation) {
        try {
          const result = await feature.simplifiedImplementation();
          return {
            success: true,
            result,
            degradationLevel: this.currentLevel,
            featuresDisabled: Array.from(this.disabledFeatures),
            userMessage: 'Using simplified version due to service issues',
            canRetry: true
          };
        } catch (simplifiedError) {
          // Even simplified version failed
          return this.createFailureResult(feature, simplifiedError as Error);
        }
      }

      // Use fallback value if available
      if (feature.fallbackValue !== undefined) {
        return {
          success: true,
          result: feature.fallbackValue,
          degradationLevel: this.currentLevel,
          featuresDisabled: Array.from(this.disabledFeatures),
          userMessage: 'Using fallback response',
          canRetry: true
        };
      }
    }

    return this.createFailureResult(feature, error);
  }

  /**
   * Create failure result with degradation context
   */
  private createFailureResult<T>(feature: FeatureConfig, error: Error): DegradationResult<T> {
    const strategy = this.strategies.get(this.currentLevel);
    
    return {
      success: false,
      degradationLevel: this.currentLevel,
      featuresDisabled: Array.from(this.disabledFeatures),
      userMessage: strategy?.fallbackBehavior.userMessage || 
                   `Service temporarily unavailable. We're working to restore ${feature.name}.`,
      canRetry: strategy?.fallbackBehavior.allowRetry || true,
      estimatedRecoveryTime: this.estimateRecoveryTime()
    };
  }

  /**
   * Evaluate if current conditions should trigger degradation
   */
  private evaluateDegradationTriggers(): void {
    for (const [level, strategy] of this.strategies) {
      if (level <= this.currentLevel) continue; // Don't degrade to better level
      
      if (this.shouldTriggerDegradation(strategy.trigger)) {
        this.degradeToLevel(level, 'automatic_trigger');
        break;
      }
    }
  }

  /**
   * Check if degradation trigger conditions are met
   */
  private shouldTriggerDegradation(trigger: DegradationTrigger): boolean {
    // Check error rate
    if (trigger.errorRate !== undefined) {
      const currentErrorRate = this.calculateCurrentErrorRate();
      if (currentErrorRate >= trigger.errorRate) {
        return true;
      }
    }

    // Check response time
    if (trigger.responseTime !== undefined) {
      const avgResponseTime = this.getAverageResponseTime();
      if (avgResponseTime >= trigger.responseTime) {
        return true;
      }
    }

    // Check resource usage
    if (trigger.resourceUsage !== undefined) {
      const currentUsage = this.getCurrentResourceUsage();
      if (currentUsage >= trigger.resourceUsage) {
        return true;
      }
    }

    // Check custom condition
    if (trigger.customCondition) {
      return trigger.customCondition();
    }

    return false;
  }

  /**
   * Degrade to specified level
   */
  private degradeToLevel(level: DegradationLevel, reason: string): void {
    if (level === this.currentLevel) return;

    const previousLevel = this.currentLevel;
    this.currentLevel = level;

    // Update disabled features based on new level
    this.updateDisabledFeatures(level);

    // Record degradation event
    this.degradationHistory.push({
      timestamp: new Date(),
      level,
      trigger: reason
    });

    // Start recovery monitoring
    this.startRecoveryMonitoring(level);

    console.log(`Graceful degradation: ${previousLevel} -> ${level} (${reason})`);
  }

  /**
   * Update disabled features based on degradation level
   */
  private updateDisabledFeatures(level: DegradationLevel): void {
    this.disabledFeatures.clear();

    const strategy = this.strategies.get(level);
    if (!strategy) return;

    for (const feature of strategy.features) {
      if (feature.degradedBehavior === 'disable' || 
          (level === DegradationLevel.EMERGENCY && !feature.essential)) {
        this.disabledFeatures.add(feature.name);
      }
    }
  }

  /**
   * Start recovery monitoring for current degradation level
   */
  private startRecoveryMonitoring(level: DegradationLevel): void {
    const strategy = this.strategies.get(level);
    if (!strategy) return;

    // Clear existing recovery checks
    for (const timeout of this.recoveryChecks.values()) {
      clearInterval(timeout);
    }
    this.recoveryChecks.clear();

    // Set up new recovery checks
    for (const condition of strategy.recoveryConditions) {
      if (condition.type === 'time' && condition.duration) {
        const timeout = setTimeout(() => {
          this.attemptRecovery('time_based');
        }, condition.duration);
        
        this.recoveryChecks.set(`time_${Date.now()}`, timeout);
      }

      if (condition.type === 'health' && condition.checkInterval) {
        const interval = setInterval(() => {
          if (this.checkHealthRecovery(condition.threshold || 0.8)) {
            this.attemptRecovery('health_based');
          }
        }, condition.checkInterval);
        
        this.recoveryChecks.set(`health_${Date.now()}`, interval);
      }
    }
  }

  /**
   * Attempt to recover to better degradation level
   */
  private attemptRecovery(reason: string): void {
    // Try to recover to better level
    const levels = [DegradationLevel.FULL, DegradationLevel.REDUCED, DegradationLevel.MINIMAL];
    
    for (const level of levels) {
      if (level >= this.currentLevel) continue;
      
      if (this.canRecoverToLevel(level)) {
        this.recoverToLevel(level, reason);
        break;
      }
    }
  }

  /**
   * Check if recovery to specific level is possible
   */
  private canRecoverToLevel(level: DegradationLevel): boolean {
    const strategy = this.strategies.get(level);
    if (!strategy) return false;

    // Check if trigger conditions are no longer met
    return !this.shouldTriggerDegradation(strategy.trigger);
  }

  /**
   * Recover to specified level
   */
  private recoverToLevel(level: DegradationLevel, reason: string): void {
    const previousLevel = this.currentLevel;
    this.currentLevel = level;

    // Update features
    this.updateDisabledFeatures(level);

    // Update history
    const lastEntry = this.degradationHistory[this.degradationHistory.length - 1];
    if (lastEntry) {
      lastEntry.duration = Date.now() - lastEntry.timestamp.getTime();
    }

    this.degradationHistory.push({
      timestamp: new Date(),
      level,
      trigger: `recovery_${reason}`
    });

    // Start new recovery monitoring if not fully recovered
    if (level !== DegradationLevel.FULL) {
      this.startRecoveryMonitoring(level);
    } else {
      // Clear recovery checks if fully recovered
      for (const timeout of this.recoveryChecks.values()) {
        clearInterval(timeout);
      }
      this.recoveryChecks.clear();
    }

    console.log(`Graceful recovery: ${previousLevel} -> ${level} (${reason})`);
  }

  /**
   * Initialize default degradation strategies
   */
  private initializeDefaultStrategies(): void {
    // Full functionality strategy
    this.strategies.set(DegradationLevel.FULL, {
      level: DegradationLevel.FULL,
      trigger: {
        errorRate: 0.05,
        responseTime: 5000
      },
      features: [],
      fallbackBehavior: {
        showNotification: false,
        logLevel: 'info',
        preserveContext: true,
        allowRetry: true
      },
      recoveryConditions: []
    });

    // Reduced functionality strategy
    this.strategies.set(DegradationLevel.REDUCED, {
      level: DegradationLevel.REDUCED,
      trigger: {
        errorRate: 0.15,
        responseTime: 10000
      },
      features: [
        { name: 'ai_processing', essential: true, degradedBehavior: 'simplify' },
        { name: 'advanced_formatting', essential: false, degradedBehavior: 'disable' },
        { name: 'file_operations', essential: false, degradedBehavior: 'cache' }
      ],
      fallbackBehavior: {
        showNotification: true,
        userMessage: 'Running with reduced functionality due to high system load',
        logLevel: 'warn',
        preserveContext: true,
        allowRetry: true
      },
      recoveryConditions: [
        { type: 'health', threshold: 0.9, checkInterval: 30000 },
        { type: 'time', duration: 300000 }
      ]
    });

    // Minimal functionality strategy
    this.strategies.set(DegradationLevel.MINIMAL, {
      level: DegradationLevel.MINIMAL,
      trigger: {
        errorRate: 0.3,
        responseTime: 20000
      },
      features: [
        { name: 'ai_processing', essential: true, degradedBehavior: 'fallback', fallbackValue: 'Simple acknowledgment' },
        { name: 'tool_execution', essential: false, degradedBehavior: 'disable' },
        { name: 'complex_operations', essential: false, degradedBehavior: 'disable' }
      ],
      fallbackBehavior: {
        showNotification: true,
        userMessage: 'Operating in minimal mode. Only basic responses available.',
        logLevel: 'error',
        preserveContext: true,
        allowRetry: true
      },
      recoveryConditions: [
        { type: 'health', threshold: 0.8, checkInterval: 60000 },
        { type: 'time', duration: 600000 }
      ]
    });

    // Emergency mode strategy
    this.strategies.set(DegradationLevel.EMERGENCY, {
      level: DegradationLevel.EMERGENCY,
      trigger: {
        errorRate: 0.5,
        responseTime: 30000
      },
      features: [
        { name: 'emergency_response', essential: true, degradedBehavior: 'fallback', 
          fallbackValue: 'System experiencing issues. Please try again later.' }
      ],
      fallbackBehavior: {
        showNotification: true,
        userMessage: 'System in emergency mode. Minimal functionality available.',
        logLevel: 'error',
        preserveContext: false,
        allowRetry: false
      },
      recoveryConditions: [
        { type: 'manual' },
        { type: 'time', duration: 1200000 } // 20 minutes
      ]
    });
  }

  /**
   * Get feature configuration
   */
  private getFeatureConfig(operationName: string): FeatureConfig {
    // Default feature configuration
    return {
      name: operationName,
      essential: true,
      degradedBehavior: 'fallback',
      fallbackValue: `Operation ${operationName} is temporarily unavailable`
    };
  }

  /**
   * Helper methods for metrics calculation
   */
  private calculateCurrentErrorRate(): number {
    return this.healthMetrics.get('error_rate') || 0;
  }

  private getAverageResponseTime(): number {
    return this.healthMetrics.get('avg_response_time') || 0;
  }

  private getCurrentResourceUsage(): number {
    return this.healthMetrics.get('resource_usage') || 0;
  }

  private checkHealthRecovery(threshold: number): boolean {
    const currentHealth = 1 - this.calculateCurrentErrorRate();
    return currentHealth >= threshold;
  }

  private getCachedResult(featureName: string): any {
    // Mock cached result - in real implementation would use actual cache
    return `Cached result for ${featureName}`;
  }

  private recordSuccess(operationName: string): void {
    // Update success metrics
    const currentErrorRate = this.healthMetrics.get('error_rate') || 0;
    this.healthMetrics.set('error_rate', Math.max(0, currentErrorRate - 0.01));
  }

  private recordFailure(operationName: string, error: Error): void {
    // Update failure metrics
    const currentErrorRate = this.healthMetrics.get('error_rate') || 0;
    this.healthMetrics.set('error_rate', Math.min(1, currentErrorRate + 0.05));
  }

  private createDegradationMessage(featureName: string): string {
    return `${featureName} is running in simplified mode due to system issues`;
  }

  private estimateRecoveryTime(): number {
    // Simple estimation based on current degradation level
    const times = {
      [DegradationLevel.FULL]: 0,
      [DegradationLevel.REDUCED]: 300000,     // 5 minutes
      [DegradationLevel.MINIMAL]: 600000,     // 10 minutes
      [DegradationLevel.EMERGENCY]: 1200000   // 20 minutes
    };
    
    return times[this.currentLevel] || 0;
  }

  private startHealthMonitoring(): void {
    // Simulate health metrics updates
    setInterval(() => {
      // In real implementation, this would collect actual metrics
      const baseErrorRate = this.healthMetrics.get('error_rate') || 0;
      // Gradually improve error rate over time if no new failures
      this.healthMetrics.set('error_rate', Math.max(0, baseErrorRate * 0.95));
    }, 10000);
  }

  /**
   * Public interface methods
   */

  /**
   * Check if feature is currently disabled
   */
  isFeatureDisabled(featureName: string): boolean {
    return this.disabledFeatures.has(featureName);
  }

  /**
   * Get current degradation level
   */
  getCurrentLevel(): DegradationLevel {
    return this.currentLevel;
  }

  /**
   * Get degradation statistics
   */
  getDegradationStats(): {
    currentLevel: DegradationLevel;
    disabledFeatures: string[];
    degradationHistory: typeof this.degradationHistory;
    healthMetrics: Record<string, number>;
    canRecover: boolean;
  } {
    return {
      currentLevel: this.currentLevel,
      disabledFeatures: Array.from(this.disabledFeatures),
      degradationHistory: [...this.degradationHistory],
      healthMetrics: Object.fromEntries(this.healthMetrics),
      canRecover: this.canRecoverToLevel(DegradationLevel.FULL)
    };
  }

  /**
   * Manually trigger degradation
   */
  manualDegrade(level: DegradationLevel, reason: string = 'manual'): void {
    this.degradeToLevel(level, reason);
  }

  /**
   * Manually trigger recovery
   */
  manualRecover(reason: string = 'manual'): void {
    this.attemptRecovery(reason);
  }

  /**
   * Force full recovery
   */
  forceFullRecovery(): void {
    this.recoverToLevel(DegradationLevel.FULL, 'forced');
  }
}