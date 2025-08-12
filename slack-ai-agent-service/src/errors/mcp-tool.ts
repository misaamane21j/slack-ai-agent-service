import { BaseApplicationError } from './base';
import { ErrorContext, RecoverySuggestion, ErrorCategory, ErrorSeverity } from './types';

/**
 * Base class for all MCP tool-related errors
 */
export class MCPToolError extends BaseApplicationError {
  public readonly serverId: string;
  public readonly toolName?: string;

  constructor(
    message: string,
    serverId: string,
    toolName?: string,
    context: Partial<ErrorContext> = {},
    recoverySuggestions: RecoverySuggestion[] = [],
    originalError?: Error
  ) {
    super(
      message,
      ErrorCategory.MCP_TOOL,
      {
        ...context,
        serverId,
        toolName,
        operation: context.operation || 'mcp_tool_operation'
      },
      recoverySuggestions,
      originalError
    );

    this.serverId = serverId;
    this.toolName = toolName;
  }

  isRetryable(): boolean {
    // MCP tool errors are generally retryable unless they're configuration issues
    return !this.message.includes('configuration') && !this.message.includes('authentication');
  }
}

/**
 * Error during MCP tool registry operations (discovery, registration)
 */
export class MCPRegistryError extends MCPToolError {
  public readonly operation: 'discover' | 'register' | 'validate' | 'cache';

  constructor(
    message: string,
    serverId: string,
    operation: 'discover' | 'register' | 'validate' | 'cache',
    context: Partial<ErrorContext> = {},
    originalError?: Error
  ) {
    const recoverySuggestions: RecoverySuggestion[] = [
      {
        action: 'reconnect_server',
        description: 'Reconnect to the MCP server and retry tool discovery',
        automated: true
      },
      {
        action: 'clear_cache',
        description: 'Clear tool cache and rediscover available tools',
        automated: true
      },
      {
        action: 'check_server_status',
        description: 'Verify MCP server is running and accessible',
        automated: false
      }
    ];

    super(
      `Registry ${operation} failed: ${message}`,
      serverId,
      undefined,
      {
        ...context,
        operation: `registry_${operation}`,
        severity: operation === 'discover' ? ErrorSeverity.HIGH : ErrorSeverity.MEDIUM
      },
      recoverySuggestions,
      originalError
    );

    this.operation = operation;
  }
}

/**
 * Error during MCP tool execution
 */
export class MCPExecutionError extends MCPToolError {
  public readonly parameters?: Record<string, any>;
  public readonly executionTime: number;

  constructor(
    message: string,
    serverId: string,
    toolName: string,
    executionTime: number,
    parameters?: Record<string, any>,
    context: Partial<ErrorContext> = {},
    originalError?: Error
  ) {
    const recoverySuggestions: RecoverySuggestion[] = [
      {
        action: 'retry_with_backoff',
        description: 'Retry tool execution with exponential backoff',
        automated: true
      },
      {
        action: 'validate_parameters',
        description: 'Check and validate tool parameters',
        automated: true
      },
      {
        action: 'fallback_tool',
        description: 'Try alternative tool or fallback response',
        automated: true
      }
    ];

    super(
      `Tool execution failed: ${message}`,
      serverId,
      toolName,
      {
        ...context,
        operation: 'tool_execution',
        severity: executionTime > 30000 ? ErrorSeverity.HIGH : ErrorSeverity.MEDIUM,
        additionalContext: {
          ...context.additionalContext,
          parameters: parameters ? Object.keys(parameters) : undefined,
          executionTime
        }
      },
      recoverySuggestions,
      originalError
    );

    this.parameters = parameters;
    this.executionTime = executionTime;
  }

  isRetryable(): boolean {
    // Don't retry if it's a parameter validation error
    return !this.message.includes('parameter') && !this.message.includes('validation');
  }
}

/**
 * Error in MCP tool response processing
 */
export class MCPResponseError extends MCPToolError {
  public readonly responseType: 'empty' | 'malformed' | 'invalid' | 'timeout';
  public readonly rawResponse?: any;

  constructor(
    message: string,
    serverId: string,
    toolName: string,
    responseType: 'empty' | 'malformed' | 'invalid' | 'timeout',
    rawResponse?: any,
    context: Partial<ErrorContext> = {},
    originalError?: Error
  ) {
    const recoverySuggestions: RecoverySuggestion[] = [
      {
        action: 'parse_alternative',
        description: 'Attempt alternative response parsing strategies',
        automated: true
      },
      {
        action: 'request_raw_response',
        description: 'Request raw response from tool for manual processing',
        automated: false
      }
    ];

    if (responseType === 'timeout') {
      recoverySuggestions.push({
        action: 'increase_timeout',
        description: 'Increase timeout and retry request',
        automated: true
      });
    }

    super(
      `Response processing failed: ${message}`,
      serverId,
      toolName,
      {
        ...context,
        operation: 'response_processing',
        severity: responseType === 'timeout' ? ErrorSeverity.HIGH : ErrorSeverity.MEDIUM,
        additionalContext: {
          ...context.additionalContext,
          responseType,
          hasRawResponse: !!rawResponse
        }
      },
      recoverySuggestions,
      originalError
    );

    this.responseType = responseType;
    this.rawResponse = rawResponse;
  }

  isRetryable(): boolean {
    return this.responseType === 'timeout' || this.responseType === 'empty';
  }
}