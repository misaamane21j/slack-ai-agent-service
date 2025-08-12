/**
 * Dynamic error messaging system that adapts messages based on response type and context
 */

import { EnhancedErrorContext, ProcessingStage, OperationPhase } from '../context/ErrorContext';
import { ErrorSeverity } from '../types';
import { ImpactMetrics, ResponseType, ImpactLevel, UserExperienceMetric } from '../impact/ErrorImpact';
import { RecoveryResult, RecoveryAttempt, RecoveryStrategyType } from '../recovery/RecoveryStrategy';

export interface ErrorMessage {
  primary: string;                    // Main error message
  secondary?: string;                 // Additional context/explanation  
  actionable?: string[];              // Suggested user actions
  technical?: string;                 // Technical details (for debugging)
  recovery?: string;                  // Recovery status/progress
  emoji?: string;                     // Appropriate emoji for the message
  urgency?: MessageUrgency;           // Message urgency level
}

export interface SlackErrorMessage extends ErrorMessage {
  blocks?: any[];                     // Slack Block Kit elements
  attachments?: any[];                // Slack attachments
  threadReply?: boolean;              // Should be sent as thread reply
  reactions?: string[];               // Suggested reactions to add
}

export interface InteractiveErrorMessage extends ErrorMessage {
  buttons?: MessageButton[];          // Action buttons
  forms?: MessageForm[];              // Input forms
  quickReplies?: string[];            // Quick response options
}

export interface MessageButton {
  id: string;
  label: string;
  action: 'retry' | 'fallback' | 'escalate' | 'cancel' | 'custom';
  style?: 'primary' | 'secondary' | 'danger';
  confirm?: boolean;                  // Require confirmation
}

export interface MessageForm {
  id: string;
  title: string;
  fields: FormField[];
}

export interface FormField {
  id: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'textarea';
  required?: boolean;
  options?: string[];
}

export enum MessageUrgency {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM', 
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL'
}

export enum MessageTone {
  PROFESSIONAL = 'PROFESSIONAL',
  FRIENDLY = 'FRIENDLY',
  APOLOGETIC = 'APOLOGETIC',
  URGENT = 'URGENT',
  REASSURING = 'REASSURING',
  TECHNICAL = 'TECHNICAL'
}

/**
 * Core error message builder
 */
export class ErrorMessageBuilder {
  private errorContext: EnhancedErrorContext;
  private impactMetrics: ImpactMetrics;
  private recoveryAttempts: RecoveryAttempt[];
  private responseType: ResponseType;
  private tone: MessageTone;
  private includeRecoveryInfo: boolean;

  constructor(
    errorContext: EnhancedErrorContext,
    impactMetrics: ImpactMetrics,
    responseType: ResponseType = ResponseType.TEXT,
    recoveryAttempts: RecoveryAttempt[] = []
  ) {
    this.errorContext = errorContext;
    this.impactMetrics = impactMetrics;
    this.recoveryAttempts = recoveryAttempts;
    this.responseType = responseType;
    this.tone = this.determineTone(impactMetrics, recoveryAttempts);
    this.includeRecoveryInfo = recoveryAttempts.length > 0;
  }

  /**
   * Build base error message
   */
  buildMessage(): ErrorMessage {
    const primary = this.buildPrimaryMessage();
    const secondary = this.buildSecondaryMessage();
    const actionable = this.buildActionableItems();
    const recovery = this.includeRecoveryInfo ? this.buildRecoveryMessage() : undefined;
    const emoji = this.selectEmoji();
    const urgency = this.determineUrgency();

    return {
      primary,
      secondary,
      actionable,
      recovery,
      emoji,
      urgency
    };
  }

  /**
   * Build Slack-specific error message
   */
  buildSlackMessage(): SlackErrorMessage {
    const baseMessage = this.buildMessage();
    const blocks = this.buildSlackBlocks();
    const reactions = this.suggestReactions();
    const threadReply = this.shouldReplyInThread();

    return {
      ...baseMessage,
      blocks,
      reactions,
      threadReply
    };
  }

  /**
   * Build interactive error message with buttons and forms
   */
  buildInteractiveMessage(): InteractiveErrorMessage {
    const baseMessage = this.buildMessage();
    const buttons = this.buildActionButtons();
    const quickReplies = this.buildQuickReplies();

    return {
      ...baseMessage,
      buttons,
      quickReplies
    };
  }

