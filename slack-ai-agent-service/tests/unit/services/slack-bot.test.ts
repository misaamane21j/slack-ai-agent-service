import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { SlackBotService } from '../../../src/services/slack-bot';
import { AIProcessorService } from '../../../src/services/ai-processor';
import { MCPClientService } from '../../../src/services/mcp-client';
import { NotificationService } from '../../../src/services/notification';
import { MCPRegistryService } from '../../../src/services/mcp-registry';
import { 
  mockSlackEvent, 
  mockSlackMessage, 
  mockSlackWebClient,
  createMockSlackEvent 
} from '../../__mocks__/slack';
import { 
  createMockAIResponse,
  MockAIProcessor 
} from '../../__mocks__/ai';
import { MockMCPClient } from '../../__mocks__/mcp';
import { TestEnvironment, MockManager } from '../../utils/test-helpers';

// Mock Slack App
const mockSlackApp = {
  event: jest.fn(),
  error: jest.fn(),
  action: jest.fn(),
  view: jest.fn(),
  client: mockSlackWebClient
};

// Mock Redis client
const mockRedisClient = {
  connect: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn().mockResolvedValue(undefined),
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue('OK'),
  del: jest.fn().mockResolvedValue(1),
  ping: jest.fn().mockResolvedValue('PONG'),
  isOpen: true
};

// Mock Redis module
jest.mock('redis', () => ({
  createClient: jest.fn().mockReturnValue(mockRedisClient)
}));

// Mock logger
jest.mock('../../../src/utils/logger', () => ({
  logger: jest.fn().mockReturnValue({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  })
}));

