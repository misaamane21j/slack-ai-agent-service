import Anthropic from '@anthropic-ai/sdk';
import Joi from 'joi';
import { getConfig } from '../config/environment';
import { logger } from '../utils/logger';
import { AIResponse } from '../types/ai';
import { AIAgentResponse, ToolDefinition } from '../types/ai-agent';
import { MCPRegistryService } from './mcp-registry';

/**
 * Legacy Joi schema for validating Jenkins-specific AI response structure
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

/**
 * Modern Joi schema for validating AI agent response structure
 */
const aiAgentResponseSchema = Joi.object<AIAgentResponse>({
  intent: Joi.string()
    .valid('tool_invocation', 'clarification_needed', 'general_conversation')
    .required()
    .messages({
      'any.only': 'intent must be one of: tool_invocation, clarification_needed, general_conversation',
      'any.required': 'intent is required'
    }),
  confidence: Joi.number()
    .min(0)
    .max(1)
    .required()
    .messages({
      'number.min': 'confidence must be between 0 and 1',
      'number.max': 'confidence must be between 0 and 1',
      'any.required': 'confidence is required'
    }),
  tool: Joi.when('intent', {
    is: 'tool_invocation',
    then: Joi.object({
      serverId: Joi.string().required(),
      toolName: Joi.string().required(),
      parameters: Joi.object().unknown(true).default({})
    }).required(),
    otherwise: Joi.optional()
  }),
  message: Joi.string().optional(),
  reasoning: Joi.string().optional()
}).required();

export class AIProcessorService {
  private anthropic: Anthropic;
  private config: any;
  private mcpRegistry: MCPRegistryService;
  private availableTools: ToolDefinition[] = [];
  private conversationHistory: Array<{ message: string; timestamp: Date; intent?: string }> = [];

  constructor(mcpRegistry?: MCPRegistryService) {
    this.config = getConfig();
    this.anthropic = new Anthropic({
      apiKey: this.config.ai.anthropicApiKey,
    });
    this.mcpRegistry = mcpRegistry || new MCPRegistryService();
    this.initializeRegistry();
  }

  private async initializeRegistry(): Promise<void> {
    try {
      await this.mcpRegistry.initialize();
      await this.refreshAvailableTools();
    } catch (error) {
      logger().warn('Failed to initialize MCP registry', { error });
    }
  }

  private async refreshAvailableTools(): Promise<void> {
    try {
      this.availableTools = await this.mcpRegistry.discoverAllTools();
      logger().info(`Refreshed available tools: ${this.availableTools.length} tools found`);
    } catch (error) {
      logger().warn('Failed to refresh available tools', { error });
      this.availableTools = [];
    }
  }