  /**
   * Build primary error message based on context and impact
   */
  private buildPrimaryMessage(): string {
    const operation = this.errorContext.operation;
    const tool = this.errorContext.tool;
    const stage = this.errorContext.executionState.processingStage;
    
    // Customize message based on processing stage
    switch (stage) {
      case ProcessingStage.AI_PROCESSING:
        return this.buildAIProcessingMessage();
      case ProcessingStage.TOOL_EXECUTION:
        return this.buildToolExecutionMessage();
      case ProcessingStage.RESULT_VALIDATION:
        return this.buildValidationMessage();
      case ProcessingStage.RESPONSE_GENERATION:
        return this.buildResponseGenerationMessage();
      default:
        return this.buildGenericMessage();
    }
  }

  private buildAIProcessingMessage(): string {
    const intent = this.errorContext.userIntent?.parsedIntent;
    
    switch (this.tone) {
      case MessageTone.APOLOGETIC:
        return `I apologize, but I'm having trouble understanding your request${intent ? ` about "${intent}"` : ''}. Let me try a different approach.`;
      case MessageTone.FRIENDLY:
        return `Hmm, I'm having a bit of trouble figuring out exactly what you'd like me to do${intent ? ` with "${intent}"` : ''}. Could you help me understand better?`;
      case MessageTone.TECHNICAL:
        return `AI processing failed during intent analysis${intent ? ` for request: "${intent}"` : ''}. Attempting alternative processing method.`;
      default:
        return `I'm unable to process your request at the moment${intent ? ` regarding "${intent}"` : ''}. Please try rephrasing or try again later.`;
    }
  }

  private buildToolExecutionMessage(): string {
    const toolName = this.errorContext.tool?.toolName;
    const serverId = this.errorContext.tool?.serverId;
    
    switch (this.tone) {
      case MessageTone.APOLOGETIC:
        return `I'm sorry, but I encountered an issue while trying to ${this.getToolActionDescription(toolName)}${serverId ? ` using ${serverId}` : ''}.`;
      case MessageTone.TECHNICAL:
        return `Tool execution failed: ${toolName || 'unknown tool'}${serverId ? ` on server ${serverId}` : ''}`;
      case MessageTone.REASSURING:
        return `I ran into a temporary issue with ${this.getToolActionDescription(toolName)}. Don't worry, I'm working on fixing this.`;
      default:
        return `Unable to complete the ${this.getToolActionDescription(toolName)} operation. Please try again.`;
    }
  }

  private buildValidationMessage(): string {
    switch (this.tone) {
      case MessageTone.APOLOGETIC:
        return "I'm sorry, but there seems to be an issue with the data I received. Let me try to resolve this.";
      case MessageTone.TECHNICAL:
        return "Result validation failed. Data integrity check did not pass.";
      default:
        return "I received unexpected results and need to validate them before proceeding.";
    }
  }

  private buildResponseGenerationMessage(): string {
    switch (this.tone) {
      case MessageTone.FRIENDLY:
        return "I have the information you requested, but I'm having trouble formatting it properly. Give me a moment to sort this out.";
      case MessageTone.TECHNICAL:
        return "Response generation failed. Unable to format results for delivery.";
      default:
        return "I'm having trouble preparing your response. Please wait while I resolve this.";
    }
  }

  private buildGenericMessage(): string {
    switch (this.impactMetrics.level) {
      case ImpactLevel.CRITICAL:
        return "I'm experiencing a critical issue and unable to complete your request.";
      case ImpactLevel.HIGH:
        return "I've encountered a significant problem that's preventing me from helping you right now.";
      case ImpactLevel.MODERATE:
        return "I'm having some trouble with your request, but I'm working on resolving it.";
      case ImpactLevel.LOW:
        return "I ran into a minor issue. Let me try again.";
      default:
        return "Something went wrong, but it should be resolved quickly.";
    }
  }

  /**
   * Build secondary context message
   */
  private buildSecondaryMessage(): string | undefined {
    const messages: string[] = [];

    // Add timing information
    if (this.impactMetrics.userVisibleDelay > 5000) {
      const seconds = Math.ceil(this.impactMetrics.userVisibleDelay / 1000);
      messages.push(`This may take up to ${seconds} seconds to resolve.`);
    }

    // Add impact information  
    if (this.impactMetrics.affectedMetrics.includes(UserExperienceMetric.FEATURE_UNAVAILABILITY)) {
      messages.push("Some features may be temporarily unavailable.");
    }

    // Add confidence information if available
    if (this.errorContext.userIntent?.confidence && this.errorContext.userIntent.confidence < 0.7) {
      messages.push("I may have misunderstood your request. Please feel free to clarify.");
    }

    return messages.length > 0 ? messages.join(' ') : undefined;
  }

