import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { SlackBotService } from '../../src/services/slack-bot';
import { AIProcessorService } from '../../src/services/ai-processor';
import { MCPClientService } from '../../src/services/mcp-client';
import { NotificationService } from '../../src/services/notification';
import { MCPRegistryService } from '../../src/services/mcp-registry';
import { AIAgentResponse, ToolDefinition, ToolInvocationResult } from '../../src/types/ai-agent';

// Mock dependencies
jest.mock('../../src/utils/logger', () => ({
  logger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  })
}));
jest.mock('../../src/services/ai-processor');
jest.mock('../../src/services/mcp-client');
jest.mock('../../src/services/notification');
jest.mock('../../src/services/mcp-registry');

describe('SlackBotService - Enhanced Integration Tests', () => {
  let slackBotService: SlackBotService;
  let mockApp: any;
  let mockAIProcessor: jest.Mocked<AIProcessorService>;
  let mockMCPClient: jest.Mocked<MCPClientService>;
  let mockNotificationService: jest.Mocked<NotificationService>;
  let mockMCPRegistry: jest.Mocked<MCPRegistryService>;
  let mockSay: jest.Mock;
  let mockClient: any;

  const mockSlackEvent = {
    user: 'U123456',
    channel: 'C123456',
    text: '<@U987654> test message',
    ts: '1234567890.123456',
    thread_ts: undefined
  };

  const mockAvailableTools: ToolDefinition[] = [
    {
      serverId: 'jenkins',
      name: 'trigger_job',
      description: 'Trigger a Jenkins job build',
      inputSchema: { jobName: 'string', parameters: 'object' }
    },
    {
      serverId: 'github',
      name: 'create_issue',
      description: 'Create a GitHub issue',
      inputSchema: { title: 'string', body: 'string' }
    },
    {
      serverId: 'database',
      name: 'execute_query',
      description: 'Execute a database query',
      inputSchema: { query: 'string', database: 'string' }
    }
  ];

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Mock Slack app
    mockApp = {
      event: jest.fn(),
      error: jest.fn(),
      action: jest.fn()
    };

    // Mock say function
    mockSay = jest.fn();

    // Mock client
    mockClient = {
      reactions: {
        add: jest.fn()
      }
    };

    // Mock AI Processor
    mockAIProcessor = {
      processMessage: jest.fn(),
      getConfidenceThreshold: jest.fn().mockReturnValue(0.8),
      refreshTools: jest.fn(),
      getAvailableTools: jest.fn().mockReturnValue(mockAvailableTools),
      getToolByNameAndServer: jest.fn(),
      executeToolInvocation: jest.fn(),
      cleanup: jest.fn()
    } as any;

    // Mock MCP Client
    mockMCPClient = {
      triggerJenkinsJob: jest.fn()
    } as any;

    // Mock Notification Service
    mockNotificationService = {
      sendNotification: jest.fn()
    } as any;

    // Mock MCP Registry
    mockMCPRegistry = {
      initialize: jest.fn(),
      discoverAllTools: jest.fn(),
      discoverServerTools: jest.fn(),
      invokeToolSafely: jest.fn(),
      destroy: jest.fn()
    } as any;
    
    // Setup default mock values
    mockMCPRegistry.discoverAllTools.mockResolvedValue(mockAvailableTools);

    // Create service instance
    slackBotService = new SlackBotService(
      mockApp,
      mockAIProcessor,
      mockMCPClient,
      mockNotificationService,
      mockMCPRegistry
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Enhanced Tool Invocation Handling', () => {
    it('should handle successful tool invocation with rich formatting', async () => {
      // Arrange
      const toolInvocationResponse: AIAgentResponse = {
        intent: 'tool_invocation',
        confidence: 0.9,
        tool: {
          serverId: 'github', // Use github to avoid Jenkins-specific flow
          toolName: 'create_issue',
          parameters: { title: 'Test Issue', body: 'Test description' }
        },
        reasoning: 'User wants to create GitHub issue'
      };

      const successResult: ToolInvocationResult = {
        success: true,
        data: { issueNumber: 123, issueUrl: 'https://github.com/org/repo/issues/123' },
        executionTime: 1500
      };

      mockAIProcessor.processMessage.mockResolvedValue(toolInvocationResponse);
      mockMCPRegistry.invokeToolSafely.mockResolvedValue(successResult);

      // Act
      await slackBotService['handleAppMention']({
        event: mockSlackEvent,
        client: mockClient,
        say: mockSay
      } as any);

      // Assert
      expect(mockSay).toHaveBeenCalledWith(
        expect.objectContaining({
          thread_ts: mockSlackEvent.ts,
          text: expect.stringContaining('Executing create_issue')
        })
      );

      expect(mockSay).toHaveBeenCalledWith(
        expect.objectContaining({
          thread_ts: mockSlackEvent.ts,
          blocks: expect.arrayContaining([
            expect.objectContaining({
              type: 'section',
              text: expect.objectContaining({
                text: expect.stringContaining('✅ Successfully executed')
              })
            })
          ])
        })
      );
    });

    it('should handle failed tool invocation with interactive retry buttons', async () => {
      // Arrange
      const toolInvocationResponse: AIAgentResponse = {
        intent: 'tool_invocation',
        confidence: 0.85,
        tool: {
          serverId: 'github',
          toolName: 'create_issue',
          parameters: { title: 'Bug report', body: 'Description' }
        },
        reasoning: 'User wants to create GitHub issue'
      };

      const failureResult: ToolInvocationResult = {
        success: false,
        error: 'Authentication failed: Invalid token',
        executionTime: 500
      };

      mockAIProcessor.processMessage.mockResolvedValue(toolInvocationResponse);
      mockMCPRegistry.invokeToolSafely.mockResolvedValue(failureResult);

      // Act
      await slackBotService['handleAppMention']({
        event: mockSlackEvent,
        client: mockClient,
        say: mockSay
      } as any);

      // Assert
      expect(mockSay).toHaveBeenCalledWith(
        expect.objectContaining({
          thread_ts: mockSlackEvent.ts,
          blocks: expect.arrayContaining([
            expect.objectContaining({
              type: 'section',
              text: expect.objectContaining({
                text: expect.stringContaining('❌ Failed to execute')
              })
            }),
            expect.objectContaining({
              type: 'context',
              elements: expect.arrayContaining([
                expect.objectContaining({
                  text: expect.stringContaining('💡 Try rephrasing')
                })
              ])
            })
          ])
        })
      );
    });

    it('should format different data types correctly', async () => {
      // Test string data
      const stringResult = slackBotService['formatToolData']('Simple string response');
      expect(stringResult).toBe('Simple string response');

      // Test build number data
      const buildResult = slackBotService['formatToolData']({
        buildNumber: 456,
        buildUrl: 'https://jenkins.example.com/job/test/456'
      });
      expect(buildResult).toContain('🔨 Build #456');
      expect(buildResult).toContain('View Build');

      // Test issue data
      const issueResult = slackBotService['formatToolData']({
        issueNumber: 789,
        issueUrl: 'https://github.com/org/repo/issues/789'
      });
      expect(issueResult).toContain('🐛 Issue #789');
      expect(issueResult).toContain('View Issue');

      // Test status data
      const statusResult = slackBotService['formatToolData']({ status: 'completed' });
      expect(statusResult).toContain('📊 Status: completed');
    });
  });

  describe('Enhanced Clarification Handling', () => {
    it('should provide helpful suggestions when clarification is needed', async () => {
      // Arrange
      const clarificationResponse: AIAgentResponse = {
        intent: 'clarification_needed',
        confidence: 0.9, // Use confidence above threshold
        message: 'Could you specify which environment to deploy to?',
        reasoning: 'Deployment environment not specified'
      };

      mockAIProcessor.processMessage.mockResolvedValue(clarificationResponse);
      mockMCPRegistry.discoverAllTools.mockResolvedValue(mockAvailableTools);

      // Act
      await slackBotService['handleAppMention']({
        event: mockSlackEvent,
        client: mockClient,
        say: mockSay
      } as any);

      // Assert
      expect(mockSay).toHaveBeenCalledWith(
        expect.objectContaining({
          thread_ts: mockSlackEvent.ts,
          text: expect.stringContaining('Could you specify which environment to deploy to?'),
          blocks: expect.arrayContaining([
            expect.objectContaining({
              type: 'section',
              text: expect.objectContaining({
                text: expect.stringContaining('🤔 Could you specify')
              })
            }),
            expect.objectContaining({
              type: 'section',
              text: expect.objectContaining({
                text: expect.stringContaining('💡 *Available tools:*')
              })
            })
          ])
        })
      );
    });
  });

  describe('Enhanced General Conversation Handling', () => {
    it('should provide helpful information for help requests', async () => {
      // Arrange
      const conversationResponse: AIAgentResponse = {
        intent: 'general_conversation',
        confidence: 0.9, // Use confidence above threshold
        message: 'I can help you with various automation tasks. What would you like to do?',
        reasoning: 'User asking for general help'
      };

      mockAIProcessor.processMessage.mockResolvedValue(conversationResponse);

      // Act
      await slackBotService['handleAppMention']({
        event: { ...mockSlackEvent, text: '<@U987654> help me please' },
        client: mockClient,
        say: mockSay
      } as any);

      // Assert
      expect(mockSay).toHaveBeenCalledWith(
        expect.objectContaining({
          thread_ts: mockSlackEvent.ts,
          text: expect.stringContaining('I can help you with various automation tasks'),
          blocks: expect.arrayContaining([
            expect.objectContaining({
              type: 'section',
              text: expect.objectContaining({
                text: expect.stringContaining('💬 I can help you')
              })
            }),
            expect.objectContaining({
              type: 'section',
              text: expect.objectContaining({
                text: expect.stringContaining('🚀 *I can help you with:*')
              })
            }),
            expect.objectContaining({
              type: 'context',
              elements: expect.arrayContaining([
                expect.objectContaining({
                  text: expect.stringContaining('💡 Try saying something like')
                })
              ])
            })
          ])
        })
      );
    });
  });

  describe('Interactive Button Handlers', () => {
    beforeEach(async () => {
      await slackBotService.initialize();
    });

    it('should register retry button handler', () => {
      expect(mockApp.action).toHaveBeenCalledWith('retry_tool_execution', expect.any(Function));
    });

    it('should register help button handler', () => {
      expect(mockApp.action).toHaveBeenCalledWith('tool_help', expect.any(Function));
    });

    it('should handle retry button clicks', async () => {
      // Get the handler function that was registered
      const retryHandler = mockApp.action.mock.calls.find(
        (call: any) => call[0] === 'retry_tool_execution'
      )?.[1];

      expect(retryHandler).toBeDefined();

      // Mock the retry button interaction
      const mockAck = jest.fn();
      const mockBody = {
        actions: [{
          value: JSON.stringify({
            serverId: 'jenkins',
            toolName: 'trigger_job',
            parameters: { jobName: 'test' }
          })
        }],
        message: { thread_ts: '1234567890.123456' }
      };

      const successResult: ToolInvocationResult = {
        success: true,
        data: { buildNumber: 789 },
        executionTime: 1200
      };

      mockMCPRegistry.invokeToolSafely.mockResolvedValue(successResult);

      // Execute the retry handler
      await retryHandler({
        ack: mockAck,
        body: mockBody,
        say: mockSay,
        client: mockClient
      });

      // Assert
      expect(mockAck).toHaveBeenCalled();
      expect(mockMCPRegistry.invokeToolSafely).toHaveBeenCalledWith(
        'jenkins',
        'trigger_job',
        { jobName: 'test' }
      );
    });

    it('should handle help button clicks', async () => {
      // Get the handler function that was registered
      const helpHandler = mockApp.action.mock.calls.find(
        (call: any) => call[0] === 'tool_help'
      )?.[1];

      expect(helpHandler).toBeDefined();

      // Mock the help button interaction
      const mockAck = jest.fn();
      const mockBody = {
        actions: [{
          value: JSON.stringify({
            serverId: 'jenkins',
            toolName: 'trigger_job'
          })
        }]
      };

      mockMCPRegistry.discoverServerTools.mockResolvedValue([
        {
          serverId: 'jenkins',
          name: 'trigger_job',
          description: 'Trigger a Jenkins job build',
          inputSchema: { jobName: 'string', parameters: 'object' }
        }
      ]);

      // Execute the help handler
      await helpHandler({
        ack: mockAck,
        body: mockBody,
        say: mockSay
      });

      // Assert
      expect(mockAck).toHaveBeenCalled();
      expect(mockSay).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('📖 *jenkins:trigger_job*')
        })
      );
    });
  });

  describe('Error Handling and Recovery', () => {
    it('should handle MCP registry unavailable gracefully', async () => {
      // Arrange
      const toolInvocationResponse: AIAgentResponse = {
        intent: 'tool_invocation',
        confidence: 0.9,
        tool: {
          serverId: 'github', // Use non-Jenkins service
          toolName: 'create_issue',
          parameters: { title: 'test', body: 'test' }
        },
        reasoning: 'User wants to create issue'
      };

      mockAIProcessor.processMessage.mockResolvedValue(toolInvocationResponse);

      // Create service without MCP registry
      const serviceWithoutRegistry = new SlackBotService(
        mockApp,
        mockAIProcessor,
        mockMCPClient,
        mockNotificationService
      );

      // Act
      await serviceWithoutRegistry['handleAppMention']({
        event: mockSlackEvent,
        client: mockClient,
        say: mockSay
      } as any);

      // Assert
      expect(mockSay).toHaveBeenCalledWith(
        expect.objectContaining({
          thread_ts: mockSlackEvent.ts,
          text: expect.stringContaining('MCP Registry is not available')
        })
      );
    });

    it('should handle tool execution timeouts gracefully', async () => {
      // Arrange
      const toolInvocationResponse: AIAgentResponse = {
        intent: 'tool_invocation',
        confidence: 0.9,
        tool: {
          serverId: 'database',
          toolName: 'execute_query',
          parameters: { query: 'SELECT * FROM users', database: 'production' }
        },
        reasoning: 'User wants to run database query'
      };

      mockAIProcessor.processMessage.mockResolvedValue(toolInvocationResponse);
      mockMCPRegistry.invokeToolSafely.mockRejectedValue(new Error('Request timeout'));

      // Act
      await slackBotService['handleAppMention']({
        event: mockSlackEvent,
        client: mockClient,
        say: mockSay
      } as any);

      // Assert
      expect(mockSay).toHaveBeenCalledWith(
        expect.objectContaining({
          thread_ts: mockSlackEvent.ts,
          text: expect.stringContaining('Failed to execute execute_query')
        })
      );
    });
  });

  describe('Response Formatting Edge Cases', () => {
    it('should handle very long data responses', () => {
      const longData = 'x'.repeat(2000);
      const result = slackBotService['formatToolData'](longData);
      expect(result).toHaveLength(503); // 500 chars + "..."
      expect(result).toMatch(/\.\.\.$/);
    });

    it('should handle malformed JSON in tool data', () => {
      const circularObject = { a: 1 };
      (circularObject as any).self = circularObject;
      
      const result = slackBotService['formatToolData'](circularObject);
      expect(result).toBe('_(Data formatting failed)_');
    });

    it('should handle null and undefined data', () => {
      expect(slackBotService['formatToolData'](null)).toBeNull();
      expect(slackBotService['formatToolData'](undefined)).toBeNull();
    });
  });

  describe('Service Initialization', () => {
    it('should initialize all handlers correctly', async () => {
      await slackBotService.initialize();

      expect(mockApp.event).toHaveBeenCalledWith('app_mention', expect.any(Function));
      expect(mockApp.error).toHaveBeenCalledWith(expect.any(Function));
      expect(mockApp.action).toHaveBeenCalledWith('retry_tool_execution', expect.any(Function));
      expect(mockApp.action).toHaveBeenCalledWith('tool_help', expect.any(Function));
    });
  });
});