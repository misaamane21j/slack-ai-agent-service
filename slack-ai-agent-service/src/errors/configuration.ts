import { BaseApplicationError } from './base';
import { ErrorContext, RecoverySuggestion, ErrorCategory, ErrorSeverity } from './types';

/**
 * Configuration error for runtime MCP server management
 */
export class ConfigurationError extends BaseApplicationError {
  public readonly configType: 'server' | 'environment' | 'validation' | 'runtime';
  public readonly configPath?: string;
  public readonly missingFields?: string[];

  constructor(
    message: string,
    configType: 'server' | 'environment' | 'validation' | 'runtime',
    context: Partial<ErrorContext> = {},
    configPath?: string,
    missingFields?: string[],
    originalError?: Error
  ) {
    const recoverySuggestions = ConfigurationError.generateRecoverySuggestions(
      configType, 
      configPath, 
      missingFields
    );

    super(
      `Configuration error (${configType}): ${message}`,
      ErrorCategory.CONFIGURATION,
      {
        ...context,
        operation: `config_${configType}`,
        severity: ConfigurationError.determineSeverity(configType, missingFields),
        additionalContext: {
          ...context.additionalContext,
          configType,
          configPath,
          missingFields
        }
      },
      recoverySuggestions,
      originalError
    );

    this.configType = configType;
    this.configPath = configPath;
    this.missingFields = missingFields;
  }

  private static generateRecoverySuggestions(
    configType: string,
    configPath?: string,
    missingFields?: string[]
  ): RecoverySuggestion[] {
    const suggestions: RecoverySuggestion[] = [];

    switch (configType) {
      case 'server':
        suggestions.push(
          {
            action: 'reload_server_config',
            description: 'Reload MCP server configuration from file',
            automated: true
          },
          {
            action: 'validate_server_config',
            description: 'Validate server configuration format and required fields',
            automated: true
          }
        );
        if (configPath) {
          suggestions.push({
            action: 'check_config_file',
            description: `Verify configuration file exists and is readable: ${configPath}`,
            automated: false
          });
        }
        break;

      case 'environment':
        suggestions.push(
          {
            action: 'check_environment_variables',
            description: 'Verify all required environment variables are set',
            automated: false
          },
          {
            action: 'use_default_values',
            description: 'Fall back to default configuration values where possible',
            automated: true
          }
        );
        if (missingFields?.length) {
          suggestions.push({
            action: 'set_missing_env_vars',
            description: `Set missing environment variables: ${missingFields.join(', ')}`,
            automated: false
          });
        }
        break;

      case 'validation':
        suggestions.push(
          {
            action: 'fix_validation_errors',
            description: 'Correct configuration validation errors',
            automated: false
          },
          {
            action: 'use_safe_defaults',
            description: 'Apply safe default values for invalid configurations',
            automated: true
          }
        );
        break;

      case 'runtime':
        suggestions.push(
          {
            action: 'restart_services',
            description: 'Restart affected services with updated configuration',
            automated: true
          },
          {
            action: 'rollback_config',
            description: 'Roll back to last known good configuration',
            automated: true
          }
        );
        break;
    }

    return suggestions;
  }

  private static determineSeverity(
    configType: string, 
    missingFields?: string[]
  ): ErrorSeverity {
    switch (configType) {
      case 'runtime':
        return ErrorSeverity.CRITICAL;
      case 'server':
        return ErrorSeverity.HIGH;
      case 'environment':
        return missingFields?.length && missingFields.length > 2 ? 
               ErrorSeverity.HIGH : ErrorSeverity.MEDIUM;
      case 'validation':
      default:
        return ErrorSeverity.MEDIUM;
    }
  }

  isRetryable(): boolean {
    // Runtime and server configuration errors are generally retryable after fixes
    return this.configType === 'runtime' || this.configType === 'server';
  }
}

/**
 * MCP server configuration error
 */
export class MCPServerConfigError extends ConfigurationError {
  public readonly serverId: string;
  public readonly serverCommand?: string;

  constructor(
    message: string,
    serverId: string,
    serverCommand?: string,
    missingFields?: string[],
    context: Partial<ErrorContext> = {},
    originalError?: Error
  ) {
    super(
      `MCP server configuration error for '${serverId}': ${message}`,
      'server',
      {
        ...context,
        serverId,
        additionalContext: {
          ...context.additionalContext,
          serverId,
          serverCommand
        }
      },
      undefined,
      missingFields,
      originalError
    );

    this.serverId = serverId;
    this.serverCommand = serverCommand;
  }
}

/**
 * Environment variable configuration error
 */
export class EnvironmentConfigError extends ConfigurationError {
  public readonly requiredVariables: string[];
  public readonly providedVariables: string[];

  constructor(
    message: string,
    requiredVariables: string[],
    providedVariables: string[],
    context: Partial<ErrorContext> = {},
    originalError?: Error
  ) {
    const missingFields = requiredVariables.filter(req => !providedVariables.includes(req));

    super(
      `Environment configuration error: ${message}`,
      'environment',
      {
        ...context,
        additionalContext: {
          ...context.additionalContext,
          requiredCount: requiredVariables.length,
          providedCount: providedVariables.length,
          missingCount: missingFields.length
        }
      },
      undefined,
      missingFields,
      originalError
    );

    this.requiredVariables = requiredVariables;
    this.providedVariables = providedVariables;
  }
}

/**
 * Configuration validation error
 */
export class ConfigValidationError extends ConfigurationError {
  public readonly validationErrors: Array<{
    field: string;
    value: any;
    constraint: string;
  }>;

  constructor(
    message: string,
    validationErrors: Array<{
      field: string;
      value: any;
      constraint: string;
    }>,
    context: Partial<ErrorContext> = {},
    originalError?: Error
  ) {
    super(
      `Configuration validation failed: ${message}`,
      'validation',
      {
        ...context,
        additionalContext: {
          ...context.additionalContext,
          errorCount: validationErrors.length,
          failedFields: validationErrors.map(e => e.field)
        }
      },
      undefined,
      validationErrors.map(e => e.field),
      originalError
    );

    this.validationErrors = validationErrors;
  }
}