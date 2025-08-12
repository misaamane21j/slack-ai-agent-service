/**
 * Configuration Boundary - Isolates runtime configuration changes
 * Prevents configuration errors from affecting system stability
 */

import { ErrorBoundary, BoundaryType, BoundaryConfig, BoundaryResult } from './ErrorBoundary';
import { EnhancedErrorContext, ProcessingStage } from '../context/ErrorContext';
import { PreservationReason, PreservationPriority } from '../context/ContextPreserver';
import { RecoveryStrategyManager } from '../recovery/RecoveryStrategy';
import { ContextPreserver } from '../context/ContextPreserver';

export interface ConfigurationBoundaryConfig extends BoundaryConfig {
  enableConfigValidation: boolean;
  enableConfigRollback: boolean;
  configBackupCount: number;
  validationTimeoutMs: number;
  safeConfigPath?: string;
}

export interface ConfigurationResult<T = any> extends BoundaryResult<T> {
  configurationApplied: boolean;
  validationPassed: boolean;
  rollbackPerformed: boolean;
  backupCreated: boolean;
  configurationSource: 'runtime' | 'file' | 'environment' | 'fallback';
}

export interface ConfigurationChange {
  path: string;
  oldValue: any;
  newValue: any;
  timestamp: Date;
  source: string;
  validation?: {
    valid: boolean;
    errors: string[];
  };
}

export interface ConfigurationSnapshot {
  id: string;
  timestamp: Date;
  configuration: Record<string, any>;
  source: string;
  isValid: boolean;
  description?: string;
}

export class ConfigurationBoundary extends ErrorBoundary {
  private configHistory: ConfigurationSnapshot[] = [];
  private currentConfig: Record<string, any> = {};
  private safeConfig: Record<string, any> = {};
  private pendingChanges: ConfigurationChange[] = [];
  private configBoundaryConfig: ConfigurationBoundaryConfig;

  constructor(
    config: Partial<ConfigurationBoundaryConfig> = {},
    recoveryManager?: RecoveryStrategyManager,
    contextPreserver?: ContextPreserver
  ) {
    const configBoundaryConfig: ConfigurationBoundaryConfig = {
      maxErrorsBeforeDegradation: 2,
      maxErrorsBeforeIsolation: 3,
      recoveryTimeoutMs: 10000,
      isolationDurationMs: 300000, // 5 minutes
      enableAutoRecovery: true,
      escalationThreshold: 5,
      enableConfigValidation: true,
      enableConfigRollback: true,
      configBackupCount: 10,
      validationTimeoutMs: 5000,
      ...config
    };

    super(BoundaryType.CONFIGURATION, configBoundaryConfig, recoveryManager, contextPreserver);
    this.configBoundaryConfig = configBoundaryConfig;
    this.initializeSafeConfiguration();
  }

  /**
   * Apply configuration change with boundary protection
   */
  async applyConfigurationChange(
    configPath: string,
    newValue: any,
    source: string = 'runtime',
    context?: EnhancedErrorContext
  ): Promise<ConfigurationResult<any>> {
    const changeContext = context || this.createConfigurationContext('apply_change');
    const oldValue = this.getConfigValue(configPath);

    // Create configuration change
    const change: ConfigurationChange = {
      path: configPath,
      oldValue,
      newValue,
      timestamp: new Date(),
      source
    };

    // Create backup before change
    const backupCreated = this.createConfigurationBackup(`change_${configPath}_${Date.now()}`);

    // Create configuration operation
    const configOperation = () => this.performConfigurationChange(change);
    
    // Create fallback operation (rollback)
    const fallbackOperation = this.configBoundaryConfig.enableConfigRollback
      ? () => this.performConfigurationRollback(configPath, oldValue)
      : undefined;

    // Execute within boundary
    const result = await this.execute(configOperation, changeContext, fallbackOperation);

    return {
      ...result,
      configurationApplied: result.success,
      validationPassed: result.result?.validation?.valid || false,
      rollbackPerformed: result.fallbackUsed || false,
      backupCreated,
      configurationSource: source as any
    };
  }