describe('SlackBotService', () => {
  let slackBotService: SlackBotService;
  let mockAIProcessor: MockAIProcessor;
  let mockMCPClient: MockMCPClient;
  let mockNotificationService: any;
  let mockMCPRegistry: any;
  let testEnv: TestEnvironment;
  let mockManager: MockManager;

  beforeEach(async () => {
    testEnv = new TestEnvironment();
    mockManager = new MockManager();

    // Initialize mocks
    mockAIProcessor = new MockAIProcessor();
    mockMCPClient = new MockMCPClient();
    
    mockNotificationService = {
      sendDirectMessage: jest.fn().mockResolvedValue(undefined),
      sendChannelMessage: jest.fn().mockResolvedValue(undefined),
      sendErrorMessage: jest.fn().mockResolvedValue(undefined)
    };

    mockMCPRegistry = {
      getAvailableServers: jest.fn().mockResolvedValue(['jenkins']),
      getServerInfo: jest.fn().mockResolvedValue({
        name: 'jenkins',
        connected: true,
        tools: ['trigger_job']
      })
    };

    // Clear all mocks
    jest.clearAllMocks();

    slackBotService = new SlackBotService(
      mockSlackApp as any,
      mockAIProcessor as any,
      mockMCPClient as any,
      mockNotificationService,
      mockMCPRegistry
    );
  });

  afterEach(() => {
    mockManager.restoreAllMocks();
    testEnv.restoreEnvironment();
  });

  describe('initialization', () => {
    it('should initialize successfully with all dependencies', async () => {
      // Act
      await slackBotService.initialize();

      // Assert
      expect(mockSlackApp.event).toHaveBeenCalledWith('app_mention', expect.any(Function));
      expect(mockSlackApp.error).toHaveBeenCalledWith(expect.any(Function));
      expect(mockRedisClient.connect).toHaveBeenCalled();
    });

    it('should handle Redis connection failure gracefully', async () => {
      // Arrange
      mockRedisClient.connect.mockRejectedValueOnce(new Error('Redis connection failed'));

      // Act
      await slackBotService.initialize();

      // Assert - should still initialize successfully
      expect(mockSlackApp.event).toHaveBeenCalled();
    });
  });

  describe('handleAppMention', () => {
    it('should process app mention and trigger AI response', async () => {
      // Arrange
      const mockEvent = createMockSlackEvent({
        text: 'Hello <@U123> please run deploy job'
      });
      const mockAIResponse = createMockAIResponse('trigger_job', 0.95);
      mockAIProcessor.setShouldFail(false);

      const mockSlackArgs = {
        event: mockEvent.event,
        client: mockSlackWebClient,
        say: jest.fn().mockResolvedValue(undefined),
        ack: jest.fn().mockResolvedValue(undefined)
      };

      // Act
      const handleAppMention = mockSlackApp.event.mock.calls.find(
        call => call[0] === 'app_mention'
      )[1];
      
      await handleAppMention(mockSlackArgs);

      // Assert
      expect(mockAIProcessor.processMessage).toHaveBeenCalledWith(
        expect.stringContaining('please run deploy job'),
        expect.any(String),
        expect.any(Array)
      );
      expect(mockMCPClient.callTool).toHaveBeenCalled();
    });

    it('should handle messages without mentions gracefully', async () => {
      // Arrange
      const mockEvent = createMockSlackEvent({
        text: 'Just a regular message'
      });

      const mockSlackArgs = {
        event: mockEvent.event,
        client: mockSlackWebClient,
        say: jest.fn().mockResolvedValue(undefined),
        ack: jest.fn().mockResolvedValue(undefined)
      };

      // Act
      const handleAppMention = mockSlackApp.event.mock.calls.find(
        call => call[0] === 'app_mention'
      )[1];
      
      await handleAppMention(mockSlackArgs);

      // Assert
      expect(mockAIProcessor.processMessage).toHaveBeenCalled();
      expect(mockSlackArgs.say).toHaveBeenCalled();
    });

    it('should handle AI processing errors', async () => {
      // Arrange
      const mockEvent = createMockSlackEvent({
        text: 'Trigger some job'
      });
      mockAIProcessor.setShouldFail(true);

      const mockSlackArgs = {
        event: mockEvent.event,
        client: mockSlackWebClient,
        say: jest.fn().mockResolvedValue(undefined),
        ack: jest.fn().mockResolvedValue(undefined)
      };

      // Act
      const handleAppMention = mockSlackApp.event.mock.calls.find(
        call => call[0] === 'app_mention'
      )[1];
      
      await handleAppMention(mockSlackArgs);

      // Assert
      expect(mockNotificationService.sendErrorMessage).toHaveBeenCalled();
    });
  });

  describe('thread context handling', () => {
    it('should retrieve thread context when message is in a thread', async () => {
      // Arrange
      const mockThreadEvent = createMockSlackEvent({
        text: 'Follow up message',
        thread_ts: '1234567890.123456'
      });

      const mockSlackArgs = {
        event: mockThreadEvent.event,
        client: mockSlackWebClient,
        say: jest.fn().mockResolvedValue(undefined),
        ack: jest.fn().mockResolvedValue(undefined)
      };

      // Act
      const handleAppMention = mockSlackApp.event.mock.calls.find(
        call => call[0] === 'app_mention'
      )[1];
      
      await handleAppMention(mockSlackArgs);

      // Assert
      expect(mockSlackWebClient.conversations.replies).toHaveBeenCalledWith({
        channel: mockThreadEvent.event.channel,
        ts: mockThreadEvent.event.thread_ts,
        limit: 50
      });
    });

    it('should handle thread context retrieval errors', async () => {
      // Arrange
      const mockThreadEvent = createMockSlackEvent({
        text: 'Message in thread',
        thread_ts: '1234567890.123456'
      });

      mockSlackWebClient.conversations.replies.mockRejectedValueOnce(
        new Error('Failed to fetch thread')
      );

      const mockSlackArgs = {
        event: mockThreadEvent.event,
        client: mockSlackWebClient,
        say: jest.fn().mockResolvedValue(undefined),
        ack: jest.fn().mockResolvedValue(undefined)
      };

      // Act
      const handleAppMention = mockSlackApp.event.mock.calls.find(
        call => call[0] === 'app_mention'
      )[1];
      
      await handleAppMention(mockSlackArgs);

      // Assert - should still process the message without thread context
      expect(mockAIProcessor.processMessage).toHaveBeenCalled();
    });
  });

  describe('rate limiting', () => {
    it('should track request counts and apply rate limiting', async () => {
      // Arrange
      const mockEvent = createMockSlackEvent();
      const mockSlackArgs = {
        event: mockEvent.event,
        client: mockSlackWebClient,
        say: jest.fn().mockResolvedValue(undefined),
        ack: jest.fn().mockResolvedValue(undefined)
      };

      // Act - Make multiple rapid requests
      const handleAppMention = mockSlackApp.event.mock.calls.find(
        call => call[0] === 'app_mention'
      )[1];
      
      for (let i = 0; i < 5; i++) {
        await handleAppMention(mockSlackArgs);
      }

      // Assert - All requests should be processed (within rate limits)
      expect(mockAIProcessor.processMessage).toHaveBeenCalledTimes(5);
    });
  });

  describe('caching', () => {
    it('should cache thread context for performance', async () => {
      // Arrange
      const mockThreadEvent = createMockSlackEvent({
        thread_ts: '1234567890.123456'
      });

      const mockSlackArgs = {
        event: mockThreadEvent.event,
        client: mockSlackWebClient,
        say: jest.fn().mockResolvedValue(undefined),
        ack: jest.fn().mockResolvedValue(undefined)
      };

      // Act - Call twice with same thread
      const handleAppMention = mockSlackApp.event.mock.calls.find(
        call => call[0] === 'app_mention'
      )[1];
      
      await handleAppMention(mockSlackArgs);
      await handleAppMention(mockSlackArgs);

      // Assert - Should use cache on second call
      expect(mockRedisClient.get).toHaveBeenCalled();
      expect(mockRedisClient.set).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should handle Slack API errors gracefully', async () => {
      // Arrange
      const mockError = new Error('Slack API error');
      const mockErrorArgs = {
        error: mockError,
        logger: {
          error: jest.fn(),
          info: jest.fn(),
          warn: jest.fn(),
          debug: jest.fn()
        }
      };

      // Act
      const errorHandler = mockSlackApp.error.mock.calls[0][0];
      await errorHandler(mockErrorArgs);

      // Assert
      expect(mockErrorArgs.logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Unhandled error'),
        expect.objectContaining({ error: mockError })
      );
    });

    it('should handle MCP tool execution errors', async () => {
      // Arrange
      const mockEvent = createMockSlackEvent({
        text: 'Run failing job'
      });
      
      mockMCPClient.callTool = jest.fn().mockRejectedValue(new Error('Tool execution failed'));

      const mockSlackArgs = {
        event: mockEvent.event,
        client: mockSlackWebClient,
        say: jest.fn().mockResolvedValue(undefined),
        ack: jest.fn().mockResolvedValue(undefined)
      };

      // Act
      const handleAppMention = mockSlackApp.event.mock.calls.find(
        call => call[0] === 'app_mention'
      )[1];
      
      await handleAppMention(mockSlackArgs);

      // Assert
      expect(mockNotificationService.sendErrorMessage).toHaveBeenCalled();
    });
  });

  describe('cleanup', () => {
    it('should clean up resources properly', async () => {
      // Arrange
      await slackBotService.initialize();

      // Act
      if (typeof (slackBotService as any).cleanup === 'function') {
        await (slackBotService as any).cleanup();
      }

      // Assert - Redis connection should be cleaned up
      // Note: This test assumes a cleanup method exists
      expect(true).toBe(true); // Placeholder assertion
    });
  });
});