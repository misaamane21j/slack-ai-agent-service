import { App, SlackEventMiddlewareArgs, AllMiddlewareArgs } from '@slack/bolt';
import { logger } from '../utils/logger';
import { ParameterSanitizer } from '../utils/parameter-sanitizer';
import { AIProcessorService } from './ai-processor';
import { MCPClientService } from './mcp-client';
import { NotificationService } from './notification';
import { AIAgentResponse, ToolInvocationResult } from '../types/ai-agent';
import { MCPRegistryService } from './mcp-registry';
import { SlackMessage, ThreadContextFilterOptions, FilteredMessage } from '../types/slack';
import { createClient, RedisClientType } from 'redis';

export class SlackBotService {
  private parameterSanitizer: ParameterSanitizer;
  private rateLimitTracker: {
    requestCount: number;
    windowStart: number;
    retryAfter?: number;
  } = {
    requestCount: 0,
    windowStart: Date.now()
  };
  private redisClient: RedisClientType | null = null;
  private cacheMetrics = {
    hits: 0,
    misses: 0,
    invalidations: 0
  };

  constructor(
    private app: App,
    private aiProcessor: AIProcessorService,
    private mcpClient: MCPClientService,
    private notificationService: NotificationService,
    private mcpRegistry?: MCPRegistryService
  ) {
    this.parameterSanitizer = new ParameterSanitizer();
  }

  async initialize(): Promise<void> {
    logger().info('🔧 Initializing enhanced Slack bot event handlers...');
    
    // Initialize Redis cache
    await this.initializeCache();
    
    // Core event handlers
    this.app.event('app_mention', this.handleAppMention.bind(this));
    this.app.error(this.handleError.bind(this));
    
    // Initialize interactive handlers for buttons and modals
    this.initializeInteractiveHandlers();
    
    // Set up cache invalidation on new messages
    this.setupCacheInvalidation();
    
    logger().info('✅ Enhanced Slack bot service initialized with interactive features');
    logger().info('🔍 Features: app mentions, interactive buttons, rich formatting, tool help, Redis caching');
    logger().info('🎯 To debug: mention your bot with @botname in any channel');
  }

  /**
   * Initialize Redis cache connection
   */
  private async initializeCache(): Promise<void> {
    try {
      const { getConfig } = await import('../config/environment');
      const config = getConfig();
      
      this.redisClient = createClient({
        url: config.redis.url
      });

      this.redisClient.on('error', (err) => {
        logger().error('Redis client error:', err);
      });

      this.redisClient.on('connect', () => {
        logger().info('✅ Redis client connected successfully');
      });

      this.redisClient.on('disconnect', () => {
        logger().warn('⚠️ Redis client disconnected');
      });

      await this.redisClient.connect();
      
      logger().info('🚀 Redis caching initialized', {
        url: config.redis.url.replace(/:\/\/[^@]*@/, '://***@'), // Hide credentials in logs
        cacheEnabled: true
      });

    } catch (error) {
      logger().error('❌ Failed to initialize Redis cache:', error);
      logger().warn('⚠️ Continuing without cache - performance may be impacted');
      this.redisClient = null;
    }
  }

  /**
   * Generate cache key for thread context
   */
  private generateCacheKey(channelId: string, threadTs: string): string {
    return `thread_context:${channelId}:${threadTs}`;
  }

  /**
   * Get thread context from cache
   */
  private async getCachedThreadContext(channelId: string, threadTs: string): Promise<string[] | null> {
    if (!this.redisClient) {
      return null;
    }

    try {
      const cacheKey = this.generateCacheKey(channelId, threadTs);
      const cached = await this.redisClient.get(cacheKey);
      
      if (cached) {
        this.cacheMetrics.hits++;
        const contextMessages = JSON.parse(cached);
        
        logger().info('🎯 Cache hit for thread context', {
          cacheKey,
          messageCount: contextMessages.length,
          hitRate: (this.cacheMetrics.hits / (this.cacheMetrics.hits + this.cacheMetrics.misses) * 100).toFixed(2) + '%'
        });
        
        return contextMessages;
      } else {
        this.cacheMetrics.misses++;
        
        logger().info('❌ Cache miss for thread context', {
          cacheKey,
          hitRate: (this.cacheMetrics.hits / (this.cacheMetrics.hits + this.cacheMetrics.misses) * 100).toFixed(2) + '%'
        });
        
        return null;
      }
    } catch (error) {
      logger().error('❌ Error getting cached thread context:', error);
      return null;
    }
  }

