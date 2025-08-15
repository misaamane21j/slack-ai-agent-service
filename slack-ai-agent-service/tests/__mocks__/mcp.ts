// Mock MCP client and server responses for tests
import { MCPToolResponse, MCPServer } from '../../src/types/mcp';

export const mockMCPToolResponse: MCPToolResponse = {
  content: [
    {
      type: 'text',
      text: JSON.stringify({
        success: true,
        jobUrl: 'https://jenkins.example.com/job/deploy/123/',
        jobId: 123,
        status: 'started',
        message: 'Deploy job started successfully'
      })
    }
  ],
  isError: false
};

export const mockMCPErrorResponse: MCPToolResponse = {
  content: [
    {
      type: 'text', 
      text: JSON.stringify({
        success: false,
        error: 'Job failed to start',
        details: 'Invalid parameters provided'
      })
    }
  ],
  isError: true
};

export const mockMCPServer: MCPServer = {
  name: 'jenkins',
  command: 'node',
  args: ['/path/to/jenkins-server.js'],
  env: {
    JENKINS_URL: 'https://jenkins.example.com',
    JENKINS_TOKEN: 'test_token'
  }
};

export const mockMCPServersConfig = {
  jenkins: mockMCPServer,
  'test-server': {
    name: 'test-server',
    command: 'node',
    args: ['/path/to/test-server.js'],
    env: {
      TEST_ENV: 'true'
    }
  }
};

// Mock MCP client process
export const mockMCPProcess = {
  pid: 12345,
  kill: jest.fn(),
  on: jest.fn(),
  stdout: {
    on: jest.fn(),
    pipe: jest.fn()
  },
  stderr: {
    on: jest.fn(),
    pipe: jest.fn()
  },
  stdin: {
    write: jest.fn(),
    end: jest.fn()
  }
};

// Mock MCP client class
export class MockMCPClient {
  private connected = false;
  private servers = new Map<string, any>();

  async connect(serverName: string): Promise<void> {
    this.connected = true;
    this.servers.set(serverName, mockMCPServer);
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.servers.clear();
  }

  async callTool(serverName: string, toolName: string, args: any): Promise<MCPToolResponse> {
    if (!this.connected) {
      throw new Error('MCP client not connected');
    }

    if (!this.servers.has(serverName)) {
      throw new Error(`Server ${serverName} not found`);
    }

    // Simulate different tool responses
    if (toolName === 'trigger_job' && args.job_name === 'failing-job') {
      return mockMCPErrorResponse;
    }

    return mockMCPToolResponse;
  }

  isConnected(): boolean {
    return this.connected;
  }

  getConnectedServers(): string[] {
    return Array.from(this.servers.keys());
  }
}

// Mock MCP registry responses
export const mockRegistryResponse = {
  tools: [
    {
      name: 'trigger_job',
      description: 'Triggers a Jenkins job',
      inputSchema: {
        type: 'object',
        properties: {
          job_name: { type: 'string' },
          parameters: { type: 'object' }
        },
        required: ['job_name']
      }
    }
  ],
  resources: [],
  prompts: []
};

// Helper functions for creating test data
export function createMockMCPResponse(
  success: boolean = true, 
  data: any = {}
): MCPToolResponse {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          success,
          ...data
        })
      }
    ],
    isError: !success
  };
}

export function createMockMCPServer(name: string, overrides: Partial<MCPServer> = {}): MCPServer {
  return {
    ...mockMCPServer,
    name,
    ...overrides
  };
}