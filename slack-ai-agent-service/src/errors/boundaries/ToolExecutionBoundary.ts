/**
 * Tool Execution Boundary - Isolates individual MCP tool failures
 * Prevents tool execution errors from affecting other tools or system components
 */

import { ErrorBoundary, BoundaryType, BoundaryConfig, BoundaryResult } from './ErrorBoundary';
import { EnhancedErrorContext, ProcessingStage, OperationPhase } from '../context/ErrorContext';
import { PreservationReason, PreservationPriority } from '../context/ContextPreserver';
import { RecoveryStrategyManager } from '../recovery/RecoveryStrategy';
import { ContextPreserver } from '../context/ContextPreserver';

export interface ToolExecutionConfig extends BoundaryConfig {
  maxToolFailuresPerSession: number;
  toolTimeoutMs: number;
  enableToolFallback: boolean;
  blacklistAfterFailures: number;
}

export interface ToolExecutionResult<T = any> extends BoundaryResult<T> {
  toolName?: string;
  actionName?: string;
  executionTime: number;
  toolBlacklisted: boolean;
  alternativeToolUsed?: string;
}

export interface ToolMetadata {
  name: string;
  action: string;
  version?: string;
  capabilities: string[];
  fallbacks?: string[];
}

export class ToolExecutionBoundary extends ErrorBoundary {
  private toolFailureCounts: Map<string, number> = new Map();
  private blacklistedTools: Set<string> = new Set();
  private toolExecutionTimes: Map<string, number[]> = new Map();
  private toolConfig: ToolExecutionConfig;

  constructor(
    config: Partial<ToolExecutionConfig> = {},
    recoveryManager?: RecoveryStrategyManager,
    contextPreserver?: ContextPreserver
  ) {
    const toolConfig: ToolExecutionConfig = {
      maxErrorsBeforeDegradation: 2,
      maxErrorsBeforeIsolation: 4,
      recoveryTimeoutMs: 15000,
      isolationDurationMs: 180000, // 3 minutes for tools
      enableAutoRecovery: true,
      escalationThreshold: 6,
      maxToolFailuresPerSession: 3,
      toolTimeoutMs: 10000,
      enableToolFallback: true,
      blacklistAfterFailures: 5,
      ...config
    };

    super(BoundaryType.TOOL_EXECUTION, toolConfig, recoveryManager, contextPreserver);
    this.toolConfig = toolConfig;
  }

  /**
   * Execute a tool operation within the boundary
   */
  async executeToolOperation<T>(
    toolName: string,
    actionName: string,
    operation: () => Promise<T>,
    context: EnhancedErrorContext,
    toolMetadata?: ToolMetadata
  ): Promise<ToolExecutionResult<T>> {
    const toolKey = `${toolName}:${actionName}`;
    const startTime = Date.now();

    // Check if tool is blacklisted
    if (this.isToolBlacklisted(toolKey)) {
      return this.handleBlacklistedTool(toolName, actionName, context, toolMetadata);
    }

    // Check tool-specific failure count
    const toolFailures = this.toolFailureCounts.get(toolKey) || 0;
    if (toolFailures >= this.toolConfig.maxToolFailuresPerSession) {
      return this.handleExcessiveToolFailures(toolName, actionName, context, toolMetadata);
    }

    // Create tool-specific operation with timeout
    const toolOperation = () => this.executeWithTimeout(operation, this.toolConfig.toolTimeoutMs);

    // Get fallback operation if available
    const fallbackOperation = this.getFallbackOperation(toolOperation, context, toolMetadata);

    // Execute within boundary
    const result = await this.execute(toolOperation, context, fallbackOperation);
    const executionTime = Date.now() - startTime;

    // Record execution time
    this.recordToolExecutionTime(toolKey, executionTime);

    // Handle tool-specific results
    if (!result.success && result.error) {
      this.recordToolFailure(toolKey);
      
      // Check if tool should be blacklisted
      const newFailureCount = this.toolFailureCounts.get(toolKey) || 0;
      if (newFailureCount >= this.toolConfig.blacklistAfterFailures) {
        this.blacklistTool(toolKey);
      }
    } else if (result.success) {
      // Reset tool failure count on success
      this.toolFailureCounts.set(toolKey, 0);
    }

    return {
      ...result,
      toolName,
      actionName,
      executionTime,
      toolBlacklisted: this.isToolBlacklisted(toolKey),
      alternativeToolUsed: result.fallbackUsed ? this.getAlternativeTool(toolMetadata) : undefined
    };
  }

