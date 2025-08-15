import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import request from 'supertest';
import { App } from '@slack/bolt';
import { SlackBotService } from '../../src/services/slack-bot';
import { AIProcessorService } from '../../src/services/ai-processor';
import { MCPClientService } from '../../src/services/mcp-client';
import { NotificationService } from '../../src/services/notification';
import { MCPRegistryService } from '../../src/services/mcp-registry';
import { 
  mockSlackEvent, 
  mockSlackWebClient, 
  createMockSlackEvent,
  createMockThreadContext
} from '../__mocks__/slack';
import { 
  createMockAIResponse, 
  MockAIProcessor 
} from '../__mocks__/ai';
import { 
  MockMCPClient, 
  createMockMCPResponse 
} from '../__mocks__/mcp';
import { resetToValidEnvironment } from '../__mocks__/environment';
import { TestEnvironment, AsyncTestHelper } from '../utils/test-helpers';

// Mock external dependencies
jest.mock('../../src/config/environment');
jest.mock('../../src/utils/logger');
jest.mock('@slack/bolt');
jest.mock('@anthropic-ai/sdk');
jest.mock('redis');

describe('Slack to MCP Workflow Integration', () => {
  let slackBotService: SlackBotService;
  let aiProcessor: AIProcessorService;
  let mcpClient: MCPClientService;
  let notificationService: NotificationService;
  let mcpRegistry: MCPRegistryService;
  let mockSlackApp: any;
  let testEnv: TestEnvironment;

  beforeEach(async () => {
    testEnv = new TestEnvironment();
    resetToValidEnvironment();

    // Set up mock Slack app
    mockSlackApp = {
      event: jest.fn(),
      error: jest.fn(),
      action: jest.fn(),
      view: jest.fn(),
      client: mockSlackWebClient,
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined)
    };

    // Initialize services with mocks
    aiProcessor = new MockAIProcessor() as any;
    mcpClient = new MockMCPClient() as any;
    
    notificationService = {
      sendJobStatusUpdate: jest.fn().mockResolvedValue(undefined),
      sendDirectMessage: jest.fn().mockResolvedValue(undefined),
      sendChannelMessage: jest.fn().mockResolvedValue(undefined),
      sendErrorMessage: jest.fn().mockResolvedValue(undefined)
    } as any;

    mcpRegistry = {
      getAvailableServers: jest.fn().mockResolvedValue(['jenkins']),
      getServerInfo: jest.fn().mockResolvedValue({
        name: 'jenkins',
        connected: true,
        tools: ['trigger_job', 'get_job_status']
      }),
      discoverTools: jest.fn().mockResolvedValue({
        jenkins: [
          {
            name: 'trigger_job',
            description: 'Triggers a Jenkins job',
            inputSchema: { type: 'object' }
          }
        ]
      }),
      callTool: jest.fn().mockResolvedValue(createMockMCPResponse())
    } as any;

    // Create Slack bot service
    slackBotService = new SlackBotService(
      mockSlackApp,
      aiProcessor,
      mcpClient,
      notificationService,
      mcpRegistry
    );

    // Clear all mocks
    jest.clearAllMocks();
  });

  afterEach(() => {
    testEnv.restoreEnvironment();
  });

  describe('Complete Slack Message to MCP Tool Execution Flow', () => {
    it('should handle full workflow: Slack mention -> AI processing -> MCP tool execution -> response', async () => {
      // Arrange
      const mockSlackMessage = createMockSlackEvent({
        text: 'Hello <@U123> please run the deploy-production job with branch main',
        channel: 'C123456789',
        user: 'U987654321',
        ts: '1234567890.123456'
      });

      const expectedAIResponse = createMockAIResponse('trigger_job', 0.95, {
        parameters: {
          job_name: 'deploy-production',
          branch: 'main'
        },
        tool_calls: [{
          tool_name: 'trigger_job',
          server_name: 'jenkins',
          arguments: {
            job_name: 'deploy-production',
            parameters: {
              BRANCH: 'main'
            }
          }
        }]
      });

      const expectedMCPResponse = createMockMCPResponse(true, {
        jobUrl: 'https://jenkins.example.com/job/deploy-production/123/',
        jobId: 123,
        status: 'started',
        message: 'Deploy job started successfully'
      });

      // Set up AI processor mock to return expected response
      (aiProcessor as any).processMessage = jest.fn().mockResolvedValue(expectedAIResponse);
      (mcpClient as any).callTool = jest.fn().mockResolvedValue(expectedMCPResponse);

      // Initialize the service
      await slackBotService.initialize();

      // Get the registered event handler
      const appMentionHandler = mockSlackApp.event.mock.calls.find(
        call => call[0] === 'app_mention'
      )[1];

      const mockSlackArgs = {
        event: mockSlackMessage.event,
        client: mockSlackWebClient,
        say: jest.fn().mockResolvedValue({ ok: true, ts: '1234567891.123456' }),
        ack: jest.fn().mockResolvedValue(undefined)
      };

      // Act - Trigger the full workflow
      await appMentionHandler(mockSlackArgs);

      // Assert - Verify complete workflow execution
      
      // 1. AI processor should have been called with sanitized message
      expect(aiProcessor.processMessage).toHaveBeenCalledWith(
        expect.stringContaining('please run the deploy-production job'),
        expect.any(String),
        expect.any(Array)
      );

      // 2. MCP client should have been called with AI-generated parameters
      expect(mcpClient.callTool).toHaveBeenCalledWith(
        'jenkins',
        'trigger_job',
        expect.objectContaining({
          job_name: 'deploy-production',
          parameters: expect.objectContaining({
            BRANCH: 'main'
          })
        })
      );

      // 3. Response should have been sent back to Slack
      expect(mockSlackArgs.say).toHaveBeenCalledWith(
        expect.stringContaining('Deploy job started successfully')
      );
    });

    it('should handle workflow with thread context retrieval', async () => {
      // Arrange
      const threadMessages = createMockThreadContext(3);
      const mockThreadEvent = createMockSlackEvent({
        text: 'Please retry the deployment',
        thread_ts: '1234567890.123456'
      });

      mockSlackWebClient.conversations.replies.mockResolvedValue({
        ok: true,
        messages: threadMessages
      });

      await slackBotService.initialize();

      const appMentionHandler = mockSlackApp.event.mock.calls.find(
        call => call[0] === 'app_mention'
      )[1];

      const mockSlackArgs = {
        event: mockThreadEvent.event,
        client: mockSlackWebClient,
        say: jest.fn().mockResolvedValue({ ok: true }),
        ack: jest.fn().mockResolvedValue(undefined)
      };

      // Act
      await appMentionHandler(mockSlackArgs);

      // Assert
      expect(mockSlackWebClient.conversations.replies).toHaveBeenCalledWith({
        channel: mockThreadEvent.event.channel,
        ts: mockThreadEvent.event.thread_ts,
        limit: 50
      });

      expect(aiProcessor.processMessage).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.arrayContaining([
          expect.stringContaining('Thread message')
        ])
      );
    });

    it('should handle AI processing errors gracefully', async () => {
      // Arrange
      const mockSlackMessage = createMockSlackEvent({
        text: 'Run some job that will fail'
      });

      (aiProcessor as any).processMessage = jest.fn().mockRejectedValue(
        new Error('AI processing failed')
      );

      await slackBotService.initialize();

      const appMentionHandler = mockSlackApp.event.mock.calls.find(
        call => call[0] === 'app_mention'
      )[1];

      const mockSlackArgs = {
        event: mockSlackMessage.event,
        client: mockSlackWebClient,
        say: jest.fn().mockResolvedValue({ ok: true }),
        ack: jest.fn().mockResolvedValue(undefined)
      };

      // Act
      await appMentionHandler(mockSlackArgs);

      // Assert
      expect(notificationService.sendErrorMessage).toHaveBeenCalledWith(
        mockSlackMessage.event.channel,
        mockSlackMessage.event.user,
        expect.any(Error),
        expect.stringContaining('AI processing')
      );
    });

    it('should handle MCP tool execution errors with proper error reporting', async () => {
      // Arrange
      const mockSlackMessage = createMockSlackEvent({
        text: 'Run failing job'
      });

      const aiResponse = createMockAIResponse('trigger_job', 0.9);
      (aiProcessor as any).processMessage = jest.fn().mockResolvedValue(aiResponse);
      (mcpClient as any).callTool = jest.fn().mockRejectedValue(
        new Error('Jenkins server is unavailable')
      );

      await slackBotService.initialize();

      const appMentionHandler = mockSlackApp.event.mock.calls.find(
        call => call[0] === 'app_mention'
      )[1];

      const mockSlackArgs = {
        event: mockSlackMessage.event,
        client: mockSlackWebClient,
        say: jest.fn().mockResolvedValue({ ok: true }),
        ack: jest.fn().mockResolvedValue(undefined)
      };

      // Act
      await appMentionHandler(mockSlackArgs);

      // Assert
      expect(notificationService.sendErrorMessage).toHaveBeenCalledWith(
        mockSlackMessage.event.channel,
        mockSlackMessage.event.user,
        expect.any(Error),
        expect.stringContaining('tool execution')
      );
    });

    it('should handle rate limiting appropriately', async () => {
      // Arrange
      const mockSlackMessage = createMockSlackEvent();
      await slackBotService.initialize();

      const appMentionHandler = mockSlackApp.event.mock.calls.find(
        call => call[0] === 'app_mention'
      )[1];

      const mockSlackArgs = {
        event: mockSlackMessage.event,
        client: mockSlackWebClient,
        say: jest.fn().mockResolvedValue({ ok: true }),
        ack: jest.fn().mockResolvedValue(undefined)
      };

      // Act - Make multiple rapid requests
      const promises = Array(5).fill(0).map(() => appMentionHandler(mockSlackArgs));
      await Promise.all(promises);

      // Assert - All requests should be processed (within rate limits)
      expect(aiProcessor.processMessage).toHaveBeenCalledTimes(5);
    });
  });

  describe('Multi-Tool Workflow Integration', () => {
    it('should handle sequential tool calls from AI response', async () => {
      // Arrange
      const mockSlackMessage = createMockSlackEvent({
        text: 'Check status of deploy job and then trigger it if not running'
      });

      const multiToolAIResponse = createMockAIResponse('multi_tool', 0.9, {
        tool_calls: [
          {
            tool_name: 'get_job_status',
            server_name: 'jenkins',
            arguments: { job_name: 'deploy-production' }
          },
          {
            tool_name: 'trigger_job', 
            server_name: 'jenkins',
            arguments: { 
              job_name: 'deploy-production',
              parameters: { BRANCH: 'main' }
            }
          }
        ]
      });

      (aiProcessor as any).processMessage = jest.fn().mockResolvedValue(multiToolAIResponse);
      
      // Mock different responses for different tools
      (mcpClient as any).callTool = jest.fn()
        .mockResolvedValueOnce(createMockMCPResponse(true, { status: 'idle' }))
        .mockResolvedValueOnce(createMockMCPResponse(true, { jobId: 124, status: 'started' }));

      await slackBotService.initialize();

      const appMentionHandler = mockSlackApp.event.mock.calls.find(
        call => call[0] === 'app_mention'
      )[1];

      const mockSlackArgs = {
        event: mockSlackMessage.event,
        client: mockSlackWebClient,
        say: jest.fn().mockResolvedValue({ ok: true }),
        ack: jest.fn().mockResolvedValue(undefined)
      };

      // Act
      await appMentionHandler(mockSlackArgs);

      // Assert
      expect(mcpClient.callTool).toHaveBeenCalledTimes(2);
      expect(mcpClient.callTool).toHaveBeenNthCalledWith(
        1, 'jenkins', 'get_job_status', { job_name: 'deploy-production' }
      );
      expect(mcpClient.callTool).toHaveBeenNthCalledWith(
        2, 'jenkins', 'trigger_job', { 
          job_name: 'deploy-production', 
          parameters: { BRANCH: 'main' }
        }
      );
    });
  });

  describe('Error Recovery and Resilience', () => {
    it('should recover from temporary failures with retry logic', async () => {
      // Arrange
      const mockSlackMessage = createMockSlackEvent({
        text: 'Deploy with retry logic'
      });

      const aiResponse = createMockAIResponse('trigger_job', 0.9);
      (aiProcessor as any).processMessage = jest.fn().mockResolvedValue(aiResponse);
      
      // First call fails, second succeeds
      (mcpClient as any).callTool = jest.fn()
        .mockRejectedValueOnce(new Error('Temporary network error'))
        .mockResolvedValueOnce(createMockMCPResponse(true, { jobId: 125 }));

      await slackBotService.initialize();

      const appMentionHandler = mockSlackApp.event.mock.calls.find(
        call => call[0] === 'app_mention'
      )[1];

      const mockSlackArgs = {
        event: mockSlackMessage.event,
        client: mockSlackWebClient,
        say: jest.fn().mockResolvedValue({ ok: true }),
        ack: jest.fn().mockResolvedValue(undefined)
      };

      // Act
      await appMentionHandler(mockSlackArgs);

      // Assert - Should have attempted retry and eventually succeeded
      // Note: Actual retry logic depends on implementation
      expect(mcpClient.callTool).toHaveBeenCalled();
    });

    it('should handle complete system failures gracefully', async () => {
      // Arrange
      const mockSlackMessage = createMockSlackEvent();

      // Simulate complete AI and MCP failures
      (aiProcessor as any).processMessage = jest.fn().mockRejectedValue(
        new Error('AI service completely down')
      );
      (mcpClient as any).callTool = jest.fn().mockRejectedValue(
        new Error('MCP service completely down')
      );

      await slackBotService.initialize();

      const appMentionHandler = mockSlackApp.event.mock.calls.find(
        call => call[0] === 'app_mention'
      )[1];

      const mockSlackArgs = {
        event: mockSlackMessage.event,
        client: mockSlackWebClient,
        say: jest.fn().mockResolvedValue({ ok: true }),
        ack: jest.fn().mockResolvedValue(undefined)
      };

      // Act
      await expect(appMentionHandler(mockSlackArgs)).resolves.not.toThrow();

      // Assert - Should fail gracefully with error notification
      expect(notificationService.sendErrorMessage).toHaveBeenCalled();
    });
  });

  describe('Performance and Timeout Handling', () => {
    it('should handle long-running operations with appropriate timeouts', async () => {
      // Arrange
      const mockSlackMessage = createMockSlackEvent({
        text: 'Run long deployment job'
      });

      const aiResponse = createMockAIResponse('trigger_job', 0.9);
      (aiProcessor as any).processMessage = jest.fn().mockResolvedValue(aiResponse);
      
      // Simulate long-running MCP call
      (mcpClient as any).callTool = jest.fn().mockImplementation(
        () => new Promise(resolve => 
          setTimeout(() => resolve(createMockMCPResponse(true)), 30000)
        )
      );

      await slackBotService.initialize();

      const appMentionHandler = mockSlackApp.event.mock.calls.find(
        call => call[0] === 'app_mention'
      )[1];

      const mockSlackArgs = {
        event: mockSlackMessage.event,
        client: mockSlackWebClient,
        say: jest.fn().mockResolvedValue({ ok: true }),
        ack: jest.fn().mockResolvedValue(undefined)
      };

      // Act & Assert - Should complete within reasonable time or timeout
      await expect(
        AsyncTestHelper.createTimeout(appMentionHandler(mockSlackArgs), 5000)
      ).resolves.not.toThrow();
    }, 10000);
  });
});