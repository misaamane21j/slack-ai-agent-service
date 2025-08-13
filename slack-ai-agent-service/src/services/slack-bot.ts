import { App, SlackEventMiddlewareArgs, AllMiddlewareArgs } from '@slack/bolt';
import { logger } from '../utils/logger';
import { ParameterSanitizer } from '../utils/parameter-sanitizer';
import { AIProcessorService } from './ai-processor';
import { MCPClientService } from './mcp-client';
import { NotificationService } from './notification';
import { AIAgentResponse, ToolInvocationResult } from '../types/ai-agent';
import { MCPRegistryService } from './mcp-registry';

export class SlackBotService {
  private parameterSanitizer: ParameterSanitizer;

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
    
    // Core event handlers
    this.app.event('app_mention', this.handleAppMention.bind(this));
    this.app.error(this.handleError.bind(this));
    
    // Initialize interactive handlers for buttons and modals
    this.initializeInteractiveHandlers();
    
    logger().info('✅ Enhanced Slack bot service initialized with interactive features');
    logger().info('🔍 Features: app mentions, interactive buttons, rich formatting, tool help');
    logger().info('🎯 To debug: mention your bot with @botname in any channel');
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
      const threadContext = await this.getThreadContext(slackEvent);
      
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
   * Enhanced thread context fetching with better error handling
   */
  private async getThreadContext(event: any): Promise<string[]> {
    try {
      // TODO: Implement actual thread message fetching
      // This would connect to Slack API to get conversation history
      return [];
    } catch (error) {
      logger().warn('Failed to fetch thread context:', error);
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