  /**
   * Load configuration with boundary protection
   */
  async loadConfiguration(
    configSource: 'file' | 'environment' | 'runtime',
    context?: EnhancedErrorContext
  ): Promise<ConfigurationResult<Record<string, any>>> {
    const loadContext = context || this.createConfigurationContext('load_config');

    // Create load operation
    const loadOperation = () => this.performConfigurationLoad(configSource);
    
    // Create fallback operation (use safe config)
    const fallbackOperation = () => this.loadSafeConfiguration();

    // Execute within boundary
    const result = await this.execute(loadOperation, loadContext, fallbackOperation);

    if (result.success && result.result) {
      this.currentConfig = result.result;
      this.createConfigurationBackup(`load_${configSource}_${Date.now()}`);
    }

    return {
      ...result,
      configurationApplied: result.success,
      validationPassed: true,
      rollbackPerformed: result.fallbackUsed,
      backupCreated: result.success,
      configurationSource: result.fallbackUsed ? 'fallback' : configSource
    };
  }

  /**
   * Validate configuration with boundary protection
   */
  async validateConfiguration(
    configuration: Record<string, any>,
    context?: EnhancedErrorContext
  ): Promise<ConfigurationResult<{ valid: boolean; errors: string[] }>> {
    const validationContext = context || this.createConfigurationContext('validate_config');

    const validationOperation = () => this.performConfigurationValidation(configuration);

    // No fallback for validation - either it works or it doesn't
    const result = await this.execute(validationOperation, validationContext);

    return {
      ...result,
      configurationApplied: false,
      validationPassed: result.result?.valid || false,
      rollbackPerformed: false,
      backupCreated: false,
      configurationSource: 'runtime'
    };
  }

  protected shouldPreserveContext(context: EnhancedErrorContext): boolean {
    // Preserve context for configuration operations
    return context.operation?.operationName?.includes('config') ||
           context.operation?.operationName?.includes('configuration') ||
           context.executionState?.processingStage === ProcessingStage.CONFIGURATION_LOAD;
  }

  protected preserveExecutionContext(context: EnhancedErrorContext): string {
    const userState = {
      conversationId: 'config_operation',
      threadId: context.executionState?.threadId || 'config',
      userId: context.userIntent?.userId || 'system',
      originalMessage: 'Configuration operation',
      parsedIntent: context.operation?.operationName || 'config_change',
      confidence: 1.0,
      fallbackOptions: ['safe_config', 'rollback', 'default_values']
    };

    const operationState = {
      operationId: context.operation?.operationId || context.correlationId,
      stage: ProcessingStage.CONFIGURATION_LOAD,
      phase: context.operation?.phase || 'configuration',
      completedSteps: ['config_backup'],
      partialResults: {
        currentConfig: this.currentConfig,
        pendingChanges: this.pendingChanges
      },
      toolSelections: [],
      retryCount: 0,
      maxRetries: 1 // Configuration changes should be cautious
    };

    const systemState = {
      activeConnections: ['config_system'],
      resourcesAcquired: ['config_lock'],
      temporaryData: {
        configSnapshot: this.getCurrentConfigSnapshot(),
        safeConfig: this.safeConfig
      },
      processingMetrics: {
        startTime: context.timestamp,
        processingDuration: 0,
        memoryUsage: context.systemContext?.memoryUsage || 0,
        networkCalls: 0
      }
    };

    return this.contextPreserver.preserve(
      context,
      userState,
      operationState,
      systemState,
      {
        priority: PreservationPriority.CRITICAL,
        reason: PreservationReason.ERROR_RECOVERY,
        tags: ['configuration', 'config_change']
      }
    );
  }

  protected getFallbackOperation<T>(
    originalOperation: () => Promise<T>,
    context: EnhancedErrorContext
  ): (() => Promise<T>) | undefined {
    // Configuration fallback should use safe configuration
    return async () => {
      const safeConfigResult = await this.loadSafeConfiguration();
      return safeConfigResult as T;
    };
  }

  /**
   * Perform configuration change
   */
  private async performConfigurationChange(change: ConfigurationChange): Promise<any> {
    // Validate the change if validation is enabled
    if (this.configBoundaryConfig.enableConfigValidation) {
      const validation = await this.validateConfigurationValue(change.path, change.newValue);
      change.validation = validation;
      
      if (!validation.valid) {
        throw new Error(`Configuration validation failed: ${validation.errors.join(', ')}`);
      }
    }

    // Simulate configuration change failure
    if (this.shouldSimulateConfigFailure()) {
      throw new Error('Configuration system temporarily unavailable');
    }

    // Apply the change
    this.setConfigValue(change.path, change.newValue);
    this.pendingChanges.push(change);

    // Simulate processing time
    await new Promise(resolve => setTimeout(resolve, 100));

    return {
      path: change.path,
      applied: true,
      validation: change.validation
    };
  }

