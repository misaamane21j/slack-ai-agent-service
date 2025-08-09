import { App } from '@slack/bolt';
import { logger } from '../utils/logger';

export class NotificationService {
  constructor(private app: App) {}

  async sendJobStatusUpdate(
    channel: string,
    threadTs: string,
    userId: string,
    jobName: string,
    buildNumber: number,
    status: string,
    details?: any
  ): Promise<void> {
    try {
      const message = this.formatStatusMessage(jobName, buildNumber, status, details);
      
      await this.app.client.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text: `<@${userId}> ${message}`,
      });
    } catch (error) {
      logger().error('Failed to send job status update:', error);
    }
  }

  private formatStatusMessage(
    jobName: string,
    buildNumber: number,
    status: string,
    details?: any
  ): string {
    const emoji = status === 'SUCCESS' ? '✅' : status === 'FAILURE' ? '❌' : '⏳';
    let message = `${emoji} Jenkins job "${jobName}" build #${buildNumber} ${status.toLowerCase()}`;
    
    if (details?.duration) {
      message += ` (${Math.round(details.duration / 1000)}s)`;
    }
    
    return message;
  }
}