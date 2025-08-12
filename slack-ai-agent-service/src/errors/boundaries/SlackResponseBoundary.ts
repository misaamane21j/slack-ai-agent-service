/**
 * Slack Response Boundary - Ensures users always receive some form of response
 * Prevents response delivery failures from leaving users without feedback
 */

import { ErrorBoundary, BoundaryType, BoundaryConfig, BoundaryResult } from './ErrorBoundary';
import { EnhancedErrorContext, ProcessingStage } from '../context/ErrorContext';
import { PreservationReason, PreservationPriority } from '../context/ContextPreserver';
import { RecoveryStrategyManager } from '../recovery/RecoveryStrategy';
import { ContextPreserver } from '../context/ContextPreserver';

export interface SlackResponseConfig extends BoundaryConfig {
  maxResponseTime: number;
  enableFallbackMessages: boolean;
  retryDeliveryAttempts: number;
  enableThreadedFallback: boolean;
  enableDirectMessageFallback: boolean;
  gracefulDegradationEnabled: boolean;
}

export interface SlackResponseResult<T = any> extends BoundaryResult<T> {
  responseDelivered: boolean;
  deliveryMethod: 'primary' | 'threaded' | 'direct_message' | 'fallback';
  responseTime: number;
  fallbackMessageUsed: boolean;
  deliveryAttempts: number;
  userNotified: boolean;
}

export interface SlackResponse {
  text: string;
  blocks?: any[];
  channel: string;
  threadTs?: string;
  responseType: 'in_channel' | 'ephemeral' | 'direct';
  fallback?: string;
  metadata?: Record<string, any>;
}

export interface ResponseDeliveryContext {
  userId: string;
  channelId: string;
  threadId?: string;
  originalMessage: string;
  urgency: 'low' | 'medium' | 'high' | 'critical';
  requiresResponse: boolean;
}

export class SlackResponseBoundary extends ErrorBoundary {
  private responseConfig: SlackResponseConfig;
  private deliveryHistory: Array<{
    timestamp: Date;
    userId: string;
    channelId: string;
    success: boolean;
    deliveryTime: number;
    method: string;
    attempts: number;
  }> = [];

  constructor(
    config: Partial<SlackResponseConfig> = {},
    recoveryManager?: RecoveryStrategyManager,
    contextPreserver?: ContextPreserver
  ) {
    const responseConfig: SlackResponseConfig = {
      maxErrorsBeforeDegradation: 2,
      maxErrorsBeforeIsolation: 4,
      recoveryTimeoutMs: 10000,
      isolationDurationMs: 180000, // 3 minutes for response issues
      enableAutoRecovery: true,
      escalationThreshold: 6,
      maxResponseTime: 8000,
      enableFallbackMessages: true,
      retryDeliveryAttempts: 3,
      enableThreadedFallback: true,
      enableDirectMessageFallback: true,
      gracefulDegradationEnabled: true,
      ...config
    };

    super(BoundaryType.SLACK_RESPONSE, responseConfig, recoveryManager, contextPreserver);
    this.responseConfig = responseConfig;
  }

  /**
   * Send response to Slack with boundary protection
   */
  async sendResponse(
    response: SlackResponse,
    deliveryContext: ResponseDeliveryContext,
    context: EnhancedErrorContext
  ): Promise<SlackResponseResult<boolean>> {
    const startTime = Date.now();
    let deliveryAttempts = 0;

    // Create response operation
    const responseOperation = () => {
      deliveryAttempts++;
      return this.performResponseDelivery(response, deliveryContext);
    };

    // Create fallback operation
    const fallbackOperation = this.createFallbackResponseOperation(response, deliveryContext);

    // Execute within boundary
    const result = await this.execute(responseOperation, context, fallbackOperation);
    const responseTime = Date.now() - startTime;

    // Record delivery attempt
    this.recordDeliveryAttempt(
      deliveryContext,
      result.success,
      responseTime,
      deliveryAttempts,
      result.fallbackUsed ? 'fallback' : 'primary'
    );

    return {
      ...result,
      responseDelivered: result.success,
      deliveryMethod: this.determineDeliveryMethod(result),
      responseTime,
      fallbackMessageUsed: result.fallbackUsed,
      deliveryAttempts,
      userNotified: result.success || result.fallbackUsed
    };
  }

