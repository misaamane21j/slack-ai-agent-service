/**
 * AI Processing Boundary - Contains tool selection and processing failures
 * Prevents AI processing errors from affecting system stability
 */

import { ErrorBoundary, BoundaryType, BoundaryConfig, BoundaryResult } from './ErrorBoundary';
import { EnhancedErrorContext, ProcessingStage } from '../context/ErrorContext';
import { PreservationReason, PreservationPriority } from '../context/ContextPreserver';
import { RecoveryStrategyManager } from '../recovery/RecoveryStrategy';
import { ContextPreserver } from '../context/ContextPreserver';

export interface AIProcessingConfig extends BoundaryConfig {
  maxProcessingTimeMs: number;
  enableSimplifiedFallback: boolean;
  maxTokensPerRequest: number;
  confidenceThreshold: number;
  enableContextReduction: boolean;
  fallbackPromptStrategy: 'simplified' | 'structured' | 'minimal';
}

export interface AIProcessingResult<T = any> extends BoundaryResult<T> {
  processingTime: number;
  tokensUsed: number;
  confidence: number;
  fallbackStrategy?: string;
  contextReduced: boolean;
  simplifiedResponse: boolean;
}

export interface AIResponse {
  content: string;
  confidence: number;
  toolSelection?: string;
  reasoning?: string;
  alternatives?: string[];
  metadata: Record<string, any>;
}

export interface ProcessingContext {
  userMessage: string;
  conversationHistory: string[];
  availableTools: string[];
  userIntent?: string;
  confidence?: number;
}

export class AIProcessingBoundary extends ErrorBoundary {
  private aiConfig: AIProcessingConfig;
  private processingHistory: Array<{
    timestamp: Date;
    processingTime: number;
    success: boolean;
    tokensUsed: number;
    confidence: number;
  }> = [];

  constructor(
    config: Partial<AIProcessingConfig> = {},
    recoveryManager?: RecoveryStrategyManager,
    contextPreserver?: ContextPreserver
  ) {
    const aiConfig: AIProcessingConfig = {
      maxErrorsBeforeDegradation: 3,
      maxErrorsBeforeIsolation: 5,
      recoveryTimeoutMs: 20000,
      isolationDurationMs: 600000, // 10 minutes for AI processing
      enableAutoRecovery: true,
      escalationThreshold: 8,
      maxProcessingTimeMs: 15000,
      enableSimplifiedFallback: true,
      maxTokensPerRequest: 4000,
      confidenceThreshold: 0.7,
      enableContextReduction: true,
      fallbackPromptStrategy: 'simplified',
      ...config
    };

    super(BoundaryType.AI_PROCESSING, aiConfig, recoveryManager, contextPreserver);
    this.aiConfig = aiConfig;
  }

  /**
   * Process user request with AI within boundary protection
   */
  async processUserRequest(
    processingContext: ProcessingContext,
    context: EnhancedErrorContext
  ): Promise<AIProcessingResult<AIResponse>> {
    const startTime = Date.now();

    // Create processing operation
    const processingOperation = () => this.performAIProcessing(processingContext);

    // Create fallback operation
    const fallbackOperation = this.aiConfig.enableSimplifiedFallback
      ? () => this.performSimplifiedProcessing(processingContext)
      : undefined;

    // Execute within boundary
    const result = await this.execute(processingOperation, context, fallbackOperation);
    const processingTime = Date.now() - startTime;

    // Record processing history
    this.recordProcessingAttempt(
      processingTime,
      result.success,
      result.result?.metadata?.tokensUsed || 0,
      result.result?.confidence || 0
    );

    return {
      ...result,
      processingTime,
      tokensUsed: result.result?.metadata?.tokensUsed || 0,
      confidence: result.result?.confidence || 0,
      fallbackStrategy: result.fallbackUsed ? this.aiConfig.fallbackPromptStrategy : undefined,
      contextReduced: result.result?.metadata?.contextReduced || false,
      simplifiedResponse: result.fallbackUsed || false
    };
  }