  /**
   * Process a user message and determine the appropriate response or tool invocation
   */
  async processMessage(message: string, context: string[]): Promise<AIAgentResponse> {
    // Add to conversation history
    this.addToConversationHistory(message);

    try {
      // Refresh tools periodically to ensure we have the latest
      if (Math.random() < 0.1) { // 10% chance to refresh on each call
        await this.refreshAvailableTools();
      }

      const prompt = this.buildDynamicPrompt(message, context);
      
      const response = await this.anthropic.messages.create({
        model: this.config.ai.model,
        max_tokens: 1500,
        temperature: 0.1,
        system: this.buildSystemPrompt(),
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
        // Parse as modern AI agent response
        const aiAgentResponse = this.parseAIAgentResponse(content);
        this.addToConversationHistory(message, aiAgentResponse.intent);
        return aiAgentResponse;
      } catch (parseError) {
        logger().warn('AI agent response parsing failed, attempting fallback');
        
        try {
          // Attempt retry with simplified prompt
          return await this.retryWithSimplifiedPrompt(message);
        } catch (retryError) {
          logger().error('Retry with simplified prompt also failed, using fallback response');
          
          // Return safe fallback response
          return this.createFallbackResponse(
            retryError instanceof Error ? retryError : new Error(String(retryError))
          );
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
        return this.createFallbackResponse(
          error instanceof Error ? error : new Error(String(error))
        );
      }
    }
  }

  /**
   * Legacy method for backward compatibility
   */
  async processMessageLegacy(message: string, context: string[]): Promise<AIResponse> {
    try {
      const prompt = this.buildLegacyPrompt(message, context);
      
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
        // Use robust parsing and validation for legacy response
        return this.parseAIResponse(content);
      } catch (parseError) {
        logger().warn('Primary AI response parsing failed, attempting retry with simplified prompt');
        
        try {
          // Attempt retry with simplified prompt
          return await this.retryWithLegacySimplifiedPrompt(message);
        } catch (retryError) {
          logger().error('Retry with simplified prompt also failed, using fallback response');
          
          // Return safe fallback response
          return this.createLegacyFallbackResponse(retryError instanceof Error ? retryError : new Error(String(retryError)));
        }
      }
    } catch (error) {
      logger().error('AI processing error:', error);
      
      // For non-parsing errors (network, API limits, etc.), try fallback
      try {
        logger().info('Attempting simplified prompt due to AI processing error');
        return await this.retryWithLegacySimplifiedPrompt(message);
      } catch (retryError) {
        logger().error('All AI processing attempts failed, using fallback response');
        return this.createLegacyFallbackResponse(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  getConfidenceThreshold(): number {
    return this.config.ai.confidenceThreshold;
  }

  /**
   * Parse and validate modern AI agent response JSON
   */
  private parseAIAgentResponse(content: string): AIAgentResponse {
    try {
      // First, attempt to parse JSON
      const parsed = JSON.parse(content);
      
      // Validate against schema
      const { error, value } = aiAgentResponseSchema.validate(parsed, {
        abortEarly: false,
        stripUnknown: true,
      });

      if (error) {
        const validationErrors = error.details.map(detail => detail.message).join(', ');
        logger().warn('AI agent response validation failed:', {
          content,
          errors: validationErrors,
        });
        throw new Error(`Invalid AI agent response format: ${validationErrors}`);
      }

      // Additional validation for tool invocation
      if (value.intent === 'tool_invocation' && value.tool) {
        const toolExists = this.isValidTool(value.tool.serverId, value.tool.toolName);
        if (!toolExists) {
          logger().warn('AI selected non-existent tool:', {
            serverId: value.tool.serverId,
            toolName: value.tool.toolName,
            availableTools: this.availableTools.map(t => `${t.serverId}:${t.name}`)
          });
          // Convert to clarification needed if tool doesn't exist
          return {
            intent: 'clarification_needed',
            confidence: 0.5,
            message: `The requested tool '${value.tool.toolName}' from server '${value.tool.serverId}' is not available. Available tools: ${this.getAvailableToolsList()}`,
            reasoning: 'Selected tool does not exist'
          };
        }
      }

      return value;
    } catch (parseError) {
      if (parseError instanceof SyntaxError) {
        logger().warn('AI agent response JSON parsing failed:', {
          content,
          error: parseError.message,
        });
        throw new Error(`Malformed JSON response from AI: ${parseError.message}`);
      }
      throw parseError;
    }
  }

  /**
   * Parse and validate legacy AI response JSON with robust error handling
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
   * Create a safe modern fallback response when AI processing fails
   */
  private createFallbackResponse(originalError: Error): AIAgentResponse {
    logger().warn('Creating fallback AI agent response due to error:', originalError.message);
    
    return {
      intent: 'general_conversation',
      confidence: 0.0,
      message: 'I apologize, but I encountered an error processing your request. Please try rephrasing your question or contact support.',
      reasoning: 'AI processing failed, fallback response used'
    };
  }

  /**
   * Create a safe legacy fallback response when AI processing fails
   */
  private createLegacyFallbackResponse(originalError: Error): AIResponse {
    logger().warn('Creating fallback AI response due to error:', originalError.message);
    
    return {
      jobName: 'unknown',
      parameters: {},
      confidence: 0.0
    };
  }

  /**
   * Attempt to retry AI processing with a simplified modern prompt
   */
  private async retryWithSimplifiedPrompt(message: string): Promise<AIAgentResponse> {
    logger().info('Retrying AI agent processing with simplified prompt');
    
    try {
      const simplifiedPrompt = `
Analyze this message and return JSON format:
{"intent": "general_conversation", "confidence": 0.5, "message": "I need more information to help you."}

Message: ${message}
      `.trim();

      const response = await this.anthropic.messages.create({
        model: this.config.ai.model,
        max_tokens: 300,
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

      return this.parseAIAgentResponse(content);
    } catch (retryError) {
      logger().error('Simplified retry also failed:', retryError);
      throw retryError;
    }
  }

  /**
   * Attempt to retry AI processing with a simplified legacy prompt
   */
  private async retryWithLegacySimplifiedPrompt(message: string): Promise<AIResponse> {
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

  /**
   * Build dynamic prompt with available tools information
   */
  private buildDynamicPrompt(message: string, context: string[]): string {
    const availableToolsInfo = this.formatAvailableTools();
    const recentHistory = this.getRecentConversationHistory(3);
    
    return `
User Message: ${message}
Context: ${context.join('\n')}

Recent Conversation History:
${recentHistory}

Available Tools:
${availableToolsInfo}

Analyze the user's message and determine:
1. Intent: Does the user want to use a tool, need clarification, or have a general conversation?
2. Tool Selection: If tool_invocation, which specific tool and server is most appropriate?
3. Parameters: What parameters should be passed to the tool?
4. Confidence: How confident are you in this assessment (0-1)?

Return JSON response matching the schema with intent, confidence, tool (if applicable), message, and reasoning.
    `.trim();
  }

  /**
   * Build legacy prompt for backward compatibility
   */
  private buildLegacyPrompt(message: string, context: string[]): string {
    return `
Message: ${message}
Context: ${context.join('\n')}

Extract Jenkins job information and return JSON with:
- jobName: string
- parameters: object
- confidence: number (0-1)
    `.trim();
  }

  /**
   * Build comprehensive system prompt
   */
  private buildSystemPrompt(): string {
    return `You are an AI assistant that processes user messages and determines the appropriate response or tool invocation.

Your responsibilities:
1. Analyze user intent to determine if they want to use a tool, need clarification, or have a general conversation
2. Select the most appropriate tool from available options
3. Extract relevant parameters for tool execution
4. Provide clear reasoning for your decisions

Response format:
- For tool invocation: {"intent": "tool_invocation", "confidence": 0.8, "tool": {"serverId": "server", "toolName": "tool", "parameters": {}}, "reasoning": "explanation"}
- For clarification: {"intent": "clarification_needed", "confidence": 0.6, "message": "What would you like me to help with?", "reasoning": "explanation"}
- For conversation: {"intent": "general_conversation", "confidence": 0.7, "message": "response", "reasoning": "explanation"}

Always return valid JSON only.`;
  }

  /**
   * Tool capability matching and validation methods
   */
  private isValidTool(serverId: string, toolName: string): boolean {
    return this.availableTools.some(tool => 
      tool.serverId === serverId && tool.name === toolName
    );
  }

  private findBestMatchingTool(userIntent: string): ToolDefinition | null {
    if (this.availableTools.length === 0) {
      return null;
    }

    // Simple keyword-based matching (can be enhanced with more sophisticated algorithms)
    const keywords = userIntent.toLowerCase().split(/\s+/);
    
    let bestMatch: ToolDefinition | null = null;
    let bestScore = 0;

    for (const tool of this.availableTools) {
      let score = 0;
      const toolDescription = tool.description.toLowerCase();
      const toolName = tool.name.toLowerCase();
      
      // Check for keyword matches in tool name and description
      keywords.forEach(keyword => {
        if (toolName.includes(keyword)) score += 3;
        if (toolDescription.includes(keyword)) score += 1;
      });

      if (score > bestScore) {
        bestScore = score;
        bestMatch = tool;
      }
    }

    // Return only if we have a reasonable match
    return bestScore >= 2 ? bestMatch : null;
  }

  private formatAvailableTools(): string {
    if (this.availableTools.length === 0) {
      return 'No tools are currently available.';
    }

    return this.availableTools
      .map(tool => `- Server: ${tool.serverId}, Tool: ${tool.name} - ${tool.description}`)
      .join('\n');
  }

  private getAvailableToolsList(): string {
    return this.availableTools
      .map(tool => `${tool.serverId}:${tool.name}`)
      .join(', ');
  }

  /**
   * Conversation history management
   */
  private addToConversationHistory(message: string, intent?: string): void {
    this.conversationHistory.push({
      message,
      timestamp: new Date(),
      intent
    });

    // Keep only last 10 messages
    if (this.conversationHistory.length > 10) {
      this.conversationHistory = this.conversationHistory.slice(-10);
    }
  }

  private getRecentConversationHistory(count: number = 3): string {
    const recent = this.conversationHistory.slice(-count);
    if (recent.length === 0) {
      return 'No previous conversation.';
    }

    return recent
      .map(entry => `[${entry.timestamp.toISOString()}] ${entry.intent ? `(${entry.intent}) ` : ''}${entry.message}`)
      .join('\n');
  }

  /**
   * Public methods for integration
   */
  async refreshTools(): Promise<void> {
    await this.refreshAvailableTools();
  }

  getAvailableTools(): ToolDefinition[] {
    return [...this.availableTools];
  }

  getToolByNameAndServer(serverId: string, toolName: string): ToolDefinition | undefined {
    return this.availableTools.find(tool => 
      tool.serverId === serverId && tool.name === toolName
    );
  }

  /**
   * Execute tool invocation through MCP registry
   */
  async executeToolInvocation(serverId: string, toolName: string, parameters: any) {
    try {
      return await this.mcpRegistry.invokeToolSafely(serverId, toolName, parameters);
    } catch (error) {
      logger().error('Tool execution failed:', { serverId, toolName, parameters, error });
      throw error;
    }
  }

  /**
   * Cleanup method
   */
  async cleanup(): Promise<void> {
    await this.mcpRegistry.destroy();
    this.availableTools = [];
    this.conversationHistory = [];
  }
}