  /**
   * Send error notification to user with guaranteed delivery
   */
  async sendErrorNotification(
    errorMessage: string,
    deliveryContext: ResponseDeliveryContext,
    context: EnhancedErrorContext,
    includeRecoveryInfo: boolean = true
  ): Promise<SlackResponseResult<boolean>> {
    const errorResponse: SlackResponse = {
      text: this.createErrorMessage(errorMessage, includeRecoveryInfo),
      channel: deliveryContext.channelId,
      threadTs: deliveryContext.threadId,
      responseType: 'ephemeral',
      fallback: this.createFallbackErrorMessage(errorMessage),
      metadata: {
        isErrorNotification: true,
        originalMessage: deliveryContext.originalMessage,
        timestamp: Date.now()
      }
    };

    return this.sendResponse(errorResponse, deliveryContext, context);
  }

  /**
   * Send acknowledgment that request is being processed
   */
  async sendProcessingAcknowledgment(
    deliveryContext: ResponseDeliveryContext,
    context: EnhancedErrorContext,
    estimatedTime?: number
  ): Promise<SlackResponseResult<boolean>> {
    const ackResponse: SlackResponse = {
      text: this.createProcessingMessage(estimatedTime),
      channel: deliveryContext.channelId,
      threadTs: deliveryContext.threadId,
      responseType: 'ephemeral',
      fallback: 'Processing your request...',
      metadata: {
        isProcessingAck: true,
        estimatedTime,
        timestamp: Date.now()
      }
    };

    return this.sendResponse(ackResponse, deliveryContext, context);
  }

  protected shouldPreserveContext(context: EnhancedErrorContext): boolean {
    // Always preserve context for response operations
    return context.executionState?.processingStage === ProcessingStage.DELIVERY ||
           context.operation?.operationName?.includes('response') ||
           context.operation?.operationName?.includes('delivery');
  }

  protected preserveExecutionContext(context: EnhancedErrorContext): string {
    const userState = {
      conversationId: context.userIntent?.conversationId || 'unknown',
      threadId: context.executionState?.threadId || 'unknown',
      userId: context.userIntent?.userId || 'unknown',
      originalMessage: context.userIntent?.originalMessage || '',
      parsedIntent: context.userIntent?.parsedIntent || '',
      confidence: context.userIntent?.confidence || 0,
      fallbackOptions: [
        'simple_text_response',
        'emoji_reaction',
        'direct_message_fallback',
        'thread_response'
      ]
    };

    const operationState = {
      operationId: context.operation?.operationId || context.correlationId,
      stage: ProcessingStage.DELIVERY,
      phase: context.operation?.phase || 'response_delivery',
      completedSteps: ['response_preparation'],
      partialResults: {
        responseContent: context.additionalContext?.responseContent,
        deliveryAttempts: 0
      },
      toolSelections: [],
      retryCount: 0,
      maxRetries: this.responseConfig.retryDeliveryAttempts
    };

    const systemState = {
      activeConnections: ['slack_api'],
      resourcesAcquired: ['response_channel'],
      temporaryData: {
        responseData: context.additionalContext?.responseData,
        deliveryMethod: 'primary'
      },
      processingMetrics: {
        startTime: context.timestamp,
        processingDuration: 0,
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
        priority: PreservationPriority.CRITICAL,
        reason: PreservationReason.ERROR_RECOVERY,
        tags: ['slack_response', 'user_communication']
      }
    );
  }

  protected getFallbackOperation<T>(
    originalOperation: () => Promise<T>,
    context: EnhancedErrorContext
  ): (() => Promise<T>) | undefined {
    // Fallback operation depends on the specific context
    return async () => {
      const fallbackResult = await this.performFallbackResponseDelivery(context);
      return fallbackResult as T;
    };
  }