  /**
   * Perform configuration rollback
   */
  private async performConfigurationRollback(configPath: string, oldValue: any): Promise<any> {
    // Rollback to previous value
    this.setConfigValue(configPath, oldValue);

    await new Promise(resolve => setTimeout(resolve, 50));

    return {
      path: configPath,
      rolledBack: true,
      restoredValue: oldValue
    };
  }

  /**
   * Perform configuration load
   */
  private async performConfigurationLoad(source: string): Promise<Record<string, any>> {
    // Simulate loading delay
    await new Promise(resolve => setTimeout(resolve, 200));

    // Simulate load failure
    if (this.shouldSimulateConfigFailure()) {
      throw new Error(`Failed to load configuration from ${source}`);
    }

    // Mock configuration based on source
    const mockConfigs = {
      file: {
        slackToken: 'xoxb-mock-file-token',
        jenkinsUrl: 'http://jenkins-file.example.com',
        environment: 'production',
        features: { aiProcessing: true, fallbacks: true }
      },
      environment: {
        slackToken: process.env.SLACK_BOT_TOKEN || 'xoxb-mock-env-token',
        jenkinsUrl: process.env.JENKINS_URL || 'http://jenkins-env.example.com',
        environment: process.env.NODE_ENV || 'development',
        features: { aiProcessing: true, fallbacks: false }
      },
      runtime: {
        slackToken: 'xoxb-mock-runtime-token',
        jenkinsUrl: 'http://jenkins-runtime.example.com',
        environment: 'development',
        features: { aiProcessing: false, fallbacks: true }
      }
    };

    return mockConfigs[source as keyof typeof mockConfigs] || {};
  }

  /**
   * Load safe configuration
   */
  private async loadSafeConfiguration(): Promise<Record<string, any>> {
    await new Promise(resolve => setTimeout(resolve, 50));
    return { ...this.safeConfig };
  }