  /**
   * Select tool for user intent with boundary protection
   */
  async selectTool(
    userIntent: string,
    availableTools: string[],
    context: EnhancedErrorContext
  ): Promise<AIProcessingResult<{ tool: string; confidence: number }>> {
    const startTime = Date.now();

    const selectionOperation = () => this.performToolSelection(userIntent, availableTools);
    const fallbackOperation = () => this.performFallbackToolSelection(userIntent, availableTools);

    const result = await this.execute(selectionOperation, context, fallbackOperation);
    const processingTime = Date.now() - startTime;

    return {
      ...result,
      processingTime,
      tokensUsed: 0, // Tool selection typically uses fewer tokens
      confidence: result.result?.confidence || 0,
      fallbackStrategy: result.fallbackUsed ? 'rule_based' : undefined,
      contextReduced: false,
      simplifiedResponse: result.fallbackUsed || false
    };
  }

  protected shouldPreserveContext(context: EnhancedErrorContext): boolean {
    // Preserve context for AI processing failures
    return context.executionState?.processingStage === ProcessingStage.AI_PROCESSING ||
           context.executionState?.processingStage === ProcessingStage.INTENT_ANALYSIS ||
           context.operation?.operationName?.includes('ai_processing');
  }

  protected preserveExecutionContext(context: EnhancedErrorContext): string {
    const userState = {
      conversationId: context.userIntent?.conversationId || 'ai_processing',
      threadId: context.executionState?.threadId || 'ai',
      userId: context.userIntent?.userId || 'unknown',
      originalMessage: context.userIntent?.originalMessage || '',
      parsedIntent: context.userIntent?.parsedIntent || '',
      confidence: context.userIntent?.confidence || 0,
      fallbackOptions: this.generateFallbackOptions(context)
    };

    const operationState = {
      operationId: context.operation?.operationId || context.correlationId,
      stage: ProcessingStage.AI_PROCESSING,
      phase: context.operation?.phase || 'processing',
      completedSteps: ['intent_extraction', 'context_preparation'],
      partialResults: {
        userMessage: context.userIntent?.originalMessage,
        preprocessedText: context.additionalContext?.preprocessedText,
        contextLength: context.additionalContext?.contextLength
      },
      toolSelections: context.executionState?.toolSelections || [],
      retryCount: 0,
      maxRetries: 2
    };

    const systemState = {
      activeConnections: ['ai_service'],
      resourcesAcquired: ['ai_processing_slot'],
      temporaryData: {
        processingContext: context.additionalContext,
        modelParameters: { maxTokens: this.aiConfig.maxTokensPerRequest }
      },
      processingMetrics: {
        startTime: context.timestamp,
        processingDuration: context.executionState?.processingDuration || 0,
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
        tags: ['ai_processing', 'intent_analysis']
      }
    );
  }

  protected getFallbackOperation<T>(
    originalOperation: () => Promise<T>,
    context: EnhancedErrorContext
  ): (() => Promise<T>) | undefined {
    if (!this.aiConfig.enableSimplifiedFallback) {
      return undefined;
    }

    return async () => {
      // Simplified AI processing fallback
      const simplifiedResult = await this.performSimplifiedAIFallback(context);
      return simplifiedResult as T;
    };
  }

  /**
   * Perform AI processing
   */
  private async performAIProcessing(processingContext: ProcessingContext): Promise<AIResponse> {
    // Simulate AI processing delay
    await new Promise(resolve => setTimeout(resolve, 300));

    // Simulate processing failures based on boundary state
    if (this.shouldSimulateProcessingFailure()) {
      throw new Error('AI processing service unavailable');
    }

    // Validate context length
    if (this.calculateContextLength(processingContext) > this.aiConfig.maxTokensPerRequest) {
      if (this.aiConfig.enableContextReduction) {
        processingContext = this.reduceContext(processingContext);
      } else {
        throw new Error('Context too long for processing');
      }
    }

    // Mock AI response
    const response: AIResponse = {
      content: this.generateAIResponse(processingContext),
      confidence: Math.random() * 0.4 + 0.6, // 0.6-1.0
      toolSelection: this.selectBestTool(processingContext.availableTools),
      reasoning: 'Based on user intent and available tools',
      alternatives: processingContext.availableTools.slice(0, 2),
      metadata: {
        tokensUsed: Math.floor(Math.random() * 1000) + 500,
        processingTime: Date.now(),
        contextReduced: this.calculateContextLength(processingContext) > this.aiConfig.maxTokensPerRequest
      }
    };

    return response;
  }