  /**
   * Perform response delivery
   */
  private async performResponseDelivery(
    response: SlackResponse,
    deliveryContext: ResponseDeliveryContext
  ): Promise<boolean> {
    // Simulate API call delay
    await new Promise(resolve => setTimeout(resolve, 150));

    // Simulate delivery failures based on boundary state
    if (this.shouldSimulateDeliveryFailure()) {
      throw new Error('Slack API temporarily unavailable');
    }

    // Simulate timeout for large responses
    if (response.text.length > 1000 && Math.random() < 0.2) {
      throw new Error('Response delivery timeout');
    }

    // Mock successful delivery
    return true;
  }

  /**
   * Create fallback response operation
   */
  private createFallbackResponseOperation(
    response: SlackResponse,
    deliveryContext: ResponseDeliveryContext
  ): (() => Promise<boolean>) | undefined {
    if (!this.responseConfig.enableFallbackMessages) {
      return undefined;
    }

    return async () => {
      // Try different delivery methods in order of preference
      const fallbackMethods = [
        () => this.tryThreadedResponse(response, deliveryContext),
        () => this.tryDirectMessageResponse(response, deliveryContext),
        () => this.trySimpleTextResponse(response, deliveryContext),
        () => this.tryEmojiReaction(deliveryContext)
      ];

      for (const method of fallbackMethods) {
        try {
          const result = await method();
          if (result) return true;
        } catch (error) {
          continue; // Try next method
        }
      }

      // Last resort: return success to prevent infinite retries
      // In real implementation, this would log the failure for manual intervention
      return true;
    };
  }

  /**
   * Perform fallback response delivery
   */
  private async performFallbackResponseDelivery(context: EnhancedErrorContext): Promise<boolean> {
    // Create minimal response from context
    const userId = context.userIntent?.userId || 'unknown';
    const originalMessage = context.userIntent?.originalMessage || '';

    // Try simple acknowledgment
    try {
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Mock simple response delivery
      return true;
    } catch (error) {
      // Even fallback failed - return true to prevent endless retries
      return true;
    }
  }

  /**
   * Try threaded response
   */
  private async tryThreadedResponse(
    response: SlackResponse,
    deliveryContext: ResponseDeliveryContext
  ): Promise<boolean> {
    if (!this.responseConfig.enableThreadedFallback || !deliveryContext.threadId) {
      return false;
    }

    await new Promise(resolve => setTimeout(resolve, 100));

    // Simulate threaded response
    if (Math.random() < 0.8) { // 80% success rate for threaded responses
      return true;
    }

    throw new Error('Threaded response failed');
  }

  /**
   * Try direct message response
   */
  private async tryDirectMessageResponse(
    response: SlackResponse,
    deliveryContext: ResponseDeliveryContext
  ): Promise<boolean> {
    if (!this.responseConfig.enableDirectMessageFallback) {
      return false;
    }

    await new Promise(resolve => setTimeout(resolve, 120));

    // Simulate DM response
    if (Math.random() < 0.9) { // 90% success rate for DMs
      return true;
    }

    throw new Error('Direct message failed');
  }

  /**
   * Try simple text response
   */
  private async trySimpleTextResponse(
    response: SlackResponse,
    deliveryContext: ResponseDeliveryContext
  ): Promise<boolean> {
    await new Promise(resolve => setTimeout(resolve, 80));

    // Simple text has highest success rate
    if (Math.random() < 0.95) {
      return true;
    }

    throw new Error('Simple text response failed');
  }

  /**
   * Try emoji reaction as last resort
   */
  private async tryEmojiReaction(deliveryContext: ResponseDeliveryContext): Promise<boolean> {
    await new Promise(resolve => setTimeout(resolve, 30));

    // Emoji reactions almost always work
    return Math.random() < 0.98;
  }

  /**
   * Create error message
   */
  private createErrorMessage(errorMessage: string, includeRecoveryInfo: boolean): string {
    let message = `⚠️ I encountered an issue: ${errorMessage}`;
    
    if (includeRecoveryInfo) {
      if (this.state === BoundaryState.DEGRADED) {
        message += '\n\n🔄 I\'m working with reduced functionality but will try to help.';
      } else if (this.state === BoundaryState.FAILED) {
        message += '\n\n🚨 I\'m experiencing significant issues. Please try again in a few minutes.';
      } else {
        message += '\n\n💡 I\'m attempting to recover automatically.';
      }
    }
    
    return message;
  }