  /**
   * Perform configuration validation
   */
  private async performConfigurationValidation(
    configuration: Record<string, any>
  ): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    // Simulate validation timeout
    await Promise.race([
      new Promise(resolve => setTimeout(resolve, 100)),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Validation timeout')), this.configBoundaryConfig.validationTimeoutMs)
      )
    ]);

    // Basic validation rules
    if (!configuration.slackToken || !configuration.slackToken.startsWith('xoxb-')) {
      errors.push('Invalid Slack token format');
    }

    if (!configuration.jenkinsUrl || !configuration.jenkinsUrl.startsWith('http')) {
      errors.push('Invalid Jenkins URL format');
    }

    if (!configuration.environment || !['development', 'staging', 'production'].includes(configuration.environment)) {
      errors.push('Invalid environment value');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate individual configuration value
   */
  private async validateConfigurationValue(
    path: string,
    value: any
  ): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    // Path-specific validation
    switch (path) {
      case 'slackToken':
        if (!value || typeof value !== 'string' || !value.startsWith('xoxb-')) {
          errors.push('Slack token must start with "xoxb-"');
        }
        break;
      
      case 'jenkinsUrl':
        if (!value || !value.startsWith('http')) {
          errors.push('Jenkins URL must be a valid HTTP URL');
        }
        break;

      case 'environment':
        if (!['development', 'staging', 'production'].includes(value)) {
          errors.push('Environment must be development, staging, or production');
        }
        break;

      default:
        // No specific validation for unknown paths
        break;
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Initialize safe configuration
   */
  private initializeSafeConfiguration(): void {
    this.safeConfig = {
      slackToken: 'xoxb-safe-fallback-token',
      jenkinsUrl: 'http://localhost:8080',
      environment: 'development',
      features: {
        aiProcessing: false,
        fallbacks: true,
        errorBoundaries: true
      },
      timeouts: {
        toolExecution: 10000,
        aiProcessing: 15000,
        registry: 5000
      },
      boundaries: {
        maxErrors: 3,
        isolationDuration: 300000,
        enableRecovery: true
      }
    };

    this.currentConfig = { ...this.safeConfig };
    this.createConfigurationBackup('initial_safe_config');
  }

  /**
   * Create configuration backup
   */
  private createConfigurationBackup(description: string): boolean {
    try {
      const snapshot: ConfigurationSnapshot = {
        id: `backup_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        timestamp: new Date(),
        configuration: { ...this.currentConfig },
        source: 'backup',
        isValid: true,
        description
      };

      this.configHistory.push(snapshot);

      // Keep only the specified number of backups
      if (this.configHistory.length > this.configBoundaryConfig.configBackupCount) {
        this.configHistory.shift();
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get configuration value by path
   */
  private getConfigValue(path: string): any {
    const pathParts = path.split('.');
    let current = this.currentConfig;

    for (const part of pathParts) {
      if (current && typeof current === 'object' && part in current) {
        current = current[part];
      } else {
        return undefined;
      }
    }

    return current;
  }

  /**
   * Set configuration value by path
   */
  private setConfigValue(path: string, value: any): void {
    const pathParts = path.split('.');
    let current = this.currentConfig;

    // Navigate to the parent object
    for (let i = 0; i < pathParts.length - 1; i++) {
      const part = pathParts[i];
      if (!current[part] || typeof current[part] !== 'object') {
        current[part] = {};
      }
      current = current[part];
    }

    // Set the final value
    current[pathParts[pathParts.length - 1]] = value;
  }

  /**
   * Get current configuration snapshot
   */
  private getCurrentConfigSnapshot(): ConfigurationSnapshot {
    return {
      id: `current_${Date.now()}`,
      timestamp: new Date(),
      configuration: { ...this.currentConfig },
      source: 'current',
      isValid: true
    };
  }

  /**
   * Create configuration context
   */
  private createConfigurationContext(operationName: string): EnhancedErrorContext {
    return {
      timestamp: new Date(),
      severity: 'MEDIUM' as const,
      operation: {
        operationId: `config_${Date.now()}`,
        operationName,
        phase: 'configuration' as const,
        startTime: new Date()
      },
      executionState: {
        processingStage: ProcessingStage.CONFIGURATION_LOAD,
        threadId: 'config',
        completedSteps: [],
        partialResults: {}
      },
      systemContext: {
        environment: 'development'
      },
      correlationId: `config_${Date.now()}`,
      additionalContext: {
        currentConfigSize: Object.keys(this.currentConfig).length,
        backupCount: this.configHistory.length
      }
    } as any;
  }

  /**
   * Should simulate configuration failure
   */
  private shouldSimulateConfigFailure(): boolean {
    // Simulate failures based on boundary state
    if (this.state === BoundaryState.DEGRADED) {
      return Math.random() < 0.25; // 25% failure rate when degraded
    }
    if (this.state === BoundaryState.FAILED) {
      return Math.random() < 0.6; // 60% failure rate when failed
    }
    return Math.random() < 0.05; // 5% baseline failure rate
  }

  /**
   * Get configuration statistics
   */
  getConfigurationStats(): {
    totalBackups: number;
    currentConfigSize: number;
    pendingChanges: number;
    lastBackupTime?: Date;
    safeConfigActive: boolean;
  } {
    return {
      totalBackups: this.configHistory.length,
      currentConfigSize: Object.keys(this.currentConfig).length,
      pendingChanges: this.pendingChanges.length,
      lastBackupTime: this.configHistory.length > 0 
        ? this.configHistory[this.configHistory.length - 1].timestamp 
        : undefined,
      safeConfigActive: JSON.stringify(this.currentConfig) === JSON.stringify(this.safeConfig)
    };
  }

  /**
   * Restore configuration from backup
   */
  restoreFromBackup(backupId: string): boolean {
    const backup = this.configHistory.find(h => h.id === backupId);
    if (!backup) {
      return false;
    }

    this.currentConfig = { ...backup.configuration };
    this.createConfigurationBackup(`restore_from_${backupId}`);
    return true;
  }

  /**
   * Reset to safe configuration
   */
  resetToSafeConfiguration(): void {
    this.currentConfig = { ...this.safeConfig };
    this.pendingChanges = [];
    this.createConfigurationBackup('reset_to_safe');
  }

  /**
   * Get current configuration
   */
  getCurrentConfiguration(): Record<string, any> {
    return { ...this.currentConfig };
  }

  /**
   * Get configuration history
   */
  getConfigurationHistory(): ConfigurationSnapshot[] {
    return [...this.configHistory];
  }

  /**
   * Clear configuration history
   */
  clearConfigurationHistory(): void {
    // Keep only the last 2 backups for safety
    this.configHistory = this.configHistory.slice(-2);
  }
}