  protected shouldPreserveContext(context: EnhancedErrorContext): boolean {
    // Preserve context for tool execution failures
    return context.executionState?.processingStage === ProcessingStage.TOOL_EXECUTION ||
           context.tool !== undefined;
  }

  protected preserveExecutionContext(context: EnhancedErrorContext): string {
    const userState = {
      conversationId: context.userIntent?.conversationId || 'unknown',
      threadId: context.userIntent?.threadId || 'unknown',
      userId: 'unknown', // UserIntent doesn't have userId in current interface
      originalMessage: context.userIntent?.originalMessage || '',
      parsedIntent: context.userIntent?.parsedIntent || '',
      confidence: context.userIntent?.confidence || 0,
      fallbackOptions: context.userIntent?.fallbackOptions || []
    };

    const operationState = {
      operationId: context.correlationId,
      stage: context.executionState?.processingStage || ProcessingStage.TOOL_EXECUTION,
      phase: context.operation?.phase || OperationPhase.TOOL_INVOCATION,
      completedSteps: context.executionState?.completedSteps || [],
      partialResults: context.executionState?.partialResults || {},
      toolSelections: [], // ExecutionState doesn't have toolSelections in current interface
      retryCount: 0,
      maxRetries: 3
    };

    const systemState = {
      activeConnections: context.systemContext?.activeConnections || [],
      resourcesAcquired: [`tool_${context.tool?.toolName}`],
      temporaryData: context.additionalContext || {},
      processingMetrics: {
        startTime: context.timestamp,
        processingDuration: 0, // ExecutionState doesn't have processingDuration in current interface
        memoryUsage: context.systemContext?.memoryUsage || 0,
        networkCalls: 1
      }
    };

    return this.contextPreserver.preserve(
      context,
      userState,
      operationState,
      systemState,
      {
        priority: PreservationPriority.HIGH,
        reason: PreservationReason.ERROR_RECOVERY,
        tags: ['tool_execution', context.tool?.toolName || 'unknown_tool']
      }
    );
  }

  protected getFallbackOperation<T>(
    originalOperation: () => Promise<T>,
    context: EnhancedErrorContext,
    toolMetadata?: ToolMetadata
  ): (() => Promise<T>) | undefined {
    if (!this.toolConfig.enableToolFallback || !toolMetadata?.fallbacks?.length) {
      return undefined;
    }

    // Return first available fallback tool
    const fallbackTool = toolMetadata.fallbacks[0];
    
    return async () => {
      // Simulate fallback tool execution
      // In real implementation, this would invoke the alternative tool
      const fallbackResult = await this.simulateFallbackExecution(
        fallbackTool,
        context,
        toolMetadata
      );
      return fallbackResult as T;
    };
  }

  /**
   * Handle blacklisted tool execution
   */
  private async handleBlacklistedTool<T>(
    toolName: string,
    actionName: string,
    context: EnhancedErrorContext,
    toolMetadata?: ToolMetadata
  ): Promise<ToolExecutionResult<T>> {
    // Try alternative tool if available
    if (toolMetadata?.fallbacks?.length) {
      const alternativeTool = toolMetadata.fallbacks[0];
      const fallbackResult = await this.simulateFallbackExecution(
        alternativeTool,
        context,
        toolMetadata
      );

      return {
        success: true,
        result: fallbackResult as T,
        boundaryState: this.state,
        fallbackUsed: true,
        isolationTriggered: false,
        toolName,
        actionName,
        executionTime: 0,
        toolBlacklisted: true,
        alternativeToolUsed: alternativeTool
      };
    }

    // No alternatives available
    return {
      success: false,
      error: new Error(`Tool ${toolName}:${actionName} is blacklisted and no alternatives available`),
      boundaryState: this.state,
      fallbackUsed: false,
      isolationTriggered: false,
      toolName,
      actionName,
      executionTime: 0,
      toolBlacklisted: true
    };
  }

