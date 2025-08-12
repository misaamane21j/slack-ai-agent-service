/**
 * Enhanced ErrorContext interface for comprehensive error tracking and recovery
 */

import { ErrorSeverity } from '../types';

export interface OperationDetails {
  name: string;
  phase: OperationPhase;
  startTime: Date;
  duration?: number;
  retryAttempt?: number;
  maxRetries?: number;
}

export interface ToolMetadata {
  serverId: string;
  toolName: string;
  version?: string;
  capabilities?: string[];
  configuration?: Record<string, unknown>;
}

export interface UserIntent {
  originalMessage: string;
  parsedIntent: string;
  confidence: number;
  fallbackOptions?: string[];
  conversationId: string;
  threadId?: string;
}

export interface ExecutionState {
  processingStage: ProcessingStage;
  completedSteps: string[];
  failedStep?: string;
  resourcesAcquired: string[];
  rollbackRequired: boolean;
  partialResults?: Record<string, unknown>;
}

export enum OperationPhase {
  INITIALIZATION = 'INITIALIZATION',
  VALIDATION = 'VALIDATION',
  TOOL_DISCOVERY = 'TOOL_DISCOVERY',
  TOOL_SELECTION = 'TOOL_SELECTION',
  TOOL_INVOCATION = 'TOOL_INVOCATION',
  RESULT_PROCESSING = 'RESULT_PROCESSING',
  RESPONSE_FORMATTING = 'RESPONSE_FORMATTING',
  CLEANUP = 'CLEANUP'
}

export enum ProcessingStage {
  REQUEST_RECEIVED = 'REQUEST_RECEIVED',
  CONTEXT_GATHERING = 'CONTEXT_GATHERING',
  AI_PROCESSING = 'AI_PROCESSING',
  TOOL_EXECUTION = 'TOOL_EXECUTION',
  RESULT_VALIDATION = 'RESULT_VALIDATION',
  RESPONSE_GENERATION = 'RESPONSE_GENERATION',
  DELIVERY = 'DELIVERY',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED'
}

/**
 * Enhanced ErrorContext with comprehensive tracking capabilities
 */
export interface EnhancedErrorContext {
  // Basic error context
  timestamp: Date;
  severity: ErrorSeverity;
  
  // Operation tracking
  operation: OperationDetails;
  
  // Tool and service context
  tool?: ToolMetadata;
  
  // User interaction context
  userIntent?: UserIntent;
  
  // Execution state tracking
  executionState: ExecutionState;
  
  // System context
  systemContext: {
    memoryUsage?: number;
    activeConnections?: number;
    serverLoad?: number;
    environment: string;
  };
  
  // Error correlation
  correlationId: string;
  parentErrorId?: string;
  childErrors?: string[];
  
  // Additional context for extensibility
  additionalContext?: Record<string, unknown>;
}

/**
 * Builder class for creating ErrorContext instances
 */
export class ErrorContextBuilder {
  private context: Partial<EnhancedErrorContext> = {};

  static create(): ErrorContextBuilder {
    return new ErrorContextBuilder();
  }

  withTimestamp(timestamp: Date = new Date()): this {
    this.context.timestamp = timestamp;
    return this;
  }

  withSeverity(severity: ErrorSeverity): this {
    this.context.severity = severity;
    return this;
  }

  withOperation(name: string, phase: OperationPhase, startTime?: Date): this {
    this.context.operation = {
      name,
      phase,
      startTime: startTime || new Date()
    };
    return this;
  }

  withTool(serverId: string, toolName: string, metadata?: Partial<ToolMetadata>): this {
    this.context.tool = {
      serverId,
      toolName,
      ...metadata
    };
    return this;
  }

  withUserIntent(originalMessage: string, parsedIntent: string, confidence: number, conversationId: string): this {
    this.context.userIntent = {
      originalMessage,
      parsedIntent,
      confidence,
      conversationId
    };
    return this;
  }

  withExecutionState(stage: ProcessingStage): this {
    this.context.executionState = {
      processingStage: stage,
      completedSteps: [],
      resourcesAcquired: [],
      rollbackRequired: false
    };
    return this;
  }

  withSystemContext(environment: string): this {
    this.context.systemContext = { environment };
    return this;
  }

  withCorrelationId(correlationId: string): this {
    this.context.correlationId = correlationId;
    return this;
  }

  withParentError(parentErrorId: string): this {
    this.context.parentErrorId = parentErrorId;
    return this;
  }

  withAdditionalContext(key: string, value: unknown): this {
    if (!this.context.additionalContext) {
      this.context.additionalContext = {};
    }
    this.context.additionalContext[key] = value;
    return this;
  }

  build(): EnhancedErrorContext {
    // Ensure required fields are present
    if (!this.context.timestamp) {
      this.context.timestamp = new Date();
    }
    if (!this.context.severity) {
      this.context.severity = ErrorSeverity.MEDIUM;
    }
    if (!this.context.correlationId) {
      this.context.correlationId = this.generateCorrelationId();
    }
    if (!this.context.systemContext) {
      this.context.systemContext = { environment: process.env.NODE_ENV || 'development' };
    }
    if (!this.context.executionState) {
      this.context.executionState = {
        processingStage: ProcessingStage.FAILED,
        completedSteps: [],
        resourcesAcquired: [],
        rollbackRequired: false
      };
    }

    return this.context as EnhancedErrorContext;
  }

  private generateCorrelationId(): string {
    return `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

/**
 * Utility functions for working with ErrorContext
 */
export class ErrorContextUtils {
  /**
   * Create a child error context inheriting from parent
   */
  static createChild(parentContext: EnhancedErrorContext, operation: string, phase: OperationPhase): EnhancedErrorContext {
    return ErrorContextBuilder.create()
      .withSeverity(parentContext.severity)
      .withOperation(operation, phase)
      .withUserIntent(
        parentContext.userIntent?.originalMessage || '',
        parentContext.userIntent?.parsedIntent || '',
        parentContext.userIntent?.confidence || 0,
        parentContext.userIntent?.conversationId || ''
      )
      .withSystemContext(parentContext.systemContext.environment)
      .withParentError(parentContext.correlationId)
      .build();
  }

  /**
   * Check if error context indicates a retryable operation
   */
  static isRetryable(context: EnhancedErrorContext): boolean {
    if (!context.operation) return false;

    const retryablePhases = [
      OperationPhase.TOOL_DISCOVERY,
      OperationPhase.TOOL_INVOCATION,
      OperationPhase.RESULT_PROCESSING
    ];

    return retryablePhases.includes(context.operation.phase) &&
           (context.operation.retryAttempt || 0) < (context.operation.maxRetries || 3);
  }

  /**
   * Update operation timing information
   */
  static updateTiming(context: EnhancedErrorContext, startTime?: Date): EnhancedErrorContext {
    const now = new Date();
    const opStartTime = startTime || context.operation?.startTime || now;
    
    return {
      ...context,
      operation: {
        ...context.operation,
        duration: now.getTime() - opStartTime.getTime()
      }
    };
  }

  /**
   * Add completed step to execution state
   */
  static addCompletedStep(context: EnhancedErrorContext, step: string): EnhancedErrorContext {
    return {
      ...context,
      executionState: {
        ...context.executionState,
        completedSteps: [...context.executionState.completedSteps, step]
      }
    };
  }

  /**
   * Mark step as failed in execution state
   */
  static markStepFailed(context: EnhancedErrorContext, step: string): EnhancedErrorContext {
    return {
      ...context,
      executionState: {
        ...context.executionState,
        failedStep: step,
        rollbackRequired: true
      }
    };
  }
}