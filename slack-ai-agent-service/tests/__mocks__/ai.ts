// Mock AI service responses for tests
import { AIAgentResponse } from '../../src/types/ai-agent';

export const mockAIResponse: AIAgentResponse = {
  intent: 'trigger_job',
  confidence: 0.95,
  parameters: {
    job_name: 'deploy-production',
    environment: 'production',
    branch: 'main'
  },
  response_text: 'I\'ll trigger the deploy-production job for you with the main branch in production environment.',
  tool_calls: [
    {
      tool_name: 'trigger_job',
      server_name: 'jenkins',
      arguments: {
        job_name: 'deploy-production',
        parameters: {
          ENVIRONMENT: 'production',
          BRANCH: 'main'
        }
      }
    }
  ]
};

export const mockAIErrorResponse: AIAgentResponse = {
  intent: 'error',
  confidence: 0.8,
  parameters: {},
  response_text: 'I couldn\'t understand your request. Please provide more details about what you\'d like me to do.',
  tool_calls: []
};

export const mockAIInfoResponse: AIAgentResponse = {
  intent: 'info_request',
  confidence: 0.9,
  parameters: {
    info_type: 'status'
  },
  response_text: 'I can help you check the status of Jenkins jobs. Which job would you like me to check?',
  tool_calls: [
    {
      tool_name: 'get_job_status',
      server_name: 'jenkins',
      arguments: {
        job_name: 'all'
      }
    }
  ]
};

// Mock Anthropic API client
export class MockAnthropicClient {
  private shouldFail: boolean = false;

  constructor(options?: { shouldFail?: boolean }) {
    this.shouldFail = options?.shouldFail || false;
  }

  async createMessage(params: any): Promise<any> {
    if (this.shouldFail) {
      throw new Error('Mock Anthropic API error');
    }

    // Parse the message to determine response type
    const userMessage = params.messages?.[params.messages.length - 1]?.content || '';
    
    if (userMessage.includes('status') || userMessage.includes('check')) {
      return {
        content: [{ text: JSON.stringify(mockAIInfoResponse) }],
        role: 'assistant',
        model: 'claude-3-sonnet-20240229'
      };
    }
    
    if (userMessage.includes('deploy') || userMessage.includes('trigger')) {
      return {
        content: [{ text: JSON.stringify(mockAIResponse) }],
        role: 'assistant', 
        model: 'claude-3-sonnet-20240229'
      };
    }

    return {
      content: [{ text: JSON.stringify(mockAIErrorResponse) }],
      role: 'assistant',
      model: 'claude-3-sonnet-20240229'
    };
  }

  setShouldFail(shouldFail: boolean) {
    this.shouldFail = shouldFail;
  }
}

// Mock AI processor class
export class MockAIProcessor {
  private client: MockAnthropicClient;

  constructor(shouldFail: boolean = false) {
    this.client = new MockAnthropicClient({ shouldFail });
  }

  async processMessage(
    message: string,
    context?: string,
    threadContext?: string[]
  ): Promise<AIAgentResponse> {
    try {
      const response = await this.client.createMessage({
        messages: [{ content: message, role: 'user' }],
        model: 'claude-3-sonnet-20240229',
        max_tokens: 1000
      });

      return JSON.parse(response.content[0].text);
    } catch (error) {
      return mockAIErrorResponse;
    }
  }

  setShouldFail(shouldFail: boolean) {
    this.client.setShouldFail(shouldFail);
  }
}

// Helper functions for creating test data
export function createMockAIResponse(
  intent: string = 'trigger_job',
  confidence: number = 0.95,
  overrides: Partial<AIAgentResponse> = {}
): AIAgentResponse {
  return {
    ...mockAIResponse,
    intent,
    confidence,
    ...overrides
  };
}

export function createMockToolCall(
  toolName: string = 'trigger_job',
  serverName: string = 'jenkins',
  args: any = {}
) {
  return {
    tool_name: toolName,
    server_name: serverName,
    arguments: args
  };
}