  /**
   * Handle excessive tool failures
   */
  private async handleExcessiveToolFailures<T>(
    toolName: string,
    actionName: string,
    context: EnhancedErrorContext,
    toolMetadata?: ToolMetadata
  ): Promise<ToolExecutionResult<T>> {
    // Temporarily blacklist the tool
    const toolKey = `${toolName}:${actionName}`;
    this.blacklistTool(toolKey, 60000); // 1 minute temporary blacklist

    return this.handleBlacklistedTool(toolName, actionName, context, toolMetadata);
  }

  /**
   * Simulate fallback tool execution
   */
  private async simulateFallbackExecution(
    fallbackTool: string,
    context: EnhancedErrorContext,
    originalMetadata?: ToolMetadata
  ): Promise<any> {
    // Simulate some processing time
    await new Promise(resolve => setTimeout(resolve, 100));

    // Return fallback result based on original intent
    return {
      status: 'fallback_success',
      tool: fallbackTool,
      originalTool: originalMetadata?.name,
      message: `Operation completed using ${fallbackTool} as fallback`,
      data: context.userIntent?.parsedIntent || 'fallback_data'
    };
  }

  /**
   * Record tool failure
   */
  private recordToolFailure(toolKey: string): void {
    const currentCount = this.toolFailureCounts.get(toolKey) || 0;
    this.toolFailureCounts.set(toolKey, currentCount + 1);
  }

  /**
   * Record tool execution time
   */
  private recordToolExecutionTime(toolKey: string, executionTime: number): void {
    const times = this.toolExecutionTimes.get(toolKey) || [];
    times.push(executionTime);
    
    // Keep only last 10 execution times
    if (times.length > 10) {
      times.shift();
    }
    
    this.toolExecutionTimes.set(toolKey, times);
  }

  /**
   * Check if tool is blacklisted
   */
  private isToolBlacklisted(toolKey: string): boolean {
    return this.blacklistedTools.has(toolKey);
  }

  /**
   * Blacklist a tool
   */
  private blacklistTool(toolKey: string, durationMs?: number): void {
    this.blacklistedTools.add(toolKey);
    
    if (durationMs) {
      // Remove from blacklist after duration
      setTimeout(() => {
        this.blacklistedTools.delete(toolKey);
      }, durationMs);
    }
  }

  /**
   * Get alternative tool name
   */
  private getAlternativeTool(toolMetadata?: ToolMetadata): string | undefined {
    return toolMetadata?.fallbacks?.[0];
  }

  /**
   * Get tool failure statistics
   */
  getToolFailureStats(): Map<string, number> {
    return new Map(this.toolFailureCounts);
  }

  /**
   * Get tool execution statistics
   */
  getToolExecutionStats(): Map<string, { averageTime: number; executionCount: number }> {
    const stats = new Map();
    
    for (const [toolKey, times] of this.toolExecutionTimes) {
      const averageTime = times.reduce((sum, time) => sum + time, 0) / times.length;
      stats.set(toolKey, {
        averageTime: Math.round(averageTime),
        executionCount: times.length
      });
    }
    
    return stats;
  }

  /**
   * Get blacklisted tools
   */
  getBlacklistedTools(): string[] {
    return Array.from(this.blacklistedTools);
  }

  /**
   * Remove tool from blacklist
   */
  removeFromBlacklist(toolKey: string): void {
    this.blacklistedTools.delete(toolKey);
    this.toolFailureCounts.set(toolKey, 0);
  }

  /**
   * Clear all tool statistics
   */
  clearToolStats(): void {
    this.toolFailureCounts.clear();
    this.blacklistedTools.clear();
    this.toolExecutionTimes.clear();
  }
}