  /**
   * Cache thread context with TTL
   */
  private async cacheThreadContext(
    channelId: string, 
    threadTs: string, 
    contextMessages: string[], 
    ttlMinutes: number = 15
  ): Promise<void> {
    if (!this.redisClient || contextMessages.length === 0) {
      return;
    }

    try {
      const cacheKey = this.generateCacheKey(channelId, threadTs);
      const ttlSeconds = ttlMinutes * 60;
      
      await this.redisClient.setEx(cacheKey, ttlSeconds, JSON.stringify(contextMessages));
      
      logger().info('💾 Thread context cached successfully', {
        cacheKey,
        messageCount: contextMessages.length,
        ttlMinutes,
        expiresAt: new Date(Date.now() + (ttlSeconds * 1000)).toISOString()
      });
      
    } catch (error) {
      logger().error('❌ Error caching thread context:', error);
    }
  }

  /**
   * Invalidate cached thread context (e.g., when new messages are added)
   */
  private async invalidateThreadContext(channelId: string, threadTs: string): Promise<void> {
    if (!this.redisClient) {
      return;
    }

    try {
      const cacheKey = this.generateCacheKey(channelId, threadTs);
      const deleted = await this.redisClient.del(cacheKey);
      
      if (deleted > 0) {
        this.cacheMetrics.invalidations++;
        
        logger().info('🗑️ Thread context cache invalidated', {
          cacheKey,
          invalidationCount: this.cacheMetrics.invalidations
        });
      }
      
    } catch (error) {
      logger().error('❌ Error invalidating thread context cache:', error);
    }
  }

  /**
   * Get cache statistics
   */
  private getCacheStats(): Record<string, any> {
    const total = this.cacheMetrics.hits + this.cacheMetrics.misses;
    const hitRate = total > 0 ? (this.cacheMetrics.hits / total * 100).toFixed(2) : '0.00';
    
    return {
      enabled: !!this.redisClient,
      hits: this.cacheMetrics.hits,
      misses: this.cacheMetrics.misses,
      invalidations: this.cacheMetrics.invalidations,
      hitRate: hitRate + '%',
      total: total
    };
  }

  /**
   * Set up cache invalidation on new messages
   */
  private setupCacheInvalidation(): void {
    // Listen for new messages to invalidate relevant caches
    this.app.event('message', async ({ event }) => {
      // Only invalidate for thread replies (not channel messages)
      if (event.thread_ts) {
        await this.invalidateThreadContext(event.channel, event.thread_ts);
        
        logger().info('🔄 Cache invalidated due to new thread message', {
          channel: event.channel,
          threadTs: event.thread_ts,
          messageTs: event.ts
        });
      }
    });

    logger().info('🔄 Cache invalidation listeners set up for new thread messages');
  }

  private async handleAppMention(
    event: SlackEventMiddlewareArgs<'app_mention'> & AllMiddlewareArgs
  ): Promise<void> {
    const { event: slackEvent, client, say } = event;
    
    logger().info('🎯 App mention received!', {
      user: slackEvent.user,
      channel: slackEvent.channel,
      text: slackEvent.text,
      timestamp: slackEvent.ts,
      thread_ts: slackEvent.thread_ts
    });
    
    try {
      logger().info('➕ Adding thinking reaction...');
      await client.reactions.add({
        channel: slackEvent.channel,
        timestamp: slackEvent.ts,
        name: 'thinking_face',
      });

      logger().info('📖 Getting thread context...');
      const threadContext = await this.getThreadContext(slackEvent, client);
      
      logger().info('🤖 Processing message with AI...', {
        messageText: slackEvent.text.substring(0, 100),
        contextLength: threadContext.length
      });
      
      const aiResponse = await this.aiProcessor.processMessage(
        slackEvent.text,
        threadContext
      );
      
      logger().info('✅ AI processing complete', {
        intent: aiResponse.intent,
        confidence: aiResponse.confidence,
        threshold: this.aiProcessor.getConfidenceThreshold()
      });

      // Handle response based on intent
      await this.handleAIResponse(aiResponse, slackEvent, say);

    } catch (error) {
      logger().error('Error handling app mention:', error);
      await say({
        thread_ts: slackEvent.ts,
        text: 'Sorry, I encountered an error while processing your request.',
      });
    }
  }

  /**
   * Handle AI response based on intent type
   */
  private async handleAIResponse(
    aiResponse: AIAgentResponse,
    slackEvent: any,
    say: any
  ): Promise<void> {
    // Check confidence threshold for all responses
    if (aiResponse.confidence < this.aiProcessor.getConfidenceThreshold()) {
      logger().info('⚠️ Low confidence response, sending help message');
      await say({
        thread_ts: slackEvent.ts,
        text: 'I\'m not confident about what you\'re asking. Could you please be more specific?',
      });
      return;
    }

    switch (aiResponse.intent) {
      case 'tool_invocation':
        await this.handleToolInvocation(aiResponse, slackEvent, say);
        break;
      case 'clarification_needed':
        await this.handleClarificationNeeded(aiResponse, slackEvent, say);
        break;
      case 'general_conversation':
        await this.handleGeneralConversation(aiResponse, slackEvent, say);
        break;
      default:
        logger().warn('Unknown AI response intent:', aiResponse.intent);
        await say({
          thread_ts: slackEvent.ts,
          text: 'I\'m not sure how to handle your request. Please try rephrasing.',
        });
    }
  }

