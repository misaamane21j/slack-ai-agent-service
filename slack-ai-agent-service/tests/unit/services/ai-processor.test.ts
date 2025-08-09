import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { AIProcessorService } from '../../../src/services/ai-processor';
import { AIResponse } from '../../../src/types/ai';

// Mock dependencies
jest.mock('../../../src/config/environment');
jest.mock('../../../src/utils/logger');
jest.mock('openai');

describe('AIProcessorService', () => {
  let aiProcessor: AIProcessorService;
  let mockOpenAI: any;
  let mockLogger: any;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save and setup environment
    originalEnv = process.env;
    process.env = {
      SLACK_BOT_TOKEN: 'xoxb-test-token',
      SLACK_SIGNING_SECRET: 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0',
      SLACK_APP_TOKEN: 'xapp-test-token',
      OPENAI_API_KEY: 'sk-test-key',
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
        openaiApiKey: 'sk-test-key',
        model: 'gpt-4-turbo',
        confidenceThreshold: 0.8,
      },
    }));

    // Mock OpenAI
    mockOpenAI = {
      chat: {
        completions: {
          create: jest.fn(),
        },
      },
    };

    // Setup module mocks
    jest.doMock('../../../src/config/environment', () => ({
      getConfig: mockGetConfig,
    }));

    jest.doMock('../../../src/utils/logger', () => ({
      logger: () => mockLogger,
    }));

    jest.doMock('openai', () => {
      return {
        __esModule: true,
        default: jest.fn().mockImplementation(() => mockOpenAI),
      };
    });

    // Create service instance
    const AIProcessorServiceModule = require('../../../src/services/ai-processor');
    aiProcessor = new AIProcessorServiceModule.AIProcessorService();
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  describe('processMessage', () => {
    it('should successfully process valid AI response', async () => {
      // Arrange
      const validResponse: AIResponse = {
        jobName: 'deploy-app',
        parameters: { branch: 'main', environment: 'production' },
        confidence: 0.9,
      };

      mockOpenAI.chat.completions.create.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify(validResponse),
            },
          },
        ],
      });

      // Act
      const result = await aiProcessor.processMessage('Deploy the app to production', []);

      // Assert
      expect(result).toEqual(validResponse);
      expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith({
        model: 'gpt-4-turbo',
        messages: [
          {
            role: 'system',
            content: 'Extract Jenkins job parameters from user messages. Return structured JSON with jobName, parameters, and confidence score.',
          },
          {
            role: 'user',
            content: expect.stringContaining('Deploy the app to production'),
          },
        ],
        temperature: 0.1,
      });
    });

    it('should handle malformed JSON response with retry', async () => {
      // Arrange
      const malformedResponse = '{"jobName": "deploy", "confidence": 0.8'; // Invalid JSON
      const retryResponse: AIResponse = {
        jobName: 'deploy',
        parameters: {},
        confidence: 0.5,
      };

      mockOpenAI.chat.completions.create
        .mockResolvedValueOnce({
          choices: [{ message: { content: malformedResponse } }],
        })
        .mockResolvedValueOnce({
          choices: [{ message: { content: JSON.stringify(retryResponse) } }],
        });

      // Act
      const result = await aiProcessor.processMessage('Deploy now', []);

      // Assert
      expect(result).toEqual(retryResponse);
      expect(mockOpenAI.chat.completions.create).toHaveBeenCalledTimes(2);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Primary AI response parsing failed, attempting retry with simplified prompt'
      );
    });

    it('should validate AI response structure and reject invalid jobName', async () => {
      // Arrange
      const invalidResponse = {
        jobName: 'invalid job name!', // Contains invalid characters
        parameters: {},
        confidence: 0.8,
      };

      const fallbackResponse: AIResponse = {
        jobName: 'fallback-job',
        parameters: {},
        confidence: 0.5,
      };

      mockOpenAI.chat.completions.create
        .mockResolvedValueOnce({
          choices: [{ message: { content: JSON.stringify(invalidResponse) } }],
        })
        .mockResolvedValueOnce({
          choices: [{ message: { content: JSON.stringify(fallbackResponse) } }],
        });

      // Act
      const result = await aiProcessor.processMessage('Run job', []);

      // Assert
      expect(result).toEqual(fallbackResponse);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'AI response validation failed:',
        expect.objectContaining({
          errors: expect.stringContaining('jobName must contain only alphanumeric characters'),
        })
      );
    });

    it('should handle missing required fields in AI response', async () => {
      // Arrange
      const incompleteResponse = {
        jobName: 'test-job',
        // Missing confidence field
        parameters: {},
      };

      const fallbackResponse: AIResponse = {
        jobName: 'retry-job',
        parameters: {},
        confidence: 0.5,
      };

      mockOpenAI.chat.completions.create
        .mockResolvedValueOnce({
          choices: [{ message: { content: JSON.stringify(incompleteResponse) } }],
        })
        .mockResolvedValueOnce({
          choices: [{ message: { content: JSON.stringify(fallbackResponse) } }],
        });

      // Act
      const result = await aiProcessor.processMessage('Test', []);

      // Assert
      expect(result).toEqual(fallbackResponse);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'AI response validation failed:',
        expect.objectContaining({
          errors: expect.stringContaining('confidence is required'),
        })
      );
    });

    it('should handle confidence out of range', async () => {
      // Arrange
      const invalidResponse = {
        jobName: 'test-job',
        parameters: {},
        confidence: 1.5, // Out of range
      };

      const fallbackResponse: AIResponse = {
        jobName: 'fallback-job',
        parameters: {},
        confidence: 0.5,
      };

      mockOpenAI.chat.completions.create
        .mockResolvedValueOnce({
          choices: [{ message: { content: JSON.stringify(invalidResponse) } }],
        })
        .mockResolvedValueOnce({
          choices: [{ message: { content: JSON.stringify(fallbackResponse) } }],
        });

      // Act
      const result = await aiProcessor.processMessage('Test', []);

      // Assert
      expect(result).toEqual(fallbackResponse);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'AI response validation failed:',
        expect.objectContaining({
          errors: expect.stringContaining('confidence must be between 0 and 1'),
        })
      );
    });

    it('should return fallback response when both primary and retry fail', async () => {
      // Arrange
      mockOpenAI.chat.completions.create
        .mockResolvedValueOnce({
          choices: [{ message: { content: 'invalid json' } }],
        })
        .mockResolvedValueOnce({
          choices: [{ message: { content: 'also invalid' } }],
        });

      // Act
      const result = await aiProcessor.processMessage('Test message', []);

      // Assert
      expect(result).toEqual({
        jobName: 'unknown',
        parameters: {},
        confidence: 0.0,
      });
      expect(mockOpenAI.chat.completions.create).toHaveBeenCalledTimes(2);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Retry with simplified prompt also failed, using fallback response'
      );
    });

    it('should handle OpenAI API errors with fallback', async () => {
      // Arrange
      const apiError = new Error('API rate limit exceeded');
      const fallbackResponse: AIResponse = {
        jobName: 'fallback-job',
        parameters: {},
        confidence: 0.5,
      };

      mockOpenAI.chat.completions.create
        .mockRejectedValueOnce(apiError)
        .mockResolvedValueOnce({
          choices: [{ message: { content: JSON.stringify(fallbackResponse) } }],
        });

      // Act
      const result = await aiProcessor.processMessage('Deploy app', []);

      // Assert
      expect(result).toEqual(fallbackResponse);
      expect(mockLogger.error).toHaveBeenCalledWith('AI processing error:', apiError);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Attempting simplified prompt due to AI processing error'
      );
    });

    it('should handle no response content from AI', async () => {
      // Arrange
      mockOpenAI.chat.completions.create
        .mockResolvedValueOnce({
          choices: [{ message: { content: null } }],
        })
        .mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  jobName: 'retry-job',
                  parameters: {},
                  confidence: 0.5,
                }),
              },
            },
          ],
        });

      // Act
      const result = await aiProcessor.processMessage('Test', []);

      // Assert
      expect(result).toEqual({
        jobName: 'retry-job',
        parameters: {},
        confidence: 0.5,
      });
      expect(mockLogger.error).toHaveBeenCalledWith(
        'AI processing error:',
        expect.any(Error)
      );
    });

    it('should strip unknown fields from AI response', async () => {
      // Arrange
      const responseWithExtra = {
        jobName: 'test-job',
        parameters: { branch: 'main' },
        confidence: 0.8,
        extraField: 'should be removed', // Should be stripped
        anotherExtra: 123,
      };

      mockOpenAI.chat.completions.create.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify(responseWithExtra),
            },
          },
        ],
      });

      // Act
      const result = await aiProcessor.processMessage('Test', []);

      // Assert
      expect(result).toEqual({
        jobName: 'test-job',
        parameters: { branch: 'main' },
        confidence: 0.8,
      });
      expect(result).not.toHaveProperty('extraField');
      expect(result).not.toHaveProperty('anotherExtra');
    });

    it('should use simplified prompt with correct parameters on retry', async () => {
      // Arrange
      mockOpenAI.chat.completions.create
        .mockResolvedValueOnce({
          choices: [{ message: { content: 'invalid json' } }],
        })
        .mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  jobName: 'simple-job',
                  parameters: {},
                  confidence: 0.5,
                }),
              },
            },
          ],
        });

      // Act
      await aiProcessor.processMessage('Deploy to staging', []);

      // Assert
      expect(mockOpenAI.chat.completions.create).toHaveBeenNthCalledWith(2, {
        model: 'gpt-4-turbo',
        messages: [
          {
            role: 'system',
            content: 'You are a JSON extraction tool. Only return valid JSON, no explanations.',
          },
          {
            role: 'user',
            content: expect.stringContaining('Deploy to staging'),
          },
        ],
        temperature: 0.0,
        max_tokens: 200,
      });
    });
  });

  describe('getConfidenceThreshold', () => {
    it('should return configured confidence threshold', () => {
      // Act
      const threshold = aiProcessor.getConfidenceThreshold();

      // Assert
      expect(threshold).toBe(0.8);
    });
  });
});