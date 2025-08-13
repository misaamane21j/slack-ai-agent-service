import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { AIProcessorService } from '../../../src/services/ai-processor';
import { AIAgentResponse, ToolDefinition } from '../../../src/types/ai-agent';
import { MCPRegistryService } from '../../../src/services/mcp-registry';

// Mock dependencies
jest.mock('../../../src/config/environment');
jest.mock('../../../src/utils/logger');
jest.mock('@anthropic-ai/sdk');
jest.mock('../../../src/services/mcp-registry');

describe('AIProcessorService - Modern Refactor', () => {
  let aiProcessor: AIProcessorService;
  let mockAnthropic: any;
  let mockMCPRegistry: any;
  let mockLogger: any;
  let originalEnv: NodeJS.ProcessEnv;

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
    }
  ];

  beforeEach(async () => {
    // Save environment
    originalEnv = process.env;
    process.env = {
      SLACK_BOT_TOKEN: 'xoxb-test-token',
      SLACK_SIGNING_SECRET: 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0',
      ANTHROPIC_API_KEY: 'sk-ant-test-key',
      JENKINS_MCP_SERVER_PATH: '/path/to/jenkins.js',
    };

    // Reset modules
    jest.clearAllMocks();
    jest.resetModules();

    // Mock logger
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    // Mock getConfig
    const mockGetConfig = jest.fn(() => ({
      ai: {
        anthropicApiKey: 'sk-ant-test-key',
        model: 'claude-3-sonnet-20240229',
        confidenceThreshold: 0.8,
      },
    }));

    // Mock Anthropic
    mockAnthropic = {
      messages: {
        create: jest.fn(),
      },
    };

    // Mock MCP Registry - using simpler approach
    mockMCPRegistry = {
      initialize: jest.fn(),
      discoverAllTools: jest.fn(),
      invokeToolSafely: jest.fn(),
      destroy: jest.fn(),
      // Add other required methods as no-ops
      loadFromConfig: jest.fn(),
      connectToServer: jest.fn(),
      disconnectFromServer: jest.fn(),
      disconnectAll: jest.fn(),
      discoverServerTools: jest.fn(),
      getServerStatus: jest.fn(),
      getAllServerStatus: jest.fn(),
      getServer: jest.fn(),
      getAllServers: jest.fn(),
      getEnabledServers: jest.fn(),
      getCachedTools: jest.fn(),
    };
    
    // Setup default mock return values
    mockMCPRegistry.initialize.mockResolvedValue(undefined);
    mockMCPRegistry.discoverAllTools.mockResolvedValue(mockAvailableTools);
    mockMCPRegistry.invokeToolSafely.mockResolvedValue({ success: true });
    mockMCPRegistry.destroy.mockResolvedValue(undefined);

    // Setup module mocks
    jest.doMock('../../../src/config/environment', () => ({
      getConfig: mockGetConfig,
    }));

    jest.doMock('../../../src/utils/logger', () => ({
      logger: () => mockLogger,
    }));

    jest.doMock('@anthropic-ai/sdk', () => {
      return {
        __esModule: true,
        default: jest.fn().mockImplementation(() => mockAnthropic),
      };
    });

    jest.doMock('../../../src/services/mcp-registry', () => ({
      MCPRegistryService: jest.fn().mockImplementation(() => mockMCPRegistry),
    }));

    // Create service instance
    const AIProcessorServiceModule = require('../../../src/services/ai-processor');
    aiProcessor = new AIProcessorServiceModule.AIProcessorService(mockMCPRegistry);
    
    // Wait for registry initialization
    await new Promise(resolve => setTimeout(resolve, 10));
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  describe('processMessage - Modern AI Agent Response', () => {
    it('should successfully process tool invocation response', async () => {
      // Arrange
      const toolInvocationResponse: AIAgentResponse = {
        intent: 'tool_invocation',
        confidence: 0.9,
        tool: {
          serverId: 'jenkins',
          toolName: 'trigger_job',
          parameters: { jobName: 'deploy-app', branch: 'main' }
        },
        reasoning: 'User wants to trigger a Jenkins job for deployment'
      };

      mockAnthropic.messages.create.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify(toolInvocationResponse),
          },
        ],
      });

      // Act
      const result = await aiProcessor.processMessage('Deploy the app to production', []);

      // Assert
      expect(result).toEqual(toolInvocationResponse);
      expect(mockAnthropic.messages.create).toHaveBeenCalledWith({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 1500,
        temperature: 0.1,
        system: expect.stringContaining('AI assistant that processes user messages'),
        messages: [
          {
            role: 'user',
            content: expect.stringContaining('Deploy the app to production'),
          },
        ],
      });
    });

    it('should handle clarification needed response', async () => {
      // Arrange
      const clarificationResponse: AIAgentResponse = {
        intent: 'clarification_needed',
        confidence: 0.6,
        message: 'Could you please specify which environment you want to deploy to?',
        reasoning: 'User did not specify deployment environment'
      };

      mockAnthropic.messages.create.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify(clarificationResponse),
          },
        ],
      });

      // Act
      const result = await aiProcessor.processMessage('Deploy the app', []);

      // Assert
      expect(result).toEqual(clarificationResponse);
    });

    it('should handle general conversation response', async () => {
      // Arrange
      const conversationResponse: AIAgentResponse = {
        intent: 'general_conversation',
        confidence: 0.7,
        message: 'Hello! How can I help you with your deployment tasks today?',
        reasoning: 'User is greeting and asking for general help'
      };

      mockAnthropic.messages.create.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify(conversationResponse),
          },
        ],
      });

      // Act
      const result = await aiProcessor.processMessage('Hello there!', []);

      // Assert
      expect(result).toEqual(conversationResponse);
    });

    it('should validate tool exists and convert to clarification if not', async () => {
      // Arrange
      const invalidToolResponse: AIAgentResponse = {
        intent: 'tool_invocation',
        confidence: 0.8,
        tool: {
          serverId: 'nonexistent',
          toolName: 'nonexistent_tool',
          parameters: {}
        },
        reasoning: 'Selected non-existent tool'
      };

      mockAnthropic.messages.create.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify(invalidToolResponse),
          },
        ],
      });

      // Act
      const result = await aiProcessor.processMessage('Use invalid tool', []);

      // Assert
      expect(result.intent).toBe('clarification_needed');
      expect(result.message).toContain('nonexistent_tool');
      expect(result.message).toContain('not available');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'AI selected non-existent tool:',
        expect.objectContaining({
          serverId: 'nonexistent',
          toolName: 'nonexistent_tool'
        })
      );
    });

    it('should include available tools in prompt', async () => {
      // Arrange
      const response: AIAgentResponse = {
        intent: 'general_conversation',
        confidence: 0.5,
        message: 'I can help with that',
        reasoning: 'General response'
      };

      mockAnthropic.messages.create.mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify(response) }],
      });

      // Act
      await aiProcessor.processMessage('What can you do?', []);

      // Assert
      const callArgs = mockAnthropic.messages.create.mock.calls[0][0];
      const promptContent = callArgs.messages[0].content;
      expect(promptContent).toContain('Available Tools:');
      expect(promptContent).toContain('jenkins');
      expect(promptContent).toContain('trigger_job');
      expect(promptContent).toContain('github');
      expect(promptContent).toContain('create_issue');
    });

    it('should track conversation history', async () => {
      // Arrange
      const firstResponse: AIAgentResponse = {
        intent: 'general_conversation',
        confidence: 0.7,
        message: 'First response',
        reasoning: 'First message'
      };

      const secondResponse: AIAgentResponse = {
        intent: 'tool_invocation',
        confidence: 0.8,
        tool: { serverId: 'jenkins', toolName: 'trigger_job', parameters: {} },
        reasoning: 'Second message'
      };

      mockAnthropic.messages.create
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: JSON.stringify(firstResponse) }],
        })
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: JSON.stringify(secondResponse) }],
        });

      // Act
      await aiProcessor.processMessage('First message', []);
      await aiProcessor.processMessage('Second message', []);

      // Assert
      const secondCallArgs = mockAnthropic.messages.create.mock.calls[1][0];
      const secondPrompt = secondCallArgs.messages[0].content;
      expect(secondPrompt).toContain('Recent Conversation History:');
      expect(secondPrompt).toContain('First message');
    });

    it('should handle malformed JSON with retry fallback', async () => {
      // Arrange
      const malformedResponse = '{"intent": "tool_invocation", "confidence": 0.8'; // Invalid JSON
      const fallbackResponse: AIAgentResponse = {
        intent: 'general_conversation',
        confidence: 0.5,
        message: 'I need more information to help you.',
        reasoning: 'Retry response'
      };

      mockAnthropic.messages.create
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: malformedResponse }],
        })
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: JSON.stringify(fallbackResponse) }],
        });

      // Act
      const result = await aiProcessor.processMessage('Test message', []);

      // Assert
      expect(result).toEqual(fallbackResponse);
      expect(mockAnthropic.messages.create).toHaveBeenCalledTimes(2);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'AI agent response parsing failed, attempting fallback'
      );
    });

    it('should return fallback response when all processing fails', async () => {
      // Arrange
      mockAnthropic.messages.create
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: 'invalid json' }],
        })
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: 'also invalid' }],
        });

      // Act
      const result = await aiProcessor.processMessage('Test message', []);

      // Assert
      expect(result).toEqual({
        intent: 'general_conversation',
        confidence: 0.0,
        message: 'I apologize, but I encountered an error processing your request. Please try rephrasing your question or contact support.',
        reasoning: 'AI processing failed, fallback response used'
      });
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Retry with simplified prompt also failed, using fallback response'
      );
    });

    it('should validate AI agent response schema', async () => {
      // Arrange
      const invalidResponse = {
        intent: 'invalid_intent', // Invalid intent
        confidence: 1.5, // Out of range
        tool: {
          serverId: 'test',
          toolName: 'test'
          // Missing parameters
        }
      };

      const retryResponse: AIAgentResponse = {
        intent: 'general_conversation',
        confidence: 0.5,
        message: 'Fallback response',
        reasoning: 'Validation failed'
      };

      mockAnthropic.messages.create
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: JSON.stringify(invalidResponse) }],
        })
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: JSON.stringify(retryResponse) }],
        });

      // Act
      const result = await aiProcessor.processMessage('Test', []);

      // Assert
      expect(result).toEqual(retryResponse);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'AI agent response validation failed:',
        expect.objectContaining({
          errors: expect.stringContaining('intent must be one of')
        })
      );
    });
  });

  describe('Tool Management Methods', () => {
    it('should refresh available tools', async () => {
      // Arrange
      const newTools: ToolDefinition[] = [
        {
          serverId: 'database',
          name: 'run_query',
          description: 'Execute database query',
          inputSchema: { query: 'string' }
        }
      ];
      mockMCPRegistry.discoverAllTools.mockResolvedValue(newTools);

      // Act
      await aiProcessor.refreshTools();

      // Assert
      expect(mockMCPRegistry.discoverAllTools).toHaveBeenCalled();
      const availableTools = aiProcessor.getAvailableTools();
      expect(availableTools).toEqual(newTools);
    });

    it('should get tool by name and server', async () => {
      // Act
      const tool = aiProcessor.getToolByNameAndServer('jenkins', 'trigger_job');

      // Assert
      expect(tool).toEqual(mockAvailableTools[0]);
    });

    it('should execute tool invocation', async () => {
      // Arrange
      const expectedResult = { success: true, data: { buildNumber: 123 } };
      mockMCPRegistry.invokeToolSafely.mockResolvedValue(expectedResult);

      // Act
      const result = await aiProcessor.executeToolInvocation('jenkins', 'trigger_job', { jobName: 'test' });

      // Assert
      expect(result).toEqual(expectedResult);
      expect(mockMCPRegistry.invokeToolSafely).toHaveBeenCalledWith('jenkins', 'trigger_job', { jobName: 'test' });
    });

    it('should handle tool execution errors', async () => {
      // Arrange
      const error = new Error('Tool execution failed');
      mockMCPRegistry.invokeToolSafely.mockRejectedValue(error);

      // Act & Assert
      await expect(aiProcessor.executeToolInvocation('jenkins', 'trigger_job', {}))
        .rejects.toThrow('Tool execution failed');
      
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Tool execution failed:',
        expect.objectContaining({
          serverId: 'jenkins',
          toolName: 'trigger_job'
        })
      );
    });
  });

  describe('Legacy Compatibility', () => {
    it('should maintain legacy processMessageLegacy method', async () => {
      // Arrange
      const legacyResponse = {
        jobName: 'deploy-app',
        parameters: { branch: 'main' },
        confidence: 0.9
      };

      mockAnthropic.messages.create.mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify(legacyResponse) }],
      });

      // Act
      const result = await aiProcessor.processMessageLegacy('Deploy app', []);

      // Assert
      expect(result).toEqual(legacyResponse);
      expect(mockAnthropic.messages.create).toHaveBeenCalledWith({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 1000,
        temperature: 0.1,
        system: 'Extract Jenkins job parameters from user messages. Return structured JSON with jobName, parameters, and confidence score.',
        messages: [{
          role: 'user',
          content: expect.stringContaining('Deploy app')
        }]
      });
    });
  });

  describe('Cleanup', () => {
    it('should cleanup resources properly', async () => {
      // Act
      await aiProcessor.cleanup();

      // Assert
      expect(mockMCPRegistry.destroy).toHaveBeenCalled();
      expect(aiProcessor.getAvailableTools()).toEqual([]);
    });
  });

  describe('System Prompt Generation', () => {
    it('should generate comprehensive system prompt', async () => {
      // Arrange
      const response: AIAgentResponse = {
        intent: 'general_conversation',
        confidence: 0.5,
        message: 'Test response',
        reasoning: 'Test'
      };

      mockAnthropic.messages.create.mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify(response) }],
      });

      // Act
      await aiProcessor.processMessage('Test', []);

      // Assert
      const callArgs = mockAnthropic.messages.create.mock.calls[0][0];
      const systemPrompt = callArgs.system;
      
      expect(systemPrompt).toContain('AI assistant that processes user messages');
      expect(systemPrompt).toContain('Analyze user intent');
      expect(systemPrompt).toContain('tool_invocation');
      expect(systemPrompt).toContain('clarification_needed');
      expect(systemPrompt).toContain('general_conversation');
      expect(systemPrompt).toContain('Always return valid JSON only');
    });
  });
});