  /**
   * Perform simplified processing fallback
   */
  private async performSimplifiedProcessing(processingContext: ProcessingContext): Promise<AIResponse> {
    await new Promise(resolve => setTimeout(resolve, 100));

    const simplifiedResponse: AIResponse = {
      content: this.generateSimplifiedResponse(processingContext.userMessage),
      confidence: 0.5,
      toolSelection: this.selectDefaultTool(processingContext.availableTools),
      reasoning: 'Simplified processing due to AI service issues',
      alternatives: [],
      metadata: {
        tokensUsed: 50,
        processingTime: Date.now(),
        simplified: true,
        fallbackStrategy: this.aiConfig.fallbackPromptStrategy
      }
    };

    return simplifiedResponse;
  }

  /**
   * Perform tool selection
   */
  private async performToolSelection(
    userIntent: string,
    availableTools: string[]
  ): Promise<{ tool: string; confidence: number }> {
    await new Promise(resolve => setTimeout(resolve, 150));

    if (this.shouldSimulateProcessingFailure()) {
      throw new Error('Tool selection AI service failed');
    }

    // Simple intent matching
    const selectedTool = this.matchIntentToTool(userIntent, availableTools);
    const confidence = Math.random() * 0.3 + 0.7; // 0.7-1.0

    return { tool: selectedTool, confidence };
  }

  /**
   * Perform fallback tool selection
   */
  private async performFallbackToolSelection(
    userIntent: string,
    availableTools: string[]
  ): Promise<{ tool: string; confidence: number }> {
    // Rule-based fallback selection
    const tool = this.ruleBasedToolSelection(userIntent, availableTools);
    return { tool, confidence: 0.6 };
  }

  /**
   * Perform simplified AI fallback
   */
  private async performSimplifiedAIFallback(context: EnhancedErrorContext): Promise<AIResponse> {
    const userMessage = context.userIntent?.originalMessage || '';
    
    return {
      content: `I'm experiencing some technical difficulties. Here's a basic response to: "${userMessage}"`,
      confidence: 0.3,
      reasoning: 'Fallback response due to AI processing errors',
      alternatives: [],
      metadata: {
        tokensUsed: 20,
        fallback: true,
        processingTime: Date.now()
      }
    };
  }

  /**
   * Calculate context length (approximate tokens)
   */
  private calculateContextLength(context: ProcessingContext): number {
    const messageLength = context.userMessage.length;
    const historyLength = context.conversationHistory.join(' ').length;
    const toolsLength = context.availableTools.join(' ').length;
    
    // Rough approximation: 4 characters ≈ 1 token
    return Math.ceil((messageLength + historyLength + toolsLength) / 4);
  }

  /**
   * Reduce context to fit within limits
   */
  private reduceContext(context: ProcessingContext): ProcessingContext {
    const reduced = { ...context };
    
    // Truncate conversation history
    if (reduced.conversationHistory.length > 5) {
      reduced.conversationHistory = reduced.conversationHistory.slice(-5);
    }
    
    // Limit tool list
    if (reduced.availableTools.length > 10) {
      reduced.availableTools = reduced.availableTools.slice(0, 10);
    }
    
    return reduced;
  }

  /**
   * Generate AI response
   */
  private generateAIResponse(context: ProcessingContext): string {
    const responses = [
      `I'll help you with "${context.userMessage}". Let me use the appropriate tool.`,
      `Based on your request, I'll process this using our available tools.`,
      `I understand you want to ${context.userIntent || 'perform an action'}. Let me handle that.`
    ];
    
    return responses[Math.floor(Math.random() * responses.length)];
  }

  /**
   * Generate simplified response
   */
  private generateSimplifiedResponse(userMessage: string): string {
    return `I'm processing your request: "${userMessage}". Please wait while I try alternative methods.`;
  }

  /**
   * Select best tool from available options
   */
  private selectBestTool(availableTools: string[]): string {
    if (availableTools.length === 0) return 'default';
    return availableTools[Math.floor(Math.random() * availableTools.length)];
  }