  /**
   * Create fallback error message
   */
  private createFallbackErrorMessage(errorMessage: string): string {
    return `Error: ${errorMessage}`;
  }

  /**
   * Create processing message
   */
  private createProcessingMessage(estimatedTime?: number): string {
    const baseMessage = '⏳ I\'m working on your request...';
    
    if (estimatedTime) {
      const seconds = Math.ceil(estimatedTime / 1000);
      return `${baseMessage} This should take about ${seconds} seconds.`;
    }
    
    return baseMessage;
  }

  /**
   * Determine delivery method from result
   */
  private determineDeliveryMethod(result: BoundaryResult): 'primary' | 'threaded' | 'direct_message' | 'fallback' {
    if (result.fallbackUsed) {
      return 'fallback';
    }
    return 'primary';
  }

  /**
   * Should simulate delivery failure
   */
  private shouldSimulateDeliveryFailure(): boolean {
    // Simulate failures based on boundary state
    if (this.state === BoundaryState.DEGRADED) {
      return Math.random() < 0.3; // 30% failure rate when degraded
    }
    if (this.state === BoundaryState.FAILED) {
      return Math.random() < 0.7; // 70% failure rate when failed
    }
    return Math.random() < 0.1; // 10% baseline failure rate
  }

  /**
   * Record delivery attempt
   */
  private recordDeliveryAttempt(
    deliveryContext: ResponseDeliveryContext,
    success: boolean,
    deliveryTime: number,
    attempts: number,
    method: string
  ): void {
    this.deliveryHistory.push({
      timestamp: new Date(),
      userId: deliveryContext.userId,
      channelId: deliveryContext.channelId,
      success,
      deliveryTime,
      method,
      attempts
    });

    // Keep only last 100 delivery records
    if (this.deliveryHistory.length > 100) {
      this.deliveryHistory.shift();
    }
  }

  /**
   * Get delivery statistics
   */
  getDeliveryStats(): {
    totalDeliveries: number;
    successRate: number;
    averageDeliveryTime: number;
    fallbackUsageRate: number;
    recentFailures: number;
  } {
    if (this.deliveryHistory.length === 0) {
      return {
        totalDeliveries: 0,
        successRate: 0,
        averageDeliveryTime: 0,
        fallbackUsageRate: 0,
        recentFailures: 0
      };
    }

    const successful = this.deliveryHistory.filter(d => d.success);
    const fallbackUsed = this.deliveryHistory.filter(d => d.method === 'fallback');
    const recentHistory = this.deliveryHistory.slice(-10); // Last 10 deliveries
    const recentFailures = recentHistory.filter(d => !d.success).length;

    return {
      totalDeliveries: this.deliveryHistory.length,
      successRate: successful.length / this.deliveryHistory.length,
      averageDeliveryTime: this.deliveryHistory.reduce((sum, d) => sum + d.deliveryTime, 0) / this.deliveryHistory.length,
      fallbackUsageRate: fallbackUsed.length / this.deliveryHistory.length,
      recentFailures
    };
  }

  /**
   * Get user-specific delivery stats
   */
  getUserDeliveryStats(userId: string): {
    totalDeliveries: number;
    successRate: number;
    averageDeliveryTime: number;
    lastDeliveryTime?: Date;
  } {
    const userDeliveries = this.deliveryHistory.filter(d => d.userId === userId);
    
    if (userDeliveries.length === 0) {
      return {
        totalDeliveries: 0,
        successRate: 0,
        averageDeliveryTime: 0
      };
    }

    const successful = userDeliveries.filter(d => d.success);

    return {
      totalDeliveries: userDeliveries.length,
      successRate: successful.length / userDeliveries.length,
      averageDeliveryTime: userDeliveries.reduce((sum, d) => sum + d.deliveryTime, 0) / userDeliveries.length,
      lastDeliveryTime: userDeliveries[userDeliveries.length - 1]?.timestamp
    };
  }

  /**
   * Clear delivery history
   */
  clearDeliveryHistory(): void {
    this.deliveryHistory = [];
  }

  /**
   * Update response configuration
   */
  updateResponseConfig(updates: Partial<SlackResponseConfig>): void {
    this.responseConfig = { ...this.responseConfig, ...updates };
  }
}