  /**
   * Build actionable items for user
   */
  private buildActionableItems(): string[] {
    const actions: string[] = [];

    // Context-specific actions
    const stage = this.errorContext.executionState.processingStage;
    
    switch (stage) {
      case ProcessingStage.AI_PROCESSING:
        actions.push("Try rephrasing your request");
        actions.push("Be more specific about what you'd like me to do");
        break;
      case ProcessingStage.TOOL_EXECUTION:
        actions.push("Wait a moment and try again");
        if (this.errorContext.tool?.serverId) {
          actions.push(`Check if ${this.errorContext.tool.serverId} is accessible`);
        }
        break;
    }

    // Generic fallback actions
    if (actions.length === 0) {
      actions.push("Try again in a few moments");
      actions.push("Rephrase your request");
    }

    // Add escalation option for high impact
    if (this.impactMetrics.level === ImpactLevel.HIGH || this.impactMetrics.level === ImpactLevel.CRITICAL) {
      actions.push("Contact support if the issue persists");
    }

    return actions;
  }

  /**
   * Build recovery status message
   */
  private buildRecoveryMessage(): string {
    if (this.recoveryAttempts.length === 0) {
      return "I'm working on resolving this issue.";
    }

    const lastAttempt = this.recoveryAttempts[this.recoveryAttempts.length - 1];
    const failedAttempts = this.recoveryAttempts.filter(a => a.result === RecoveryResult.FAILED);
    
    switch (lastAttempt.result) {
      case RecoveryResult.SUCCESS:
        return "✅ Issue resolved successfully!";
      case RecoveryResult.PARTIAL_SUCCESS:
        return "🔄 Making progress on resolving the issue...";
      case RecoveryResult.FAILED:
        if (failedAttempts.length > 2) {
          return "⚠️ Multiple recovery attempts have failed. Escalating to support.";
        }
        return "🔄 That didn't work. Trying a different approach...";
      case RecoveryResult.NEEDS_ESCALATION:
        return "⚠️ This issue requires manual intervention. Support has been notified.";
      default:
        return "🔄 Working on a solution...";
    }
  }

