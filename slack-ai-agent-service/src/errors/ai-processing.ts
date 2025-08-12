import { BaseApplicationError } from './base';
import { ErrorContext, RecoverySuggestion, ErrorCategory, ErrorSeverity } from './types';

/**
 * Enhanced AI processing error for tool selection and capability matching
 */
export class AIProcessingError extends BaseApplicationError {
  public readonly processingStage: 'parsing' | 'tool_selection' | 'capability_matching' | 'response_generation';
  public readonly modelUsed?: string;
  public readonly inputTokens?: number;
  public readonly attemptCount: number;

  constructor(
    message: string,
    processingStage: 'parsing' | 'tool_selection' | 'capability_matching' | 'response_generation',
    attemptCount = 1,
    context: Partial<ErrorContext> = {},
    modelUsed?: string,
    inputTokens?: number,
    originalError?: Error
  ) {
    const recoverySuggestions = AIProcessingError.generateRecoverySuggestions(processingStage, attemptCount);

    super(
      `AI processing failed at ${processingStage}: ${message}`,
      ErrorCategory.AI_PROCESSING,
      {
        ...context,
        operation: `ai_${processingStage}`,
        severity: AIProcessingError.determineSeverity(processingStage, attemptCount),
        additionalContext: {
          ...context.additionalContext,
          processingStage,
          modelUsed,
          inputTokens,
          attemptCount
        }
      },
      recoverySuggestions,
      originalError
    );

    this.processingStage = processingStage;
    this.modelUsed = modelUsed;
    this.inputTokens = inputTokens;
    this.attemptCount = attemptCount;
  }

  private static generateRecoverySuggestions(
    stage: string,
    attemptCount: number
  ): RecoverySuggestion[] {
    const suggestions: RecoverySuggestion[] = [];

    switch (stage) {
      case 'parsing':
        suggestions.push(
          {
            action: 'retry_with_simplified_prompt',
            description: 'Retry with a simplified prompt structure',
            automated: true
          },
          {
            action: 'use_fallback_parser',
            description: 'Use fallback parsing strategy',
            automated: true
          }
        );
        break;

      case 'tool_selection':
        suggestions.push(
          {
            action: 'broaden_tool_search',
            description: 'Expand tool selection criteria',
            automated: true
          },
          {
            action: 'use_default_tool',
            description: 'Fall back to default tool selection',
            automated: true
          },
          {
            action: 'manual_tool_suggestion',
            description: 'Ask user to specify preferred tool',
            automated: false
          }
        );
        break;

      case 'capability_matching':
        suggestions.push(
          {
            action: 'relaxed_matching',
            description: 'Use relaxed capability matching criteria',
            automated: true
          },
          {
            action: 'partial_match_fallback',
            description: 'Accept partial capability matches',
            automated: true
          }
        );
        break;

      case 'response_generation':
        suggestions.push(
          {
            action: 'use_template_response',
            description: 'Generate response using predefined template',
            automated: true
          },
          {
            action: 'reduce_response_complexity',
            description: 'Simplify response structure and content',
            automated: true
          }
        );
        break;
    }

    // Add retry suggestion if not too many attempts
    if (attemptCount < 3) {
      suggestions.unshift({
        action: 'retry_processing',
        description: 'Retry AI processing with the same parameters',
        automated: true
      });
    }

    return suggestions;
  }

  private static determineSeverity(stage: string, attemptCount: number): ErrorSeverity {
    if (attemptCount > 2) {
      return ErrorSeverity.HIGH;
    }

    switch (stage) {
      case 'tool_selection':
      case 'capability_matching':
        return ErrorSeverity.HIGH;
      case 'response_generation':
        return ErrorSeverity.MEDIUM;
      case 'parsing':
      default:
        return ErrorSeverity.MEDIUM;
    }
  }

  isRetryable(): boolean {
    return this.attemptCount < 3 && 
           !this.message.includes('quota') && 
           !this.message.includes('authentication');
  }
}

/**
 * Error in tool capability assessment
 */
export class ToolCapabilityError extends AIProcessingError {
  public readonly requestedCapabilities: string[];
  public readonly availableTools: string[];

  constructor(
    message: string,
    requestedCapabilities: string[],
    availableTools: string[],
    context: Partial<ErrorContext> = {},
    originalError?: Error
  ) {
    super(
      `Tool capability mismatch: ${message}`,
      'capability_matching',
      1,
      {
        ...context,
        additionalContext: {
          ...context.additionalContext,
          requestedCapabilities,
          availableToolCount: availableTools.length
        }
      },
      undefined,
      undefined,
      originalError
    );

    this.requestedCapabilities = requestedCapabilities;
    this.availableTools = availableTools;
  }
}

/**
 * Error in AI model quota or rate limiting
 */
export class AIQuotaError extends AIProcessingError {
  public readonly quotaType: 'rate_limit' | 'token_limit' | 'usage_limit';
  public readonly resetTime?: Date;

  constructor(
    message: string,
    quotaType: 'rate_limit' | 'token_limit' | 'usage_limit',
    resetTime?: Date,
    context: Partial<ErrorContext> = {},
    originalError?: Error
  ) {
    const recoverySuggestions: RecoverySuggestion[] = [
      {
        action: 'wait_and_retry',
        description: `Wait until ${resetTime?.toISOString() || 'quota resets'} and retry`,
        automated: true
      },
      {
        action: 'use_fallback_model',
        description: 'Switch to alternative AI model',
        automated: true
      }
    ];

    super(
      `AI quota exceeded: ${message}`,
      'response_generation',
      1,
      {
        ...context,
        severity: ErrorSeverity.MEDIUM,
        additionalContext: {
          ...context.additionalContext,
          quotaType,
          resetTime: resetTime?.toISOString()
        }
      },
      undefined,
      undefined,
      originalError
    );

    this.quotaType = quotaType;
    this.resetTime = resetTime;
  }

  isRetryable(): boolean {
    return this.quotaType === 'rate_limit' || (this.quotaType === 'usage_limit' && !!this.resetTime);
  }
}