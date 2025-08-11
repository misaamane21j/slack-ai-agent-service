import { MCPClientWrapper } from '../../src/services/mcp-client-wrapper';
import { MCPServerConfig } from '../../src/types/mcp';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import * as securityModule from '../../src/config/security';

// Mock dependencies
jest.mock('@modelcontextprotocol/sdk/client/index.js');
jest.mock('@modelcontextprotocol/sdk/client/stdio.js');
jest.mock('../../src/config/security');
jest.mock('../../src/utils/logger', () => ({
  logger: () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  })
}));

const MockClient = Client as jest.MockedClass<typeof Client>;
const MockTransport = StdioClientTransport as jest.MockedClass<typeof StdioClientTransport>;
const mockValidateSpawnArguments = securityModule.validateSpawnArguments as jest.MockedFunction<typeof securityModule.validateSpawnArguments>;

describe('MCPClientWrapper', () => {
  let wrapper: MCPClientWrapper;
  let mockClient: jest.Mocked<Client>;
  let mockTransport: jest.Mocked<StdioClientTransport>;
  let serverConfig: MCPServerConfig;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Create server config
    serverConfig = {
      id: 'test-server',
      name: 'Test Server',
      description: 'A test MCP server',
      command: 'node',
      args: ['test-server.js'],
      env: { TEST_VAR: 'test-value' },
      enabled: true,
      timeout: 5000
    };

    // Setup mock client
    mockClient = {
      connect: jest.fn(),
      close: jest.fn(),
      listTools: jest.fn(),
      callTool: jest.fn()
    } as any;

    // Setup mock transport
    mockTransport = {
      close: jest.fn()
    } as any;

    // Setup constructor mocks
    MockClient.mockImplementation(() => mockClient);
    MockTransport.mockImplementation(() => mockTransport);
    mockValidateSpawnArguments.mockReturnValue(true);

    wrapper = new MCPClientWrapper(serverConfig);
  });

  describe('constructor', () => {
    it('should initialize with server config', () => {
      expect(wrapper.serverId).toBe('test-server');
      expect(wrapper.connected).toBe(false);
      expect(wrapper.availableTools).toEqual([]);
      expect(wrapper.lastErrorMessage).toBeNull();
    });

    it('should store server config', () => {
      const storedConfig = wrapper.serverConfig;
      expect(storedConfig).toEqual(serverConfig);
      expect(storedConfig).not.toBe(serverConfig); // Should be a copy
    });
  });

  describe('connect', () => {
    it('should connect successfully with valid configuration', async () => {
      mockClient.connect.mockResolvedValue(undefined);

      await wrapper.connect();

      expect(mockValidateSpawnArguments).toHaveBeenCalledWith('node', ['test-server.js']);
      expect(MockTransport).toHaveBeenCalledWith({
        command: 'node',
        args: ['test-server.js'],
        env: { TEST_VAR: 'test-value' }
      });
      expect(MockClient).toHaveBeenCalledWith(
        { name: 'slack-ai-agent-test-server', version: '1.0.0' },
        { capabilities: {} }
      );
      expect(mockClient.connect).toHaveBeenCalledWith(mockTransport);
      expect(wrapper.connected).toBe(true);
    });

    it('should reject invalid spawn arguments', async () => {
      mockValidateSpawnArguments.mockReturnValue(false);

      await expect(wrapper.connect()).rejects.toThrow(
        'Invalid spawn arguments for server test-server'
      );

      expect(wrapper.connected).toBe(false);
      expect(wrapper.lastErrorMessage).toContain('Invalid spawn arguments');
    });

    it('should handle connection timeout', async () => {
      const slowConnectPromise = new Promise<void>(resolve => setTimeout(resolve, 10000));
      mockClient.connect.mockReturnValue(slowConnectPromise);

      await expect(wrapper.connect()).rejects.toThrow('Connection timeout after 5000ms');

      expect(wrapper.connected).toBe(false);
      expect(wrapper.lastErrorMessage).toContain('Connection timeout');
    });

    it('should handle connection failure', async () => {
      const connectionError = new Error('Connection failed');
      mockClient.connect.mockRejectedValue(connectionError);

      await expect(wrapper.connect()).rejects.toThrow('Connection failed');

      expect(wrapper.connected).toBe(false);
      expect(wrapper.lastErrorMessage).toBe('Connection failed');
    });

    it('should reject if already connected', async () => {
      mockClient.connect.mockResolvedValue(undefined);
      await wrapper.connect();

      await expect(wrapper.connect()).rejects.toThrow(
        'MCP server test-server is already connected'
      );
    });

    it('should use default timeout if not specified', async () => {
      const configWithoutTimeout = { ...serverConfig };
      delete configWithoutTimeout.timeout;
      const wrapperNoTimeout = new MCPClientWrapper(configWithoutTimeout);

      mockClient.connect.mockResolvedValue(undefined);
      await wrapperNoTimeout.connect();

      expect(wrapperNoTimeout.connected).toBe(true);
    });
  });

  describe('discoverTools', () => {
    beforeEach(async () => {
      mockClient.connect.mockResolvedValue(undefined);
      await wrapper.connect();
    });

    it('should discover tools successfully', async () => {
      const mockTools = [
        {
          name: 'test-tool-1',
          description: 'First test tool',
          inputSchema: { type: 'object' as const, properties: { param1: { type: 'string' } } }
        },
        {
          name: 'test-tool-2',
          description: 'Second test tool',
          inputSchema: { type: 'object' as const }
        }
      ];

      mockClient.listTools.mockResolvedValue({ tools: mockTools });

      const tools = await wrapper.discoverTools();

      expect(mockClient.listTools).toHaveBeenCalled();
      expect(tools).toHaveLength(2);
      expect(tools[0]).toEqual({
        serverId: 'test-server',
        name: 'test-tool-1',
        description: 'First test tool',
        inputSchema: mockTools[0].inputSchema,
        outputSchema: undefined
      });
      expect(wrapper.availableTools).toEqual(tools);
    });

    it('should handle tools without descriptions', async () => {
      const mockTools = [
        {
          name: 'minimal-tool',
          inputSchema: { type: 'object' as const }
        }
      ];

      mockClient.listTools.mockResolvedValue({ tools: mockTools });

      const tools = await wrapper.discoverTools();

      expect(tools[0]).toEqual({
        serverId: 'test-server',
        name: 'minimal-tool',
        description: '',
        inputSchema: { type: 'object' },
        outputSchema: undefined
      });
    });

    it('should handle tools without inputSchema', async () => {
      const mockTools = [
        {
          name: 'schema-less-tool',
          description: 'Tool without schema',
          inputSchema: { type: 'object' as const }
        }
      ];

      mockClient.listTools.mockResolvedValue({ tools: mockTools });

      const tools = await wrapper.discoverTools();

      expect(tools[0].inputSchema).toEqual({ type: 'object' });
    });

    it('should reject if not connected', async () => {
      const notConnectedWrapper = new MCPClientWrapper(serverConfig);

      await expect(notConnectedWrapper.discoverTools()).rejects.toThrow(
        'MCP server test-server is not connected'
      );
    });

    it('should handle discovery failure', async () => {
      const discoveryError = new Error('Tool discovery failed');
      mockClient.listTools.mockRejectedValue(discoveryError);

      await expect(wrapper.discoverTools()).rejects.toThrow('Tool discovery failed');

      expect(wrapper.lastErrorMessage).toBe('Tool discovery failed');
    });
  });

  describe('invokeTool', () => {
    beforeEach(async () => {
      mockClient.connect.mockResolvedValue(undefined);
      await wrapper.connect();

      // Mock tool discovery
      const mockTools = [
        {
          name: 'test-tool',
          description: 'Test tool',
          inputSchema: { type: 'object' as const }
        }
      ];
      mockClient.listTools.mockResolvedValue({ tools: mockTools });
      await wrapper.discoverTools();
    });

    it('should invoke tool successfully', async () => {
      const mockResponse = {
        content: [{ type: 'text', text: 'Tool executed successfully' }]
      };
      mockClient.callTool.mockResolvedValue(mockResponse);

      const result = await wrapper.invokeTool('test-tool', { param1: 'value1' });

      expect(mockClient.callTool).toHaveBeenCalledWith({
        name: 'test-tool',
        arguments: { param1: 'value1' }
      });
      expect(result.success).toBe(true);
      expect(result.data).toBe(mockResponse.content);
      expect(result.executionTime).toBeGreaterThanOrEqual(0);
    });

    it('should reject if tool not found', async () => {
      const result = await wrapper.invokeTool('nonexistent-tool', {});

      expect(result.success).toBe(false);
      expect(result.error).toBe("Tool 'nonexistent-tool' not found on server test-server");
      expect(result.executionTime).toBeGreaterThanOrEqual(0);
    });

    it('should handle tool invocation failure', async () => {
      const toolError = new Error('Tool execution failed');
      mockClient.callTool.mockRejectedValue(toolError);

      const result = await wrapper.invokeTool('test-tool', {});

      expect(result.success).toBe(false);
      expect(result.error).toBe('Tool execution failed');
      expect(result.executionTime).toBeGreaterThanOrEqual(0);
      expect(wrapper.lastErrorMessage).toBe('Tool execution failed');
    });

    it('should reject if not connected', async () => {
      const notConnectedWrapper = new MCPClientWrapper(serverConfig);

      const result = await notConnectedWrapper.invokeTool('test-tool', {});

      expect(result.success).toBe(false);
      expect(result.error).toBe('MCP server test-server is not connected');
      expect(result.executionTime).toBeGreaterThanOrEqual(0);
    });
  });

  describe('disconnect', () => {
    beforeEach(async () => {
      mockClient.connect.mockResolvedValue(undefined);
      await wrapper.connect();
    });

    it('should disconnect successfully', async () => {
      mockClient.close.mockResolvedValue(undefined);
      mockTransport.close.mockResolvedValue(undefined);

      await wrapper.disconnect();

      expect(mockClient.close).toHaveBeenCalled();
      expect(mockTransport.close).toHaveBeenCalled();
      expect(wrapper.connected).toBe(false);
      expect(wrapper.availableTools).toEqual([]);
    });

    it('should handle disconnect errors gracefully', async () => {
      mockClient.close.mockRejectedValue(new Error('Close failed'));

      await wrapper.disconnect(); // Should not throw

      expect(wrapper.connected).toBe(false);
    });

    it('should be idempotent when already disconnected', async () => {
      await wrapper.disconnect();
      await wrapper.disconnect(); // Should not throw

      expect(wrapper.connected).toBe(false);
    });
  });

  describe('getters', () => {
    it('should return correct connection status', () => {
      expect(wrapper.connected).toBe(false);
    });

    it('should return server ID', () => {
      expect(wrapper.serverId).toBe('test-server');
    });

    it('should return empty tools initially', () => {
      expect(wrapper.availableTools).toEqual([]);
    });

    it('should return null for last error initially', () => {
      expect(wrapper.lastErrorMessage).toBeNull();
    });

    it('should return copy of server config', () => {
      const config = wrapper.serverConfig;
      expect(config).toEqual(serverConfig);
      expect(config).not.toBe(serverConfig);
    });
  });
});