  /**
   * Select default tool
   */
  private selectDefaultTool(availableTools: string[]): string {
    const defaultTools = ['jenkins', 'notification', 'basic'];
    
    for (const defaultTool of defaultTools) {
      if (availableTools.includes(defaultTool)) {
        return defaultTool;
      }
    }
    
    return availableTools[0] || 'fallback';
  }

  /**
   * Match intent to tool
   */
  private matchIntentToTool(intent: string, availableTools: string[]): string {
    const intentMapping: Record<string, string> = {
      'build': 'jenkins',
      'deploy': 'jenkins',
      'test': 'jenkins',
      'notify': 'notification',
      'message': 'notification',
      'issue': 'github',
      'repository': 'github'
    };

    const lowerIntent = intent.toLowerCase();
    
    for (const [keyword, tool] of Object.entries(intentMapping)) {
      if (lowerIntent.includes(keyword) && availableTools.includes(tool)) {
        return tool;
      }
    }

    return this.selectDefaultTool(availableTools);
  }

  /**
   * Rule-based tool selection fallback
   */
  private ruleBasedToolSelection(intent: string, availableTools: string[]): string {
    // Simple keyword matching
    if (intent.includes('build') || intent.includes('deploy')) {
      return availableTools.find(tool => tool.includes('jenkins')) || availableTools[0];
    }
    
    if (intent.includes('notify') || intent.includes('message')) {
      return availableTools.find(tool => tool.includes('notification')) || availableTools[0];
    }
    
    return availableTools[0] || 'default';
  }

  /**
   * Generate fallback options for context preservation
   */
  private generateFallbackOptions(context: EnhancedErrorContext): string[] {
    const options = ['simplified_processing', 'rule_based_selection'];
    
    if (context.userIntent?.originalMessage) {
      options.push('template_response');
    }
    
    return options;
  }

  /**
   * Should simulate processing failure for testing
   */
  private shouldSimulateProcessingFailure(): boolean {
    // Simulate failures based on boundary state
    if (this.state === BoundaryState.DEGRADED) {
      return Math.random() < 0.4; // 40% failure rate when degraded
    }
    if (this.state === BoundaryState.FAILED) {
      return Math.random() < 0.8; // 80% failure rate when failed
    }
    return Math.random() < 0.15; // 15% baseline failure rate
  }

  /**
   * Record processing attempt
   */
  private recordProcessingAttempt(
    processingTime: number,
    success: boolean,
    tokensUsed: number,
    confidence: number
  ): void {
    this.processingHistory.push({
      timestamp: new Date(),
      processingTime,
      success,
      tokensUsed,
      confidence
    });

    // Keep only last 50 records
    if (this.processingHistory.length > 50) {
      this.processingHistory.shift();
    }
  }

  /**
   * Get AI processing statistics
   */
  getProcessingStats(): {
    averageProcessingTime: number;
    successRate: number;
    averageConfidence: number;
    totalTokensUsed: number;
    recentFailures: number;
  } {
    if (this.processingHistory.length === 0) {
      return {
        averageProcessingTime: 0,
        successRate: 0,
        averageConfidence: 0,
        totalTokensUsed: 0,
        recentFailures: 0
      };
    }

    const recentHistory = this.processingHistory.slice(-10); // Last 10 attempts
    const successfulAttempts = this.processingHistory.filter(h => h.success);

    return {
      averageProcessingTime: this.processingHistory.reduce((sum, h) => sum + h.processingTime, 0) / this.processingHistory.length,
      successRate: successfulAttempts.length / this.processingHistory.length,
      averageConfidence: successfulAttempts.reduce((sum, h) => sum + h.confidence, 0) / (successfulAttempts.length || 1),
      totalTokensUsed: this.processingHistory.reduce((sum, h) => sum + h.tokensUsed, 0),
      recentFailures: recentHistory.filter(h => !h.success).length
    };
  }

  /**
   * Clear processing history
   */
  clearProcessingHistory(): void {
    this.processingHistory = [];
  }

  /**
   * Update AI configuration
   */
  updateAIConfig(updates: Partial<AIProcessingConfig>): void {
    this.aiConfig = { ...this.aiConfig, ...updates };
  }
}