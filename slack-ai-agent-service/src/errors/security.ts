import { BaseApplicationError } from './base';
import { ErrorContext, RecoverySuggestion, ErrorCategory, ErrorSeverity } from './types';

/**
 * Security error for MCP credential and authentication issues
 */
export class SecurityError extends BaseApplicationError {
  public readonly securityType: 'authentication' | 'authorization' | 'encryption' | 'validation' | 'credential';
  public readonly resource?: string;
  public readonly userId?: string;

  constructor(
    message: string,
    securityType: 'authentication' | 'authorization' | 'encryption' | 'validation' | 'credential',
    context: Partial<ErrorContext> = {},
    resource?: string,
    userId?: string,
    originalError?: Error
  ) {
    const recoverySuggestions = SecurityError.generateRecoverySuggestions(
      securityType,
      resource,
      userId
    );

    super(
      `Security error (${securityType}): ${message}`,
      ErrorCategory.SECURITY,
      {
        ...context,
        operation: `security_${securityType}`,
        severity: SecurityError.determineSeverity(securityType),
        userId,
        additionalContext: {
          ...context.additionalContext,
          securityType,
          resource: resource ? '[REDACTED]' : undefined, // Don't log sensitive resource info
          hasUserId: !!userId
        }
      },
      recoverySuggestions,
      originalError
    );

    this.securityType = securityType;
    this.resource = resource;
    this.userId = userId;
  }

  private static generateRecoverySuggestions(
    securityType: string,
    resource?: string,
    userId?: string
  ): RecoverySuggestion[] {
    const suggestions: RecoverySuggestion[] = [];

    switch (securityType) {
      case 'authentication':
        suggestions.push(
          {
            action: 'refresh_tokens',
            description: 'Refresh authentication tokens',
            automated: true
          },
          {
            action: 're_authenticate',
            description: 'Re-authenticate user session',
            automated: false
          },
          {
            action: 'check_credential_expiry',
            description: 'Check if credentials have expired',
            automated: true
          }
        );
        break;

      case 'authorization':
        suggestions.push(
          {
            action: 'check_permissions',
            description: 'Verify user permissions for requested resource',
            automated: true
          },
          {
            action: 'request_elevated_access',
            description: 'Request elevated access from administrator',
            automated: false
          }
        );
        if (resource) {
          suggestions.push({
            action: 'verify_resource_access',
            description: 'Verify resource access permissions',
            automated: true
          });
        }
        break;

      case 'encryption':
        suggestions.push(
          {
            action: 'regenerate_encryption_keys',
            description: 'Regenerate encryption keys',
            automated: false
          },
          {
            action: 'check_encryption_config',
            description: 'Verify encryption configuration',
            automated: true
          }
        );
        break;

      case 'validation':
        suggestions.push(
          {
            action: 'sanitize_input',
            description: 'Re-sanitize and validate input parameters',
            automated: true
          },
          {
            action: 'apply_security_rules',
            description: 'Apply security validation rules',
            automated: true
          }
        );
        break;

      case 'credential':
        suggestions.push(
          {
            action: 'rotate_credentials',
            description: 'Rotate affected credentials',
            automated: false
          },
          {
            action: 'verify_credential_store',
            description: 'Verify credential storage integrity',
            automated: true
          },
          {
            action: 'check_mcp_credentials',
            description: 'Verify MCP server credentials',
            automated: true
          }
        );
        break;
    }

    return suggestions;
  }

  private static determineSeverity(securityType: string): ErrorSeverity {
    switch (securityType) {
      case 'authentication':
      case 'authorization':
        return ErrorSeverity.HIGH;
      case 'credential':
      case 'encryption':
        return ErrorSeverity.CRITICAL;
      case 'validation':
        return ErrorSeverity.MEDIUM;
      default:
        return ErrorSeverity.HIGH;
    }
  }

  isRetryable(): boolean {
    // Most security errors are not automatically retryable
    return this.securityType === 'validation' || this.securityType === 'authentication';
  }

