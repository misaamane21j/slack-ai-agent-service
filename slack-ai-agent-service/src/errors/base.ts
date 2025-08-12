import { ErrorContext, RecoverySuggestion, ErrorMetadata, ErrorCategory, ErrorSeverity } from './types';

/**
 * Base abstract class for all application errors with rich context information
 */
export abstract class BaseApplicationError extends Error {
  public readonly context: ErrorContext;
  public readonly category: ErrorCategory;
  public readonly metadata: ErrorMetadata;
  public readonly recoverySuggestions: RecoverySuggestion[];
  public readonly originalError?: Error;

  constructor(
    message: string,
    category: ErrorCategory,
    context: Partial<ErrorContext>,
    recoverySuggestions: RecoverySuggestion[] = [],
    originalError?: Error
  ) {
    super(message);
    this.name = this.constructor.name;
    
    // Ensure error stack is captured
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }

    this.category = category;
    this.originalError = originalError;
    this.recoverySuggestions = recoverySuggestions;
    
    // Build complete error context with defaults
    this.context = {
      timestamp: new Date(),
      operation: 'unknown',
      severity: ErrorSeverity.MEDIUM,
      ...context
    };

    // Generate error metadata
    this.metadata = {
      errorId: this.generateErrorId(),
      correlationId: context.additionalContext?.correlationId as string,
      userAgent: context.additionalContext?.userAgent as string,
      requestId: context.additionalContext?.requestId as string,
      sessionId: context.additionalContext?.sessionId as string
    };
  }

  /**
   * Generate a unique error ID for tracking
   */
  private generateErrorId(): string {
    const timestamp = this.context.timestamp.getTime().toString(36);
    const random = Math.random().toString(36).substr(2, 9);
    return `${this.category.toLowerCase()}_${timestamp}_${random}`;
  }

  /**
   * Convert error to structured object for logging/monitoring
   */
  toJSON(): Record<string, any> {
    return {
      name: this.name,
      message: this.message,
      category: this.category,
      context: this.context,
      metadata: this.metadata,
      recoverySuggestions: this.recoverySuggestions,
      stack: this.stack,
      originalError: this.originalError ? {
        name: this.originalError.name,
        message: this.originalError.message,
        stack: this.originalError.stack
      } : undefined
    };
  }

  /**
   * Get user-friendly error message (without sensitive information)
   */
  getUserMessage(): string {
    switch (this.context.severity) {
      case ErrorSeverity.CRITICAL:
        return 'A critical system error occurred. Please try again later or contact support.';
      case ErrorSeverity.HIGH:
        return 'An error occurred while processing your request. Please try again.';
      case ErrorSeverity.MEDIUM:
        return 'Something went wrong. Please try again or check your input.';
      case ErrorSeverity.LOW:
        return this.message; // Low severity errors can show more detail
      default:
        return 'An unexpected error occurred.';
    }
  }

  /**
   * Check if error is retryable based on category and context
   */
  isRetryable(): boolean {
    // Override in subclasses for specific retry logic
    return false;
  }

  /**
   * Get suggested recovery actions
   */
  getRecoveryActions(): string[] {
    return this.recoverySuggestions.map(s => s.description);
  }

  /**
   * Get automated recovery suggestions
   */
  getAutomatedRecoveryActions(): RecoverySuggestion[] {
    return this.recoverySuggestions.filter(s => s.automated);
  }
}