  /**
   * Build Slack blocks for rich formatting
   */
  private buildSlackBlocks(): any[] {
    const blocks: any[] = [];
    const message = this.buildMessage();

    // Main message block
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${message.emoji || '⚠️'} *${message.primary}*`
      }
    });

    // Secondary info block
    if (message.secondary) {
      blocks.push({
        type: "context",
        elements: [{
          type: "mrkdwn",
          text: message.secondary
        }]
      });
    }

    // Recovery status block
    if (message.recovery) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: message.recovery
        }
      });
    }

    // Action items block
    if (message.actionable && message.actionable.length > 0) {
      const actionText = message.actionable
        .map(action => `• ${action}`)
        .join('\n');
      
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*You can try:*\n${actionText}`
        }
      });
    }

    return blocks;
  }

  /**
   * Build action buttons for interactive messages
   */
  private buildActionButtons(): MessageButton[] {
    const buttons: MessageButton[] = [];

    // Retry button for retryable errors
    if (this.isRetryable()) {
      buttons.push({
        id: 'retry',
        label: 'Try Again',
        action: 'retry',
        style: 'primary'
      });
    }

    // Fallback options
    if (this.errorContext.userIntent?.fallbackOptions) {
      buttons.push({
        id: 'fallback',
        label: 'Use Alternative',
        action: 'fallback',
        style: 'secondary'
      });
    }

    // Escalation for high impact errors
    if (this.impactMetrics.level === ImpactLevel.HIGH || this.impactMetrics.level === ImpactLevel.CRITICAL) {
      buttons.push({
        id: 'escalate',
        label: 'Contact Support',
        action: 'escalate',
        style: 'danger',
        confirm: true
      });
    }

    return buttons;
  }

  /**
   * Build quick reply options
   */
  private buildQuickReplies(): string[] {
    const replies: string[] = [];

    if (this.errorContext.executionState.processingStage === ProcessingStage.AI_PROCESSING) {
      replies.push("Can you explain differently?");
      replies.push("What options do I have?");
    }

    replies.push("Try again");
    replies.push("Cancel");

    return replies;
  }

  /**
   * Suggest emoji for the error message
   */
  private selectEmoji(): string {
    switch (this.impactMetrics.level) {
      case ImpactLevel.CRITICAL:
        return '🚨';
      case ImpactLevel.HIGH:
        return '⚠️';
      case ImpactLevel.MODERATE:
        return '⚡';
      case ImpactLevel.LOW:
        return '🔄';
      default:
        return '💭';
    }
  }

  /**
   * Suggest reactions for Slack messages
   */
  private suggestReactions(): string[] {
    const reactions: string[] = [];

    switch (this.impactMetrics.level) {
      case ImpactLevel.CRITICAL:
        reactions.push('🚨', '😬');
        break;
      case ImpactLevel.HIGH:
        reactions.push('⚠️', '😅');
        break;
      case ImpactLevel.MODERATE:
        reactions.push('🔄', '🤖');
        break;
      case ImpactLevel.LOW:
        reactions.push('👍', '🔧');
        break;
    }

    return reactions;
  }

  /**
   * Determine message tone based on impact and recovery attempts
   */
  private determineTone(impactMetrics: ImpactMetrics, recoveryAttempts: RecoveryAttempt[]): MessageTone {
    const failedAttempts = recoveryAttempts.filter(a => a.result === RecoveryResult.FAILED);
    
    if (impactMetrics.level === ImpactLevel.CRITICAL) {
      return MessageTone.URGENT;
    }
    
    if (failedAttempts.length > 1) {
      return MessageTone.APOLOGETIC;
    }

    if (impactMetrics.confidenceLoss > 0.5) {
      return MessageTone.REASSURING;
    }

    return MessageTone.FRIENDLY;
  }

  /**
   * Determine message urgency
   */
  private determineUrgency(): MessageUrgency {
    switch (this.impactMetrics.level) {
      case ImpactLevel.CRITICAL:
        return MessageUrgency.CRITICAL;
      case ImpactLevel.HIGH:
        return MessageUrgency.HIGH;
      case ImpactLevel.MODERATE:
        return MessageUrgency.MEDIUM;
      default:
        return MessageUrgency.LOW;
    }
  }

  /**
   * Check if error should be replied in thread
   */
  private shouldReplyInThread(): boolean {
    // Reply in thread for lower impact errors to reduce noise
    return this.impactMetrics.level === ImpactLevel.LOW || this.impactMetrics.level === ImpactLevel.MINIMAL;
  }

  /**
   * Check if the error is retryable
   */
  private isRetryable(): boolean {
    const retryableStages = [
      ProcessingStage.AI_PROCESSING,
      ProcessingStage.TOOL_EXECUTION,
      ProcessingStage.RESULT_VALIDATION
    ];

    return retryableStages.includes(this.errorContext.executionState.processingStage);
  }

  /**
   * Get human-friendly description of tool action
   */
  private getToolActionDescription(toolName?: string): string {
    if (!toolName) return 'the requested action';

    const descriptions: Record<string, string> = {
      'trigger_jenkins_job': 'trigger the build',
      'create_github_issue': 'create the issue',
      'database_query': 'query the database',
      'send_notification': 'send the notification'
    };

    return descriptions[toolName] || `run ${toolName}`;
  }
}

/**
 * Factory for creating error message builders
 */
export class ErrorMessageFactory {
  /**
   * Create message builder for Slack context
   */
  static forSlack(
    errorContext: EnhancedErrorContext,
    impactMetrics: ImpactMetrics,
    recoveryAttempts?: RecoveryAttempt[]
  ): ErrorMessageBuilder {
    return new ErrorMessageBuilder(
      errorContext,
      impactMetrics,
      ResponseType.TEXT,
      recoveryAttempts
    );
  }

  /**
   * Create message builder for interactive context
   */
  static forInteractive(
    errorContext: EnhancedErrorContext,
    impactMetrics: ImpactMetrics,
    recoveryAttempts?: RecoveryAttempt[]
  ): ErrorMessageBuilder {
    return new ErrorMessageBuilder(
      errorContext,
      impactMetrics,
      ResponseType.INTERACTIVE,
      recoveryAttempts
    );
  }

  /**
   * Create message builder with auto-detected response type
   */
  static autoDetect(
    errorContext: EnhancedErrorContext,
    impactMetrics: ImpactMetrics,
    recoveryAttempts?: RecoveryAttempt[]
  ): ErrorMessageBuilder {
    // Auto-detect response type based on context
    const responseType = errorContext.userIntent?.fallbackOptions 
      ? ResponseType.INTERACTIVE 
      : ResponseType.TEXT;

    return new ErrorMessageBuilder(
      errorContext,
      impactMetrics,
      responseType,
      recoveryAttempts
    );
  }
}