  getUserMessage(): string {
    // Always return generic security messages to avoid information disclosure
    switch (this.securityType) {
      case 'authentication':
        return 'Authentication failed. Please verify your credentials and try again.';
      case 'authorization':
        return 'You do not have permission to access this resource.';
      case 'credential':
        return 'Credential verification failed. Please check your configuration.';
      case 'encryption':
        return 'A security error occurred. Please contact your administrator.';
      case 'validation':
        return 'Input validation failed. Please check your request and try again.';
      default:
        return 'A security error occurred. Please contact your administrator.';
    }
  }
}

/**
 * MCP credential error
 */
export class MCPCredentialError extends SecurityError {
  public readonly serverId: string;
  public readonly credentialType: 'api_key' | 'token' | 'certificate' | 'environment';

  constructor(
    message: string,
    serverId: string,
    credentialType: 'api_key' | 'token' | 'certificate' | 'environment',
    context: Partial<ErrorContext> = {},
    originalError?: Error
  ) {
    super(
      `MCP credential error for server '${serverId}': ${message}`,
      'credential',
      {
        ...context,
        serverId,
        additionalContext: {
          ...context.additionalContext,
          serverId,
          credentialType
        }
      },
      serverId,
      context.userId,
      originalError
    );

    this.serverId = serverId;
    this.credentialType = credentialType;
  }
}

/**
 * Authentication error
 */
export class AuthenticationError extends SecurityError {
  public readonly authMethod: 'token' | 'oauth' | 'api_key' | 'certificate';
  public readonly attemptCount: number;

  constructor(
    message: string,
    authMethod: 'token' | 'oauth' | 'api_key' | 'certificate',
    attemptCount = 1,
    context: Partial<ErrorContext> = {},
    originalError?: Error
  ) {
    super(
      `Authentication failed (${authMethod}): ${message}`,
      'authentication',
      {
        ...context,
        additionalContext: {
          ...context.additionalContext,
          authMethod,
          attemptCount
        }
      },
      undefined,
      context.userId,
      originalError
    );

    this.authMethod = authMethod;
    this.attemptCount = attemptCount;
  }

  isRetryable(): boolean {
    // Don't retry too many times to prevent brute force
    return this.attemptCount < 3;
  }
}

/**
 * Authorization error
 */
export class AuthorizationError extends SecurityError {
  public readonly requiredPermissions: string[];
  public readonly userPermissions: string[];
  public readonly action: string;

  constructor(
    message: string,
    action: string,
    requiredPermissions: string[],
    userPermissions: string[],
    context: Partial<ErrorContext> = {},
    originalError?: Error
  ) {
    super(
      `Authorization failed for action '${action}': ${message}`,
      'authorization',
      {
        ...context,
        additionalContext: {
          ...context.additionalContext,
          action,
          requiredPermissionCount: requiredPermissions.length,
          userPermissionCount: userPermissions.length
        }
      },
      action,
      context.userId,
      originalError
    );

    this.requiredPermissions = requiredPermissions;
    this.userPermissions = userPermissions;
    this.action = action;
  }

  getMissingPermissions(): string[] {
    return this.requiredPermissions.filter(perm => !this.userPermissions.includes(perm));
  }
}

/**
 * Input validation security error
 */
export class ValidationSecurityError extends SecurityError {
  public readonly validationType: 'sql_injection' | 'xss' | 'command_injection' | 'path_traversal' | 'format';
  public readonly inputField?: string;

  constructor(
    message: string,
    validationType: 'sql_injection' | 'xss' | 'command_injection' | 'path_traversal' | 'format',
    inputField?: string,
    context: Partial<ErrorContext> = {},
    originalError?: Error
  ) {
    super(
      `Input validation security error (${validationType}): ${message}`,
      'validation',
      {
        ...context,
        additionalContext: {
          ...context.additionalContext,
          validationType,
          inputField
        }
      },
      inputField,
      context.userId,
      originalError
    );

    this.validationType = validationType;
    this.inputField = inputField;
  }

  getUserMessage(): string {
    return 'Invalid input detected. Please check your request and try again.';
  }
}