  /**
   * Handle tool invocation responses
   */
  private async handleToolInvocation(
    aiResponse: AIAgentResponse,
    slackEvent: any,
    say: any
  ): Promise<void> {
    if (!aiResponse.tool) {
      logger().error('Tool invocation response missing tool information');
      await say({
        thread_ts: slackEvent.ts,
        text: 'Error: Tool information is missing from the AI response.',
      });
      return;
    }

    const { serverId, toolName, parameters } = aiResponse.tool;
    
    logger().info('🔧 Executing tool invocation', {
      serverId,
      toolName,
      parameters,
      reasoning: aiResponse.reasoning
    });

    try {
      // Handle different server types
      if (serverId === 'jenkins') {
        await this.handleJenkinsToolInvocation(toolName, parameters, slackEvent, say);
      } else {
        await this.handleGenericToolInvocation(serverId, toolName, parameters, slackEvent, say);
      }
    } catch (error) {
      logger().error('Tool invocation failed:', error);
      await say({
        thread_ts: slackEvent.ts,
        text: `Failed to execute ${toolName} on ${serverId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  }

  /**
   * Handle Jenkins-specific tool invocation (backward compatibility)
   */
  private async handleJenkinsToolInvocation(
    toolName: string,
    parameters: any,
    slackEvent: any,
    say: any
  ): Promise<void> {
    // Sanitize and validate parameters
    const sanitizationResult = this.parameterSanitizer.sanitizeParameters(parameters);
    
    // Log security events
    if (sanitizationResult.warnings.length > 0) {
      logger().warn('Parameter sanitization warnings', {
        toolName,
        warnings: sanitizationResult.warnings,
        rejected: sanitizationResult.rejected,
        userId: slackEvent.user,
        channel: slackEvent.channel
      });
    }

    // Validate sanitized parameters for Jenkins
    const validation = this.parameterSanitizer.validateForJenkins(sanitizationResult.sanitized);
    if (!validation.valid) {
      logger().error('Parameter validation failed', {
        toolName,
        errors: validation.errors,
        userId: slackEvent.user,
        channel: slackEvent.channel
      });
      
      await say({
        thread_ts: slackEvent.ts,
        text: `Security validation failed: ${validation.errors.join(', ')}. Please check your parameters.`,
      });
      return;
    }

    // Notify user about parameter changes if any were rejected
    if (Object.keys(sanitizationResult.rejected).length > 0) {
      const rejectedParams = Object.keys(sanitizationResult.rejected).join(', ');
      await say({
        thread_ts: slackEvent.ts,
        text: `⚠️ Some parameters were filtered for security: ${rejectedParams}. Proceeding with validated parameters.`,
      });
    }

    // Execute Jenkins job (assuming toolName maps to jobName)
    const jobResult = await this.mcpClient.triggerJenkinsJob({
      jobName: toolName,
      parameters: sanitizationResult.sanitized,
      callbackInfo: {
        slackChannel: slackEvent.channel,
        slackThreadTs: slackEvent.ts,
        slackUserId: slackEvent.user || 'unknown',
      },
    });

    await say({
      thread_ts: slackEvent.ts,
      text: `Jenkins job "${toolName}" triggered successfully! Build #${jobResult.buildNumber}`,
    });
  }

  /**
   * Handle generic MCP tool invocation with enhanced formatting and error handling
   */
  private async handleGenericToolInvocation(
    serverId: string,
    toolName: string,
    parameters: any,
    slackEvent: any,
    say: any
  ): Promise<void> {
    if (!this.mcpRegistry) {
      await this.sendRichResponse(
        say,
        slackEvent.ts,
        'MCP Registry is not available. Please contact your administrator.',
        { type: 'error' }
      );
      return;
    }

    try {
      // Show progress indicator
      await say({
        thread_ts: slackEvent.ts,
        text: `🔄 Executing ${toolName} on ${serverId}...`
      });

      // Execute tool through MCP registry
      const result = await this.mcpRegistry.invokeToolSafely(serverId, toolName, parameters);

      // Format and send rich response
      const formattedResponse = this.formatToolResult(result, toolName, serverId);
      await this.sendRichResponse(
        say,
        slackEvent.ts,
        formattedResponse,
        {
          type: result.success ? 'success' : 'error',
          interactive: !result.success,
          metadata: {
            serverId,
            toolName,
            parameters
          }
        }
      );

      // Log execution for monitoring
      logger().info('Tool execution completed', {
        serverId,
        toolName,
        success: result.success,
        executionTime: result.executionTime,
        userId: slackEvent.user,
        channel: slackEvent.channel
      });

    } catch (error) {
      logger().error('Generic tool invocation failed:', {
        serverId,
        toolName,
        parameters,
        error: error instanceof Error ? error.message : 'Unknown error',
        userId: slackEvent.user,
        channel: slackEvent.channel
      });

      await this.sendRichResponse(
        say,
        slackEvent.ts,
        `Failed to execute ${toolName} on ${serverId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        {
          type: 'error',
          interactive: true,
          metadata: {
            serverId,
            toolName,
            parameters
          }
        }
      );
    }
  }

  /**
   * Handle clarification needed responses with helpful suggestions
   */
  private async handleClarificationNeeded(
    aiResponse: AIAgentResponse,
    slackEvent: any,
    say: any
  ): Promise<void> {
    const clarificationBlocks: any[] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `🤔 ${aiResponse.message || 'I need more information to help you. Could you please provide more details?'}`
        }
      }
    ];

    // Add helpful suggestions if available
    if (this.mcpRegistry) {
      try {
        const availableTools = await this.mcpRegistry.discoverAllTools();
        if (availableTools.length > 0) {
          const suggestions = availableTools
            .slice(0, 3)
            .map(tool => `• *${tool.serverId}:${tool.name}* - ${tool.description}`)
            .join('\n');

          clarificationBlocks.push({
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `💡 *Available tools:*\n${suggestions}`
            }
          });
        }
      } catch (error) {
        logger().warn('Failed to fetch available tools for clarification:', error);
      }
    }

    await say({
      thread_ts: slackEvent.ts,
      text: aiResponse.message || 'I need more information to help you.',
      blocks: clarificationBlocks
    });
  }

  /**
   * Handle general conversation responses with contextual information
   */
  private async handleGeneralConversation(
    aiResponse: AIAgentResponse,
    slackEvent: any,
    say: any
  ): Promise<void> {
    const conversationBlocks: any[] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `💬 ${aiResponse.message || 'I understand you\'re having a conversation, but I\'m primarily designed to help with tool operations.'}`
        }
      }
    ];

    // Add capabilities overview for general conversation
    if (aiResponse.message && aiResponse.message.toLowerCase().includes('help')) {
      conversationBlocks.push({
        type: 'divider'
      });
      
      conversationBlocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `🚀 *I can help you with:*\n• Triggering Jenkins builds\n• Managing GitHub issues\n• Database queries\n• And more tools as they become available!`
        }
      });

      conversationBlocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: '💡 Try saying something like "trigger build for main branch" or "create GitHub issue"'
          }
        ]
      });
    }

    await say({
      thread_ts: slackEvent.ts,
      text: aiResponse.message || 'I\'m here to help with tool operations.',
      blocks: conversationBlocks
    });
  }

  /**
   * Rate-limited API call wrapper with exponential backoff retry
   */
  private async makeRateLimitedApiCall<T>(
    apiCall: () => Promise<T>,
    operation: string,
    maxRetries: number = 3
  ): Promise<T> {
    const REQUESTS_PER_MINUTE = 50; // Slack API limit for conversations.replies
    const WINDOW_SIZE = 60 * 1000; // 1 minute in milliseconds

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        // Check rate limit window
        const now = Date.now();
        if (now - this.rateLimitTracker.windowStart >= WINDOW_SIZE) {
          // Reset the window
          this.rateLimitTracker.windowStart = now;
          this.rateLimitTracker.requestCount = 0;
        }

        // Check if we're within rate limits
        if (this.rateLimitTracker.requestCount >= REQUESTS_PER_MINUTE) {
          const waitTime = WINDOW_SIZE - (now - this.rateLimitTracker.windowStart);
          logger().warn(`⚠️ Rate limit reached, waiting ${waitTime}ms before retry`, {
            operation,
            attempt,
            requestCount: this.rateLimitTracker.requestCount
          });
          await this.sleep(waitTime);
          continue; // Retry after waiting
        }

        // Check if we need to wait due to previous 429 response
        if (this.rateLimitTracker.retryAfter && now < this.rateLimitTracker.retryAfter) {
          const waitTime = this.rateLimitTracker.retryAfter - now;
          logger().warn(`⚠️ Waiting due to previous 429 response: ${waitTime}ms`, {
            operation,
            attempt
          });
          await this.sleep(waitTime);
        }

        // Make the API call
        this.rateLimitTracker.requestCount++;
        const result = await apiCall();

        // Monitor rate limit headers if available
        const rateLimitHeaders = this.extractRateLimitHeaders(result);
        
        logger().info('✅ API call successful', {
          operation,
          attempt,
          requestCount: this.rateLimitTracker.requestCount,
          windowStart: new Date(this.rateLimitTracker.windowStart).toISOString(),
          ...rateLimitHeaders
        });

        return result;

      } catch (error: any) {
        // Handle rate limit errors (429)
        if (error?.data?.error === 'rate_limited' || error?.status === 429) {
          const retryAfter = error?.data?.retry_after || error?.headers?.['retry-after'];
          const backoffTime = retryAfter 
            ? parseInt(retryAfter) * 1000 
            : Math.min(1000 * Math.pow(2, attempt - 1), 30000); // Exponential backoff, max 30s

          this.rateLimitTracker.retryAfter = Date.now() + backoffTime;

          logger().warn(`🚦 Rate limit hit (429), backing off for ${backoffTime}ms`, {
            operation,
            attempt,
            maxRetries,
            retryAfter: retryAfter || 'calculated',
            nextRetryAt: new Date(this.rateLimitTracker.retryAfter).toISOString()
          });

          if (attempt <= maxRetries) {
            await this.sleep(backoffTime);
            continue; // Retry after backoff
          }
        }

        // For non-rate-limit errors or max retries reached
        logger().error(`❌ API call failed after ${attempt} attempts`, {
          operation,
          error: error.message || 'Unknown error',
          isRateLimit: error?.data?.error === 'rate_limited' || error?.status === 429
        });

        throw error;
      }
    }

    throw new Error(`Max retries (${maxRetries}) exceeded for ${operation}`);
  }

  /**
   * Helper method to sleep for a specified duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Extract rate limit information from API response headers
   */
  private extractRateLimitHeaders(response: any): Record<string, any> {
    const headers = response?.response_metadata?.headers || response?.headers || {};
    
    return {
      rateLimitRemaining: headers['x-ratelimit-remaining'] || headers['X-RateLimit-Remaining'],
      rateLimitLimit: headers['x-ratelimit-limit'] || headers['X-RateLimit-Limit'],
      rateLimitReset: headers['x-ratelimit-reset'] || headers['X-RateLimit-Reset'],
      retryAfter: headers['retry-after'] || headers['Retry-After']
    };
  }

  /**
   * Filter and score messages for relevance based on configured options
   */
  private filterThreadMessages(
    messages: any[], 
    options: ThreadContextFilterOptions = {}
  ): FilteredMessage[] {
    const {
      maxMessages = 50,
      timeWindowHours = 24,
      excludeSystemMessages = true,
      excludeBotMessages = false,
      includeReactions = true,
      relevanceScoring = true,
      prioritizeRecentMessages = true,
      prioritizeUserMentions = true
    } = options;

    // Calculate time window cutoff
    const timeWindowCutoff = timeWindowHours 
      ? new Date(Date.now() - (timeWindowHours * 60 * 60 * 1000))
      : null;

    logger().info('🔍 Filtering thread messages', {
      totalMessages: messages.length,
      maxMessages,
      timeWindowHours,
      timeWindowCutoff: timeWindowCutoff?.toISOString(),
      excludeSystemMessages,
      excludeBotMessages
    });

    // First pass: Basic filtering and message analysis
    const filteredMessages: FilteredMessage[] = messages
      .map((msg, index) => this.analyzeMessage(msg, index, messages.length))
      .filter((analyzed) => {
        // Time window filtering
        if (timeWindowCutoff && analyzed.timestamp < timeWindowCutoff) {
          return false;
        }

        // Message type filtering
        if (excludeSystemMessages && analyzed.messageType === 'system') {
          return false;
        }

        if (excludeBotMessages && analyzed.messageType === 'bot') {
          return false;
        }

        // Must have text content
        if (!analyzed.originalMessage.text) {
          return false;
        }

        return true;
      });

    logger().info('📊 After basic filtering', {
      originalCount: messages.length,
      filteredCount: filteredMessages.length
    });

    // Second pass: Relevance scoring (if enabled)
    if (relevanceScoring) {
      filteredMessages.forEach(msg => {
        msg.relevanceScore = this.calculateRelevanceScore(msg, {
          prioritizeRecentMessages,
          prioritizeUserMentions,
          includeReactions
        });
      });

      // Sort by relevance score (highest first)
      filteredMessages.sort((a, b) => b.relevanceScore - a.relevanceScore);
    }

    // Final pass: Limit to maxMessages
    const finalMessages = filteredMessages.slice(0, maxMessages);

    logger().info('✅ Message filtering completed', {
      finalCount: finalMessages.length,
      averageRelevanceScore: relevanceScoring 
        ? (finalMessages.reduce((sum, msg) => sum + msg.relevanceScore, 0) / finalMessages.length).toFixed(2)
        : 'N/A'
    });

    return finalMessages;
  }

  /**
   * Analyze a single message to extract metadata and determine type
   */
  private analyzeMessage(msg: any, index: number, totalMessages: number): FilteredMessage {
    const timestamp = new Date(parseFloat(msg.ts) * 1000);
    
    // Determine message type
    let messageType: 'user' | 'bot' | 'system' = 'user';
    
    if (msg.bot_id || msg.username || msg.subtype === 'bot_message') {
      messageType = 'bot';
    } else if (msg.subtype && ['channel_join', 'channel_leave', 'channel_topic', 'channel_purpose'].includes(msg.subtype)) {
      messageType = 'system';
    }

    // Check for user mentions
    const hasUserMentions = !!(msg.text && msg.text.includes('<@'));

    // Check for reactions
    const hasReactions = !!(msg.reactions && msg.reactions.length > 0);

    // Check if this is a thread reply
    const isThreadReply = !!msg.thread_ts;

    return {
      originalMessage: msg,
      relevanceScore: 0, // Will be calculated later if relevance scoring is enabled
      messageType,
      timestamp,
      hasUserMentions,
      hasReactions,
      isThreadReply
    };
  }

  /**
   * Calculate relevance score for a message based on various factors
   */
  private calculateRelevanceScore(
    message: FilteredMessage, 
    scoringOptions: {
      prioritizeRecentMessages: boolean;
      prioritizeUserMentions: boolean;
      includeReactions: boolean;
    }
  ): number {
    let score = 1.0; // Base score

    // Recency scoring (newer messages get higher scores)
    if (scoringOptions.prioritizeRecentMessages) {
      const ageInHours = (Date.now() - message.timestamp.getTime()) / (1000 * 60 * 60);
      const recencyMultiplier = Math.max(0.1, 1 - (ageInHours / 48)); // Decay over 48 hours
      score *= (1 + recencyMultiplier);
    }

    // User mention scoring
    if (scoringOptions.prioritizeUserMentions && message.hasUserMentions) {
      score *= 1.8; // Significant boost for mentions
    }

    // Reaction scoring
    if (scoringOptions.includeReactions && message.hasReactions) {
      const reactionCount = message.originalMessage.reactions?.length || 0;
      score *= (1 + Math.min(reactionCount * 0.1, 0.5)); // Up to 50% boost based on reactions
    }

    // Message length scoring (longer messages might be more informative)
    const textLength = message.originalMessage.text?.length || 0;
    if (textLength > 50) {
      score *= 1.2; // Small boost for substantial messages
    }

    // Thread reply scoring (often more contextual)
    if (message.isThreadReply) {
      score *= 1.1; // Small boost for thread replies
    }

    // User message preference over bot messages
    if (message.messageType === 'user') {
      score *= 1.3; // Prefer user messages over bot messages
    }

    return Math.round(score * 100) / 100; // Round to 2 decimal places
  }

  /**
   * Convert filtered messages back to context strings with enhanced formatting
   */
  private formatFilteredMessages(filteredMessages: FilteredMessage[]): string[] {
    return filteredMessages.map(({ originalMessage, relevanceScore, messageType, hasUserMentions, hasReactions }) => {
      const userDisplay = originalMessage.user ? `<@${originalMessage.user}>` : 'Unknown User';
      const timestamp = new Date(parseFloat(originalMessage.ts) * 1000).toISOString();
      
      // Add context indicators
      let indicators = '';
      if (messageType === 'bot') indicators += '🤖 ';
      if (hasUserMentions) indicators += '👤 ';
      if (hasReactions) indicators += '👍 ';
      
      // Add relevance score for debugging (can be removed in production)
      const scoreIndicator = relevanceScore > 0 ? ` [📊${relevanceScore}]` : '';
      
      return `[${timestamp}] ${indicators}${userDisplay}: ${originalMessage.text}${scoreIndicator}`;
    });
  }

  /**
   * Enhanced thread context fetching with Slack Web API integration and pagination support
   */
  private async getThreadContext(event: any, client: any): Promise<string[]> {
    try {
      const channelId = event.channel;
      const threadTs = event.thread_ts || event.ts;
      
      logger().info('🔍 Fetching thread context from Slack API', {
        channel: channelId,
        threadTs: threadTs,
        isThread: !!event.thread_ts
      });

      // Try to get from cache first
      const cachedContext = await this.getCachedThreadContext(channelId, threadTs);
      if (cachedContext) {
        logger().info('🚀 Using cached thread context', {
          messageCount: cachedContext.length,
          cacheStats: this.getCacheStats()
        });
        return cachedContext;
      }
      
      // Configuration for pagination
      const MAX_MESSAGES = 200; // Prevent excessive API calls
      const BATCH_SIZE = 100; // Messages per API call
      
      let allMessages: any[] = [];
      let cursor: string | undefined;
      let totalFetched = 0;
      let apiCallCount = 0;

      // Paginated fetch loop
      do {
        apiCallCount++;
        logger().info(`📖 Fetching batch ${apiCallCount}`, {
          cursor: cursor ? `${cursor.substring(0, 8)}...` : 'initial',
          totalFetched,
          maxMessages: MAX_MESSAGES
        });

        // Call conversations.replies API with rate limiting and pagination
        const response = await this.makeRateLimitedApiCall(
          () => client.conversations.replies({
            channel: event.channel,
            ts: threadTs,
            inclusive: true, // Include the original message
            limit: BATCH_SIZE,
            cursor: cursor // Use cursor for pagination
          }),
          `conversations.replies-batch-${apiCallCount}`
        );

        if (!response.ok) {
          logger().error('Slack API error:', response.error);
          break; // Exit pagination loop on error
        }

        if (!response.messages || response.messages.length === 0) {
          logger().info('No more messages found, ending pagination');
          break; // No more messages
        }

        // Add messages to collection
        allMessages.push(...response.messages);
        totalFetched += response.messages.length;

        // Update cursor for next iteration
        cursor = response.response_metadata?.next_cursor;

        logger().info(`📊 Batch ${apiCallCount} completed`, {
          batchSize: response.messages.length,
          totalFetched,
          hasMore: !!cursor,
          withinLimit: totalFetched < MAX_MESSAGES
        });

        // Safety checks to prevent infinite loops
        if (totalFetched >= MAX_MESSAGES) {
          logger().warn(`⚠️ Reached message limit (${MAX_MESSAGES}), truncating thread context`);
          break;
        }

        if (apiCallCount >= 10) { // Safety limit on API calls
          logger().warn('⚠️ Reached API call limit (10), truncating thread context');
          break;
        }

      } while (cursor); // Continue while there's a cursor

      if (allMessages.length === 0) {
        logger().warn('No messages found in thread context');
        return [];
      }

      // Apply intelligent filtering and relevance scoring
      const filterOptions: ThreadContextFilterOptions = {
        maxMessages: 30, // Reduced from showing all messages
        timeWindowHours: 48, // Focus on last 48 hours
        excludeSystemMessages: true,
        excludeBotMessages: false, // Keep bot messages but score them lower
        includeReactions: true,
        relevanceScoring: true,
        prioritizeRecentMessages: true,
        prioritizeUserMentions: true
      };

      const filteredMessages = this.filterThreadMessages(allMessages, filterOptions);
      const contextMessages = this.formatFilteredMessages(filteredMessages);

      logger().info('✅ Thread context retrieved successfully with intelligent filtering', {
        totalApiCalls: apiCallCount,
        totalMessages: allMessages.length,
        filteredMessages: filteredMessages.length,
        finalContextMessages: contextMessages.length,
        truncated: totalFetched >= MAX_MESSAGES,
        averageRelevanceScore: filteredMessages.length > 0 
          ? (filteredMessages.reduce((sum, msg) => sum + msg.relevanceScore, 0) / filteredMessages.length).toFixed(2)
          : 'N/A'
      });

      // Cache the result for future requests
      await this.cacheThreadContext(channelId, threadTs, contextMessages, 15); // 15 minute TTL

      return contextMessages;

    } catch (error) {
      logger().error('Failed to fetch thread context from Slack API:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        channel: event.channel,
        threadTs: event.thread_ts || event.ts
      });
      
      // Return empty array on error to prevent breaking the bot
      return [];
    }
  }

  /**
   * Format tool execution results for Slack display
   */
  private formatToolResult(result: ToolInvocationResult, toolName: string, serverId: string): any {
    const baseResponse: any = {
      response_type: 'in_channel',
      blocks: [] as any[]
    };

    if (result.success) {
      // Success response with rich formatting
      baseResponse.blocks = [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `✅ Successfully executed *${toolName}* on *${serverId}*`
          }
        }
      ];

      // Add data section if available
      if (result.data) {
        const dataText = this.formatToolData(result.data);
        if (dataText) {
          baseResponse.blocks.push({
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: dataText
            }
          });
        }
      }

      // Add execution time if available
      if (result.executionTime) {
        baseResponse.blocks.push({
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `⏱️ Execution time: ${result.executionTime}ms`
            }
          ]
        });
      }
    } else {
      // Error response with troubleshooting info
      baseResponse.blocks = [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `❌ Failed to execute *${toolName}* on *${serverId}*`
          }
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Error:* ${result.error || 'Unknown error occurred'}`
          }
        }
      ];

      // Add troubleshooting section
      baseResponse.blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: '💡 Try rephrasing your request or check if the tool is available'
          }
        ]
      });
    }

    return baseResponse;
  }

  /**
   * Format tool data for display based on type
   */
  private formatToolData(data: any): string | null {
    if (!data) return null;

    try {
      // Handle different data types
      if (typeof data === 'string') {
        return data.length > 500 ? `${data.substring(0, 500)}...` : data;
      }

      if (typeof data === 'object') {
        // Handle common response patterns
        if (data.buildNumber) {
          return `🔨 Build #${data.buildNumber}${data.buildUrl ? ` - <${data.buildUrl}|View Build>` : ''}`;
        }

        if (data.issueNumber) {
          return `🐛 Issue #${data.issueNumber}${data.issueUrl ? ` - <${data.issueUrl}|View Issue>` : ''}`;
        }

        if (data.status) {
          return `📊 Status: ${data.status}`;
        }

        // Generic object formatting
        const formatted = JSON.stringify(data, null, 2);
        if (formatted.length > 1000) {
          return `\`\`\`${formatted.substring(0, 1000)}...\`\`\``;
        }
        return `\`\`\`${formatted}\`\`\``;
      }

      return String(data);
    } catch (error) {
      logger().warn('Failed to format tool data:', error);
      return '_(Data formatting failed)_';
    }
  }

  /**
   * Create interactive elements for tool responses
   */
  private createInteractiveElements(serverId: string, toolName: string, parameters: any): any[] {
    const elements = [];

    // Add retry button for failed operations
    elements.push({
      type: 'button',
      text: {
        type: 'plain_text',
        text: '🔄 Retry',
        emoji: true
      },
      action_id: 'retry_tool_execution',
      value: JSON.stringify({ serverId, toolName, parameters })
    });

    // Add help button
    elements.push({
      type: 'button',
      text: {
        type: 'plain_text',
        text: '❓ Help',
        emoji: true
      },
      action_id: 'tool_help',
      value: JSON.stringify({ serverId, toolName })
    });

    return elements;
  }

  /**
   * Send rich formatted response to Slack
   */
  private async sendRichResponse(
    say: any,
    threadTs: string,
    content: string | any,
    options: {
      type?: 'success' | 'error' | 'warning' | 'info';
      interactive?: boolean;
      metadata?: any;
    } = {}
  ): Promise<void> {
    try {
      if (typeof content === 'string') {
        // Simple text response with optional formatting
        const emoji = {
          success: '✅',
          error: '❌', 
          warning: '⚠️',
          info: 'ℹ️'
        }[options.type || 'info'];

        await say({
          thread_ts: threadTs,
          text: `${emoji} ${content}`,
          ...(options.interactive && {
            blocks: [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: `${emoji} ${content}`
                }
              },
              ...(options.metadata && [
                {
                  type: 'actions',
                  elements: this.createInteractiveElements(
                    options.metadata.serverId,
                    options.metadata.toolName,
                    options.metadata.parameters
                  )
                }
              ])
            ]
          })
        });
      } else {
        // Rich block-based response
        await say({
          thread_ts: threadTs,
          text: content.fallback || 'Tool execution result',
          ...content
        });
      }
    } catch (error) {
      logger().error('Failed to send rich response:', error);
      // Fallback to simple text
      await say({
        thread_ts: threadTs,
        text: typeof content === 'string' ? content : 'An error occurred while formatting the response.'
      });
    }
  }

  /**
   * Enhanced error handling with user-friendly messages and recovery suggestions
   */
  private async handleError(error: Error): Promise<void> {
    logger().error('❌ Slack app error:', {
      message: error.message,
      stack: error.stack,
      name: error.name,
      timestamp: new Date().toISOString()
    });

    // TODO: Could implement error recovery strategies here
    // - Automatic retry for transient errors
    // - User notification for persistent issues
    // - Fallback to simpler functionality
  }

  /**
   * Initialize interactive handlers for buttons and modals
   */
  private initializeInteractiveHandlers(): void {
    // Handle retry button clicks
    this.app.action('retry_tool_execution', async ({ ack, body, say, client }) => {
      await ack();
      
      try {
        const metadata = JSON.parse((body as any).actions[0].value);
        const { serverId, toolName, parameters } = metadata;
        
        // Re-execute the tool
        await this.handleGenericToolInvocation(
          serverId,
          toolName,
          parameters,
          { ts: (body as any).message.thread_ts || (body as any).message.ts },
          say
        );
      } catch (error) {
        logger().error('Retry tool execution failed:', error);
        if (say) {
          await say({
            text: '❌ Failed to retry tool execution. Please try again manually.'
          });
        }
      }
    });

    // Handle help button clicks
    this.app.action('tool_help', async ({ ack, body, say }) => {
      await ack();
      
      try {
        const metadata = JSON.parse((body as any).actions[0].value);
        const { serverId, toolName } = metadata;
        
        if (this.mcpRegistry) {
          const tool = await this.mcpRegistry.discoverServerTools(serverId);
          const targetTool = tool.find(t => t.name === toolName);
          
          if (targetTool) {
            if (say) {
              await say({
                text: `📖 *${serverId}:${toolName}*\n${targetTool.description}\n\n*Input Schema:*\n\`\`\`${JSON.stringify(targetTool.inputSchema, null, 2)}\`\`\``
              });
            }
          } else {
            if (say) {
              await say({
                text: `❓ Tool ${toolName} not found on server ${serverId}`
              });
            }
          }
        }
      } catch (error) {
        logger().error('Tool help failed:', error);
        if (say) {
          await say({
            text: '❌ Failed to get tool help. Please check if the tool exists.'
          });
        }
      }
    });
  }
}