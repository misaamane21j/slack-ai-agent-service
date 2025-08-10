import Anthropic from '@anthropic-ai/sdk';
import Joi from 'joi';
import { getConfig } from '../config/environment';
import { logger } from '../utils/logger';
import { AIResponse } from '../types/ai';

/**
 * Joi schema for validating AI response structure
 */
const aiResponseSchema = Joi.object<AIResponse>({
  jobName: Joi.string()
    .min(1)
    .max(100)
    .pattern(/^[a-zA-Z0-9_-]+$/)
    .required()
    .messages({
      'string.pattern.base': 'jobName must contain only alphanumeric characters, hyphens, and underscores',
      'string.min': 'jobName must not be empty',
      'string.max': 'jobName must not exceed 100 characters',
      'any.required': 'jobName is required'
    }),
  parameters: Joi.object()
    .unknown(true)
    .default({})
    .messages({
      'object.base': 'parameters must be an object'
    }),
  confidence: Joi.number()
    .min(0)
    .max(1)
    .required()
    .messages({
      'number.min': 'confidence must be between 0 and 1',
      'number.max': 'confidence must be between 0 and 1',
      'any.required': 'confidence is required'
    })
}).required();

export class AIProcessorService {
  private anthropic: Anthropic;
  private config: any;

  constructor() {
    this.config = getConfig();
    this.anthropic = new Anthropic({
      apiKey: this.config.ai.anthropicApiKey,
    });
  }

  async processMessage(message: string, context: string[]): Promise<AIResponse> {
    try {
      const prompt = this.buildPrompt(message, context);
      
      const response = await this.anthropic.messages.create({
        model: this.config.ai.model,
        max_tokens: 1000,
        temperature: 0.1,
        system: 'Extract Jenkins job parameters from user messages. Return structured JSON with jobName, parameters, and confidence score.',
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      });

      const content = response.content[0]?.type === 'text' ? response.content[0].text : null;
      if (!content) {
        throw new Error('No response from AI model');
      }

      try {
        // Use robust parsing and validation
        return this.parseAIResponse(content);
      } catch (parseError) {
        logger().warn('Primary AI response parsing failed, attempting retry with simplified prompt');
        
        try {
          // Attempt retry with simplified prompt
          return await this.retryWithSimplifiedPrompt(message);
        } catch (retryError) {
          logger().error('Retry with simplified prompt also failed, using fallback response');
          
          // Return safe fallback response
          return this.createFallbackResponse(retryError instanceof Error ? retryError : new Error(String(retryError)));
        }
      }
    } catch (error) {
      logger().error('AI processing error:', error);
      
      // For non-parsing errors (network, API limits, etc.), try fallback
      try {
        logger().info('Attempting simplified prompt due to AI processing error');
        return await this.retryWithSimplifiedPrompt(message);
      } catch (retryError) {
        logger().error('All AI processing attempts failed, using fallback response');
        return this.createFallbackResponse(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  getConfidenceThreshold(): number {
    return this.config.ai.confidenceThreshold;
  }

  /**
   * Parse and validate AI response JSON with robust error handling
   */
  private parseAIResponse(content: string): AIResponse {
    try {
      // First, attempt to parse JSON
      const parsed = JSON.parse(content);
      
      // Validate against schema
      const { error, value } = aiResponseSchema.validate(parsed, {
        abortEarly: false,
        stripUnknown: true,
      });

      if (error) {
        const validationErrors = error.details.map(detail => detail.message).join(', ');
        logger().warn('AI response validation failed:', {
          content,
          errors: validationErrors,
        });
        throw new Error(`Invalid AI response format: ${validationErrors}`);
      }

      return value;
    } catch (parseError) {
      if (parseError instanceof SyntaxError) {
        logger().warn('AI response JSON parsing failed:', {
          content,
          error: parseError.message,
        });
        throw new Error(`Malformed JSON response from AI: ${parseError.message}`);
      }
      throw parseError;
    }
  }

  /**
   * Create a safe fallback response when AI processing fails
   */
  private createFallbackResponse(originalError: Error): AIResponse {
    logger().warn('Creating fallback AI response due to error:', originalError.message);
    
    return {
      jobName: 'unknown',
      parameters: {},
      confidence: 0.0
    };
  }

  /**
   * Attempt to retry AI processing with a simplified prompt
   */
  private async retryWithSimplifiedPrompt(message: string): Promise<AIResponse> {
    logger().info('Retrying AI processing with simplified prompt');
    
    try {
      const simplifiedPrompt = `
Extract Jenkins job name from this message. Return only JSON format:
{"jobName": "job-name", "parameters": {}, "confidence": 0.5}

Message: ${message}
      `.trim();

      const response = await this.anthropic.messages.create({
        model: this.config.ai.model,
        max_tokens: 200,
        temperature: 0.0,
        system: 'You are a JSON extraction tool. Only return valid JSON, no explanations.',
        messages: [
          {
            role: 'user',
            content: simplifiedPrompt,
          },
        ],
      });

      const content = response.content[0]?.type === 'text' ? response.content[0].text : null;
      if (!content) {
        throw new Error('No response from AI model on retry');
      }

      return this.parseAIResponse(content);
    } catch (retryError) {
      logger().error('Simplified retry also failed:', retryError);
      throw retryError;
    }
  }

  private buildPrompt(message: string, context: string[]): string {
    return `
Message: ${message}
Context: ${context.join('\n')}

Extract Jenkins job information and return JSON with:
- jobName: string
- parameters: object
- confidence: number (0-1)
    `.trim();
  }
}