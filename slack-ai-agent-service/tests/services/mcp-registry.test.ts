import fs from 'fs/promises';
import path from 'path';
import { MCPRegistryService } from '../../src/services/mcp-registry';
import { MCPClientWrapper } from '../../src/services/mcp-client-wrapper';
import { MCPServerConfig } from '../../src/types/mcp';
import * as environmentModule from '../../src/config/environment';

// Mock dependencies
jest.mock('fs/promises');
jest.mock('../../src/services/mcp-client-wrapper');
jest.mock('../../src/config/environment');
jest.mock('../../src/utils/logger', () => ({
  logger: () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  })
}));

const mockFs = fs as jest.Mocked<typeof fs>;
const MockMCPClientWrapper = MCPClientWrapper as jest.MockedClass<typeof MCPClientWrapper>;
const mockGetConfig = environmentModule.getConfig as jest.MockedFunction<typeof environmentModule.getConfig>;

describe('MCPRegistryService', () => {
  let registry: MCPRegistryService;
  let mockClient: jest.Mocked<MCPClientWrapper>;

  const mockServerConfig: MCPServerConfig = {
    id: 'test-server',
    name: 'Test Server',
    description: 'A test MCP server',
    command: 'node',
    args: ['test-server.js'],
    env: { TEST_VAR: 'test-value' },
    enabled: true,
    timeout: 5000
  };

  const mockMcpConfig = {
    servers: {
      'test-server': mockServerConfig,
      'disabled-server': {
        ...mockServerConfig,
        id: 'disabled-server',
        name: 'Disabled Server',
        enabled: false
      }
    }
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mock client
    mockClient = {
      connect: jest.fn(),
      disconnect: jest.fn(),
      discoverTools: jest.fn(),
      invokeTool: jest.fn(),
      connected: false,
      serverId: 'test-server',
      availableTools: [],
      lastErrorMessage: null,
      serverConfig: mockServerConfig
    } as any;

    MockMCPClientWrapper.mockImplementation(() => mockClient);

    // Setup environment config mock
    mockGetConfig.mockReturnValue({
      mcp: { configFile: './test-mcp-servers.json' }
    } as any);

    registry = new MCPRegistryService();
  });

  describe('initialize', () => {
    it('should initialize successfully with valid config', async () => {
      mockFs.readFile.mockResolvedValue(JSON.stringify(mockMcpConfig));

      await registry.initialize();

      expect(mockFs.readFile).toHaveBeenCalledWith(
        path.resolve('./test-mcp-servers.json'),
        'utf-8'
      );
      expect(registry.getAllServers()).toHaveLength(2);
      expect(registry.getEnabledServers()).toHaveLength(1);
    });

    it('should be idempotent', async () => {
      mockFs.readFile.mockResolvedValue(JSON.stringify(mockMcpConfig));

      await registry.initialize();
      await registry.initialize(); // Second call should not reload

      expect(mockFs.readFile).toHaveBeenCalledTimes(1);
    });

    it('should handle missing config file', async () => {
      mockFs.readFile.mockRejectedValue(new Error('File not found'));

      await expect(registry.initialize()).rejects.toThrow('Failed to load MCP configuration');
    });

    it('should handle invalid JSON', async () => {
      mockFs.readFile.mockResolvedValue('invalid json');

      await expect(registry.initialize()).rejects.toThrow('Failed to load MCP configuration');
    });
  });

  describe('loadFromConfig', () => {
    it('should load valid server configurations', async () => {
      mockFs.readFile.mockResolvedValue(JSON.stringify(mockMcpConfig));

      await registry.loadFromConfig('./test-config.json');

      const servers = registry.getAllServers();
      expect(servers).toHaveLength(2);
      expect(servers[0].id).toBe('test-server');
      expect(servers[0].enabled).toBe(true);
    });

    it('should process environment variables', async () => {
      const configWithEnvVars = {
        servers: {
          'env-server': {
            ...mockServerConfig,
            id: 'env-server',
            env: {
              API_KEY: '${TEST_API_KEY}',
              STATIC_VAR: 'static-value'
            }
          }
        }
      };

      process.env.TEST_API_KEY = 'secret-key';
      mockFs.readFile.mockResolvedValue(JSON.stringify(configWithEnvVars));

      await registry.loadFromConfig('./test-config.json');

      const server = registry.getServer('env-server');
      expect(server?.env?.API_KEY).toBe('secret-key');
      expect(server?.env?.STATIC_VAR).toBe('static-value');
    });

    it('should handle missing environment variables', async () => {
      const configWithMissingEnv = {
        servers: {
          'missing-env-server': {
            ...mockServerConfig,
            id: 'missing-env-server',
            env: {
              MISSING_VAR: '${NONEXISTENT_VAR}'
            }
          }
        }
      };

      mockFs.readFile.mockResolvedValue(JSON.stringify(configWithMissingEnv));

      await registry.loadFromConfig('./test-config.json');

      const server = registry.getServer('missing-env-server');
      expect(server?.env?.MISSING_VAR).toBe('');
    });

    it('should skip invalid server configurations', async () => {
      const configWithInvalidServer = {
        servers: {
          'test-server': mockServerConfig,
          'invalid-server': {
            id: 'invalid-server',
            // Missing required fields
          }
        }
      };

      mockFs.readFile.mockResolvedValue(JSON.stringify(configWithInvalidServer));

      await registry.loadFromConfig('./test-config.json');

      const servers = registry.getAllServers();
      expect(servers).toHaveLength(1);
      expect(servers[0].id).toBe('test-server');
    });

    it('should clear existing servers before loading', async () => {
      // First load
      mockFs.readFile.mockResolvedValue(JSON.stringify(mockMcpConfig));
      await registry.loadFromConfig('./test-config.json');
      expect(registry.getAllServers()).toHaveLength(2);

      // Second load with different config
      const newConfig = {
        servers: {
          'new-server': { ...mockServerConfig, id: 'new-server' }
        }
      };
      mockFs.readFile.mockResolvedValue(JSON.stringify(newConfig));
      await registry.loadFromConfig('./test-config.json');

      expect(registry.getAllServers()).toHaveLength(1);
      expect(registry.getAllServers()[0].id).toBe('new-server');
    });
  });

  describe('connectToServer', () => {
    beforeEach(async () => {
      mockFs.readFile.mockResolvedValue(JSON.stringify(mockMcpConfig));
      await registry.initialize();
    });

    it('should connect to enabled server successfully', async () => {
      mockClient.connect.mockResolvedValue(undefined);
      Object.defineProperty(mockClient, 'connected', { value: true });

      await registry.connectToServer('test-server');

      expect(MockMCPClientWrapper).toHaveBeenCalledWith(mockServerConfig);
      expect(mockClient.connect).toHaveBeenCalled();

      const status = registry.getServerStatus('test-server');
      expect(status?.connected).toBe(true);
      expect(status?.lastConnected).toBeInstanceOf(Date);
    });

    it('should reject connection to non-existent server', async () => {
      await expect(registry.connectToServer('nonexistent')).rejects.toThrow(
        'Server not found: nonexistent'
      );
    });

    it('should reject connection to disabled server', async () => {
      await expect(registry.connectToServer('disabled-server')).rejects.toThrow(
        'Server is disabled: disabled-server'
      );
    });

    it('should handle connection failure', async () => {
      const connectionError = new Error('Connection failed');
      mockClient.connect.mockRejectedValue(connectionError);

      await expect(registry.connectToServer('test-server')).rejects.toThrow('Connection failed');

      const status = registry.getServerStatus('test-server');
      expect(status?.connected).toBe(false);
      expect(status?.lastError).toBe('Connection failed');
    });

    it('should skip if already connected', async () => {
      // First connection
      mockClient.connect.mockResolvedValue(undefined);
      Object.defineProperty(mockClient, 'connected', { value: true });
      await registry.connectToServer('test-server');

      // Second connection attempt
      mockClient.connect.mockClear();
      await registry.connectToServer('test-server');

      expect(mockClient.connect).not.toHaveBeenCalled();
    });
  });

  describe('disconnectFromServer', () => {
    beforeEach(async () => {
      mockFs.readFile.mockResolvedValue(JSON.stringify(mockMcpConfig));
      await registry.initialize();
      
      mockClient.connect.mockResolvedValue(undefined);
      Object.defineProperty(mockClient, 'connected', { value: true });
      await registry.connectToServer('test-server');
    });

    it('should disconnect successfully', async () => {
      mockClient.disconnect.mockResolvedValue(undefined);

      await registry.disconnectFromServer('test-server');

      expect(mockClient.disconnect).toHaveBeenCalled();

      const status = registry.getServerStatus('test-server');
      expect(status?.connected).toBe(false);
      expect(status?.toolCount).toBe(0);
    });

    it('should handle disconnect errors gracefully', async () => {
      mockClient.disconnect.mockRejectedValue(new Error('Disconnect failed'));

      await registry.disconnectFromServer('test-server'); // Should not throw
    });

    it('should be idempotent for non-connected servers', async () => {
      await registry.disconnectFromServer('nonexistent-server'); // Should not throw
    });
  });

  describe('discoverAllTools', () => {
    beforeEach(async () => {
      mockFs.readFile.mockResolvedValue(JSON.stringify(mockMcpConfig));
      await registry.initialize();
    });

    it('should discover tools from all enabled servers', async () => {
      const mockTools = [
        {
          serverId: 'test-server',
          name: 'test-tool',
          description: 'Test tool',
          inputSchema: {}
        }
      ];

      mockClient.connect.mockResolvedValue(undefined);
      mockClient.discoverTools.mockResolvedValue(mockTools);

      const allTools = await registry.discoverAllTools();

      expect(allTools).toEqual(mockTools);
      expect(mockClient.connect).toHaveBeenCalledTimes(1); // Only enabled servers
    });

    it('should handle tool discovery failures gracefully', async () => {
      mockClient.connect.mockRejectedValue(new Error('Connection failed'));

      const allTools = await registry.discoverAllTools();

      expect(allTools).toEqual([]);
    });

    it('should aggregate tools from multiple servers', async () => {
      // Add another enabled server
      const multiServerConfig = {
        servers: {
          ...mockMcpConfig.servers,
          'server2': {
            ...mockServerConfig,
            id: 'server2',
            name: 'Server 2'
          }
        }
      };

      mockFs.readFile.mockResolvedValue(JSON.stringify(multiServerConfig));
      await registry.loadFromConfig('./test-config.json');

      const tools1 = [{ serverId: 'test-server', name: 'tool1', description: '', inputSchema: {} }];
      const tools2 = [{ serverId: 'server2', name: 'tool2', description: '', inputSchema: {} }];

      mockClient.connect.mockResolvedValue(undefined);
      mockClient.discoverTools
        .mockResolvedValueOnce(tools1)
        .mockResolvedValueOnce(tools2);

      const allTools = await registry.discoverAllTools();

      expect(allTools).toHaveLength(2);
      expect(allTools).toEqual([...tools1, ...tools2]);
    });
  });

  describe('discoverServerTools', () => {
    beforeEach(async () => {
      mockFs.readFile.mockResolvedValue(JSON.stringify(mockMcpConfig));
      await registry.initialize();
    });

    it('should discover and cache tools', async () => {
      const mockTools = [
        {
          serverId: 'test-server',
          name: 'test-tool',
          description: 'Test tool',
          inputSchema: {}
        }
      ];

      mockClient.connect.mockResolvedValue(undefined);
      mockClient.discoverTools.mockResolvedValue(mockTools);

      // First call
      const tools1 = await registry.discoverServerTools('test-server');
      expect(tools1).toEqual(mockTools);

      // Second call should return cached results
      mockClient.discoverTools.mockClear();
      const tools2 = await registry.discoverServerTools('test-server');
      expect(tools2).toEqual(mockTools);
      expect(mockClient.discoverTools).not.toHaveBeenCalled();
    });

    it('should update server status with tool count', async () => {
      const mockTools = [
        { serverId: 'test-server', name: 'tool1', description: '', inputSchema: {} },
        { serverId: 'test-server', name: 'tool2', description: '', inputSchema: {} }
      ];

      mockClient.connect.mockResolvedValue(undefined);
      mockClient.discoverTools.mockResolvedValue(mockTools);

      await registry.discoverServerTools('test-server');

      const status = registry.getServerStatus('test-server');
      expect(status?.toolCount).toBe(2);
    });
  });

  describe('invokeToolSafely', () => {
    beforeEach(async () => {
      mockFs.readFile.mockResolvedValue(JSON.stringify(mockMcpConfig));
      await registry.initialize();
    });

    it('should invoke tool successfully', async () => {
      const mockResult = {
        success: true,
        data: 'Tool result',
        executionTime: 100
      };

      mockClient.connect.mockResolvedValue(undefined);
      mockClient.discoverTools.mockResolvedValue([]);
      mockClient.invokeTool.mockResolvedValue(mockResult);

      const result = await registry.invokeToolSafely('test-server', 'test-tool', { param: 'value' });

      expect(result).toEqual(mockResult);
      expect(mockClient.invokeTool).toHaveBeenCalledWith('test-tool', { param: 'value' });
    });

    it('should handle missing client gracefully', async () => {
      // Don't connect to server - mock connection failure
      mockClient.connect.mockRejectedValue(new Error('Connection failed'));

      const result = await registry.invokeToolSafely('test-server', 'test-tool', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('Connection failed');
    });

    it('should handle tool invocation errors', async () => {
      mockClient.connect.mockResolvedValue(undefined);
      mockClient.discoverTools.mockResolvedValue([]);
      mockClient.invokeTool.mockRejectedValue(new Error('Tool failed'));

      const result = await registry.invokeToolSafely('test-server', 'test-tool', {});

      expect(result.success).toBe(false);
      expect(result.error).toBe('Tool failed');
    });
  });

  describe('status and monitoring', () => {
    beforeEach(async () => {
      mockFs.readFile.mockResolvedValue(JSON.stringify(mockMcpConfig));
      await registry.initialize();
    });

    it('should return server status', () => {
      const status = registry.getServerStatus('test-server');
      expect(status).toBeDefined();
      expect(status?.serverId).toBe('test-server');
      expect(status?.connected).toBe(false);
    });

    it('should return all server statuses', () => {
      const allStatus = registry.getAllServerStatus();
      expect(allStatus).toHaveLength(2);
      expect(allStatus.map(s => s.serverId)).toContain('test-server');
      expect(allStatus.map(s => s.serverId)).toContain('disabled-server');
    });

    it('should return server configuration', () => {
      const server = registry.getServer('test-server');
      expect(server).toEqual(mockServerConfig);
      expect(server).not.toBe(mockServerConfig); // Should be a copy
    });

    it('should return only enabled servers', () => {
      const enabled = registry.getEnabledServers();
      expect(enabled).toHaveLength(1);
      expect(enabled[0].id).toBe('test-server');
    });

    it('should return cached tools', async () => {
      const mockTools = [
        { serverId: 'test-server', name: 'tool1', description: '', inputSchema: {} }
      ];

      mockClient.connect.mockResolvedValue(undefined);
      mockClient.discoverTools.mockResolvedValue(mockTools);
      await registry.discoverServerTools('test-server');

      const cachedTools = registry.getCachedTools('test-server');
      expect(cachedTools).toEqual(mockTools);

      const allCachedTools = registry.getCachedTools();
      expect(allCachedTools).toEqual(mockTools);
    });
  });

  describe('destroy', () => {
    beforeEach(async () => {
      mockFs.readFile.mockResolvedValue(JSON.stringify(mockMcpConfig));
      await registry.initialize();

      mockClient.connect.mockResolvedValue(undefined);
      await registry.connectToServer('test-server');
    });

    it('should cleanup all resources', async () => {
      mockClient.disconnect.mockResolvedValue(undefined);

      await registry.destroy();

      expect(mockClient.disconnect).toHaveBeenCalled();
      expect(registry.getAllServers()).toHaveLength(0);
      expect(registry.getAllServerStatus()).toHaveLength(0);
    });
  });
});