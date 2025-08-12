/**
 * Error handling system for Slack AI Agent Service
 * Provides comprehensive error classes with rich context and recovery suggestions
 */

// Base error class
export { BaseApplicationError } from './base';

// Error types and interfaces
export {
  ErrorSeverity,
  ErrorContext,
  RecoverySuggestion,
  ErrorMetadata,
  ErrorCategory
} from './types';

// MCP Tool errors
export {
  MCPToolError,
  MCPRegistryError,
  MCPExecutionError,
  MCPResponseError
} from './mcp-tool';

// AI Processing errors
export {
  AIProcessingError,
  ToolCapabilityError,
  AIQuotaError
} from './ai-processing';

// Configuration errors
export {
  ConfigurationError,
  MCPServerConfigError,
  EnvironmentConfigError,
  ConfigValidationError
} from './configuration';

// Dependency injection errors
export {
  DependencyInjectionError,
  ServiceRegistrationError,
  CircularDependencyError,
  MissingDependencyError
} from './dependency';

// Security errors
export {
  SecurityError,
  MCPCredentialError,
  AuthenticationError,
  AuthorizationError,
  ValidationSecurityError
} from './security';

// Enhanced Error Context system (Task 6.2)
export {
  EnhancedErrorContext,
  ErrorContextBuilder,
  ErrorContextUtils,
  OperationDetails,
  ToolMetadata,
  UserIntent,
  ExecutionState,
  OperationPhase,
  ProcessingStage
} from './context/ErrorContext';

// Recovery Strategy system (Task 6.2)
export {
  RecoveryStrategy,
  RetryStrategy,
  FallbackStrategy,
  CircuitBreakerStrategy,
  RecoveryStrategyManager,
  RecoveryStrategyType,
  RecoveryResult,
  RecoveryContext,
  RecoveryAttempt
} from './recovery/RecoveryStrategy';

// Error Impact Assessment (Task 6.2)
export {
  ErrorImpactAssessment,
  ErrorImpactFactory,
  ImpactLevel,
  UserExperienceMetric,
  ResponseType,
  ImpactMetrics,
  UserContext,
  BusinessContext
} from './impact/ErrorImpact';

// Dynamic Error Messaging (Task 6.2)
export {
  ErrorMessageBuilder,
  ErrorMessageFactory,
  ErrorMessage,
  SlackErrorMessage,
  InteractiveErrorMessage,
  MessageButton,
  MessageForm,
  MessageUrgency,
  MessageTone
} from './messaging/ErrorMessageBuilder';

// Context Preservation (Task 6.2)
export {
  ContextPreserver,
  PreservedState,
  PreservationReason,
  PreservationPriority,
  UserState,
  OperationState,
  SystemState,
  ContinuationPlan,
  PreservationStatistics
} from './context/ContextPreserver';

/**
 * Utility functions for error handling
 */

/**
 * Check if error is one of our application errors
 */
export function isApplicationError(error: unknown): error is BaseApplicationError {
  return error instanceof BaseApplicationError;
}

/**
 * Get error category from any error
 */
export function getErrorCategory(error: unknown): ErrorCategory | 'UNKNOWN' {
  if (isApplicationError(error)) {
    return error.category;
  }
  return 'UNKNOWN';
}

/**
 * Get error severity from any error
 */
export function getErrorSeverity(error: unknown): ErrorSeverity {
  if (isApplicationError(error)) {
    return error.context.severity;
  }
  // Default severity for non-application errors
  return ErrorSeverity.MEDIUM;
}

/**
 * Check if error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  if (isApplicationError(error)) {
    return error.isRetryable();
  }
  
  // Check for common retryable error patterns
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return message.includes('timeout') || 
           message.includes('network') || 
           message.includes('temporary') ||
           message.includes('rate limit');
  }
  
  return false;
}

/**
 * Extract user-friendly message from any error
 */
export function getUserMessage(error: unknown): string {
  if (isApplicationError(error)) {
    return error.getUserMessage();
  }
  
  if (error instanceof Error) {
    // Don't expose internal error details to users
    return 'An unexpected error occurred. Please try again.';
  }
  
  return 'An unknown error occurred.';
}

/**
 * Get recovery suggestions from any error
 */
export function getRecoveryActions(error: unknown): string[] {
  if (isApplicationError(error)) {
    return error.getRecoveryActions();
  }
  
  // Default recovery suggestions for non-application errors
  return [
    'Try again',
    'Check your internet connection',
    'Contact support if the problem persists'
  ];
}