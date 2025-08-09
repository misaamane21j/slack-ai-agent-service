import { App, SlackEventMiddlewareArgs, AllMiddlewareArgs } from '@slack/bolt';
import { logger } from '../utils/logger';
import { ParameterSanitizer } from '../utils/parameter-sanitizer';
import { AIProcessorService } from './ai-processor';
import { MCPClientService } from './mcp-client';
import { NotificationService } from './notification';

export class SlackBotService {
  private parameterSanitizer: ParameterSanitizer;

  constructor(
    private app: App,
    private aiProcessor: AIProcessorService,
    private mcpClient: MCPClientService,
    private notificationService: NotificationService
  ) {
    this.parameterSanitizer = new ParameterSanitizer();
  }

  async initialize(): Promise<void> {
    this.app.event('app_mention', this.handleAppMention.bind(this));
    this.app.error(this.handleError.bind(this));
    logger().info('Slack bot service initialized');
  }

  private async handleAppMention(
    event: SlackEventMiddlewareArgs<'app_mention'> & AllMiddlewareArgs
  ): Promise<void> {
    const { event: slackEvent, client, say } = event;
    
    try {
      await client.reactions.add({
        channel: slackEvent.channel,
        timestamp: slackEvent.ts,
        name: 'thinking_face',
      });

      const threadContext = await this.getThreadContext(slackEvent);
      const aiResponse = await this.aiProcessor.processMessage(
        slackEvent.text,
        threadContext
      );

      if (aiResponse.confidence < this.aiProcessor.getConfidenceThreshold()) {
        await say({
          thread_ts: slackEvent.ts,
          text: 'I\'m not confident about what you\'re asking. Could you please be more specific?',
        });
        return;
      }

      // Sanitize and validate parameters before sending to Jenkins
      const sanitizationResult = this.parameterSanitizer.sanitizeParameters(aiResponse.parameters);
      
      // Log security events
      if (sanitizationResult.warnings.length > 0) {
        logger().warn('Parameter sanitization warnings', {
          jobName: aiResponse.jobName,
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
          jobName: aiResponse.jobName,
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

      const jobResult = await this.mcpClient.triggerJenkinsJob({
        jobName: aiResponse.jobName,
        parameters: sanitizationResult.sanitized,
        callbackInfo: {
          slackChannel: slackEvent.channel,
          slackThreadTs: slackEvent.ts,
          slackUserId: slackEvent.user || 'unknown',
        },
      });

      await say({
        thread_ts: slackEvent.ts,
        text: `Jenkins job "${aiResponse.jobName}" triggered successfully! Build #${jobResult.buildNumber}`,
      });

    } catch (error) {
      logger().error('Error handling app mention:', error);
      await say({
        thread_ts: slackEvent.ts,
        text: 'Sorry, I encountered an error while processing your request.',
      });
    }
  }

  private async getThreadContext(event: any): Promise<string[]> {
    // Implementation to fetch thread messages for context
    return [];
  }

  private async handleError(error: Error): Promise<void> {
    logger().error('Slack app error:', error);
  }
}