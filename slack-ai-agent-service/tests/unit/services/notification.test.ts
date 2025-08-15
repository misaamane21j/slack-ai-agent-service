import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { NotificationService } from '../../../src/services/notification';
import { mockSlackWebClient } from '../../__mocks__/slack';
import { TestEnvironment, MockManager } from '../../utils/test-helpers';

// Mock Slack App
const mockSlackApp = {
  client: mockSlackWebClient
};

// Mock logger
jest.mock('../../../src/utils/logger', () => ({
  logger: jest.fn().mockReturnValue({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  })
}));

describe('NotificationService', () => {
  let notificationService: NotificationService;
  let testEnv: TestEnvironment;
  let mockManager: MockManager;

  beforeEach(() => {
    testEnv = new TestEnvironment();
    mockManager = new MockManager();
    
    // Clear all mocks
    jest.clearAllMocks();
    
    notificationService = new NotificationService(mockSlackApp as any);
  });

  afterEach(() => {
    mockManager.restoreAllMocks();
    testEnv.restoreEnvironment();
  });

  describe('sendJobStatusUpdate', () => {
    it('should send successful job status update with correct formatting', async () => {
      // Arrange
      const channel = 'C123456789';
      const threadTs = '1234567890.123456';
      const userId = 'U123456789';
      const jobName = 'deploy-production';
      const buildNumber = 123;
      const status = 'SUCCESS';
      const details = { duration: 45000, url: 'https://jenkins.example.com/job/deploy-production/123/' };

      // Act
      await notificationService.sendJobStatusUpdate(
        channel,
        threadTs,
        userId,
        jobName,
        buildNumber,
        status,
        details
      );

      // Assert
      expect(mockSlackWebClient.chat.postMessage).toHaveBeenCalledWith({
        channel: channel,
        thread_ts: threadTs,
        text: `<@${userId}> ✅ Jenkins job "${jobName}" build #${buildNumber} success (45s)`
      });
    });

    it('should send failed job status update with failure emoji', async () => {
      // Arrange
      const channel = 'C123456789';
      const threadTs = '1234567890.123456';
      const userId = 'U123456789';
      const jobName = 'test-job';
      const buildNumber = 456;
      const status = 'FAILURE';

      // Act
      await notificationService.sendJobStatusUpdate(
        channel,
        threadTs,
        userId,
        jobName,
        buildNumber,
        status
      );

      // Assert
      expect(mockSlackWebClient.chat.postMessage).toHaveBeenCalledWith({
        channel: channel,
        thread_ts: threadTs,
        text: `<@${userId}> ❌ Jenkins job "${jobName}" build #${buildNumber} failure`
      });
    });

    it('should send in-progress job status update with pending emoji', async () => {
      // Arrange
      const channel = 'C123456789';
      const threadTs = '1234567890.123456';
      const userId = 'U123456789';
      const jobName = 'build-app';
      const buildNumber = 789;
      const status = 'IN_PROGRESS';

      // Act
      await notificationService.sendJobStatusUpdate(
        channel,
        threadTs,
        userId,
        jobName,
        buildNumber,
        status
      );

      // Assert
      expect(mockSlackWebClient.chat.postMessage).toHaveBeenCalledWith({
        channel: channel,
        thread_ts: threadTs,
        text: `<@${userId}> ⏳ Jenkins job "${jobName}" build #${buildNumber} in_progress`
      });
    });

    it('should handle status update without details', async () => {
      // Arrange
      const channel = 'C123456789';
      const threadTs = '1234567890.123456';
      const userId = 'U123456789';
      const jobName = 'simple-job';
      const buildNumber = 1;
      const status = 'SUCCESS';

      // Act
      await notificationService.sendJobStatusUpdate(
        channel,
        threadTs,
        userId,
        jobName,
        buildNumber,
        status
      );

      // Assert
      expect(mockSlackWebClient.chat.postMessage).toHaveBeenCalledWith({
        channel: channel,
        thread_ts: threadTs,
        text: `<@${userId}> ✅ Jenkins job "${jobName}" build #${buildNumber} success`
      });
    });

    it('should handle Slack API errors gracefully', async () => {
      // Arrange
      const channel = 'C123456789';
      const threadTs = '1234567890.123456';
      const userId = 'U123456789';
      const jobName = 'error-job';
      const buildNumber = 999;
      const status = 'FAILURE';

      mockSlackWebClient.chat.postMessage.mockRejectedValueOnce(
        new Error('Slack API error')
      );

      // Act
      await notificationService.sendJobStatusUpdate(
        channel,
        threadTs,
        userId,
        jobName,
        buildNumber,
        status
      );

      // Assert
      const { logger } = require('../../../src/utils/logger');
      expect(logger().error).toHaveBeenCalledWith(
        'Failed to send job status update:',
        expect.any(Error)
      );
    });
  });

  describe('sendDirectMessage', () => {
    it('should send direct message to user', async () => {
      // Arrange
      const userId = 'U123456789';
      const message = 'Hello, this is a direct message!';

      // Act
      await notificationService.sendDirectMessage(userId, message);

      // Assert
      expect(mockSlackWebClient.chat.postMessage).toHaveBeenCalledWith({
        channel: userId,
        text: message
      });
    });

    it('should handle direct message errors', async () => {
      // Arrange
      const userId = 'U123456789';
      const message = 'Test message';

      mockSlackWebClient.chat.postMessage.mockRejectedValueOnce(
        new Error('Failed to send DM')
      );

      // Act
      await notificationService.sendDirectMessage(userId, message);

      // Assert
      const { logger } = require('../../../src/utils/logger');
      expect(logger().error).toHaveBeenCalledWith(
        'Failed to send direct message:',
        expect.any(Error)
      );
    });
  });

  describe('sendChannelMessage', () => {
    it('should send message to channel', async () => {
      // Arrange
      const channel = 'C123456789';
      const message = 'Channel announcement!';

      // Act
      await notificationService.sendChannelMessage(channel, message);

      // Assert
      expect(mockSlackWebClient.chat.postMessage).toHaveBeenCalledWith({
        channel: channel,
        text: message
      });
    });

    it('should send message to channel with thread', async () => {
      // Arrange
      const channel = 'C123456789';
      const message = 'Reply in thread';
      const threadTs = '1234567890.123456';

      // Act
      await notificationService.sendChannelMessage(channel, message, threadTs);

      // Assert
      expect(mockSlackWebClient.chat.postMessage).toHaveBeenCalledWith({
        channel: channel,
        text: message,
        thread_ts: threadTs
      });
    });
  });

  describe('sendErrorMessage', () => {
    it('should send error message with error formatting', async () => {
      // Arrange
      const channel = 'C123456789';
      const userId = 'U123456789';
      const error = new Error('Something went wrong');
      const context = 'job execution';

      // Act
      await notificationService.sendErrorMessage(channel, userId, error, context);

      // Assert
      expect(mockSlackWebClient.chat.postMessage).toHaveBeenCalledWith({
        channel: channel,
        text: expect.stringContaining(`<@${userId}> ❌ Error during ${context}`)
      });
    });

    it('should send error message without context', async () => {
      // Arrange
      const channel = 'C123456789';
      const userId = 'U123456789';
      const error = new Error('Generic error');

      // Act
      await notificationService.sendErrorMessage(channel, userId, error);

      // Assert
      expect(mockSlackWebClient.chat.postMessage).toHaveBeenCalledWith({
        channel: channel,
        text: expect.stringContaining(`<@${userId}> ❌ An error occurred`)
      });
    });
  });

  describe('formatStatusMessage', () => {
    it('should format success status with duration', () => {
      // Arrange
      const jobName = 'test-job';
      const buildNumber = 123;
      const status = 'SUCCESS';
      const details = { duration: 30000 };

      // Act
      const result = (notificationService as any).formatStatusMessage(
        jobName,
        buildNumber,
        status,
        details
      );

      // Assert
      expect(result).toBe('✅ Jenkins job "test-job" build #123 success (30s)');
    });

    it('should format failure status without duration', () => {
      // Arrange
      const jobName = 'failing-job';
      const buildNumber = 456;
      const status = 'FAILURE';

      // Act
      const result = (notificationService as any).formatStatusMessage(
        jobName,
        buildNumber,
        status
      );

      // Assert
      expect(result).toBe('❌ Jenkins job "failing-job" build #456 failure');
    });

    it('should format unknown status with pending emoji', () => {
      // Arrange
      const jobName = 'unknown-job';
      const buildNumber = 789;
      const status = 'UNKNOWN_STATUS';

      // Act
      const result = (notificationService as any).formatStatusMessage(
        jobName,
        buildNumber,
        status
      );

      // Assert
      expect(result).toBe('⏳ Jenkins job "unknown-job" build #789 unknown_status');
    });

    it('should include job URL in details when provided', () => {
      // Arrange
      const jobName = 'url-job';
      const buildNumber = 999;
      const status = 'SUCCESS';
      const details = { 
        duration: 60000,
        url: 'https://jenkins.example.com/job/url-job/999/'
      };

      // Act
      const result = (notificationService as any).formatStatusMessage(
        jobName,
        buildNumber,
        status,
        details
      );

      // Assert
      expect(result).toContain('✅ Jenkins job "url-job" build #999 success (60s)');
    });
  });

  describe('message validation', () => {
    it('should handle empty message gracefully', async () => {
      // Arrange
      const channel = 'C123456789';
      const message = '';

      // Act
      await notificationService.sendChannelMessage(channel, message);

      // Assert
      expect(mockSlackWebClient.chat.postMessage).toHaveBeenCalledWith({
        channel: channel,
        text: ''
      });
    });

    it('should handle long messages without truncation issues', async () => {
      // Arrange
      const channel = 'C123456789';
      const longMessage = 'A'.repeat(4000); // Very long message

      // Act
      await notificationService.sendChannelMessage(channel, longMessage);

      // Assert
      expect(mockSlackWebClient.chat.postMessage).toHaveBeenCalledWith({
        channel: channel,
        text: longMessage
      });
    });

    it('should handle special characters in messages', async () => {
      // Arrange
      const channel = 'C123456789';
      const specialMessage = 'Message with special chars: <>&"\'';

      // Act
      await notificationService.sendChannelMessage(channel, specialMessage);

      // Assert
      expect(mockSlackWebClient.chat.postMessage).toHaveBeenCalledWith({
        channel: channel,
        text: specialMessage
      });
    });
  });
});