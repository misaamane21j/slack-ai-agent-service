import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { MCPRegistryService } from '../../../src/services/mcp-registry';
import { MCPClientWrapper } from '../../../src/services/mcp-client-wrapper';
import { TestEnvironment, MockManager } from '../../utils/test-helpers';
import { resetToValidEnvironment } from '../../__mocks__/environment';
import { mockMCPServersConfig } from '../../__mocks__/mcp';

// Mock fs/promises
const mockFs = {
  readFile: jest.fn(),
  writeFile: jest.fn(),
  access: jest.fn(),
  stat: jest.fn()
};

jest.mock('fs/promises', () => mockFs);

// Mock MCPClientWrapper
const mockMCPClientWrapper = {
  initialize: jest.fn().mockResolvedValue(undefined),
  connect: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn().mockResolvedValue(undefined),
  callTool: jest.fn().mockResolvedValue({ success: true }),
  listTools: jest.fn().mockResolvedValue({
    tools: [
      {
        name: 'trigger_job',
        description: 'Triggers a Jenkins job',
        inputSchema: { type: 'object' }
      }
    ]
  }),
  isConnected: jest.fn().mockReturnValue(true),
  getServerInfo: jest.fn().mockReturnValue({
    name: 'jenkins',
    version: '1.0.0',
    connected: true
  })
};

jest.mock('../../../src/services/mcp-client-wrapper', () => ({
  MCPClientWrapper: jest.fn().mockImplementation(() => mockMCPClientWrapper)
}));

// Mock logger
jest.mock('../../../src/utils/logger', () => ({
  logger: jest.fn().mockReturnValue({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  })
}));

describe('MCPRegistryService', () => {
  let mcpRegistryService: MCPRegistryService;
  let testEnv: TestEnvironment;
  let mockManager: MockManager;

  beforeEach(() => {
    testEnv = new TestEnvironment();
    mockManager = new MockManager();
    
    // Set up valid test environment
    resetToValidEnvironment();
    
    // Clear all mocks
    jest.clearAllMocks();
    
    // Mock config file content
    mockFs.readFile.mockResolvedValue(JSON.stringify({
      servers: mockMCPServersConfig
    }));
    
    mcpRegistryService = new MCPRegistryService();
  });

  afterEach(() => {
    mockManager.restoreAllMocks();
    testEnv.restoreEnvironment();
  });

  describe('initialization', () => {
    it('should initialize registry successfully with valid config', async () => {
      // Act
      await mcpRegistryService.initialize();

      // Assert
      expect(mockFs.readFile).toHaveBeenCalled();
      const { logger } = require('../../../src/utils/logger');
      expect(logger().info).toHaveBeenCalledWith(
        'MCP Registry initialized successfully',
        expect.objectContaining({
          serverCount: expect.any(Number),
          enabledServers: expect.any(Number)
        })
      );
    });

    it('should not reinitialize if already initialized', async () => {
      // Arrange
      await mcpRegistryService.initialize();
      mockFs.readFile.mockClear();

      // Act
      await mcpRegistryService.initialize();

      // Assert
      expect(mockFs.readFile).not.toHaveBeenCalled();
    });

    it('should handle config file read errors', async () => {
      // Arrange
      mockFs.readFile.mockRejectedValueOnce(new Error('File not found'));

      // Act & Assert
      await expect(mcpRegistryService.initialize()).rejects.toThrow('File not found');
    });

    it('should handle invalid JSON in config file', async () => {
      // Arrange
      mockFs.readFile.mockResolvedValueOnce('invalid json {');

      // Act & Assert
      await expect(mcpRegistryService.initialize()).rejects.toThrow();
    });

    it('should clear existing servers when loading new config', async () => {
      // Arrange
      await mcpRegistryService.initialize();
      
      // Change config and reinitialize
      mockFs.readFile.mockResolvedValueOnce(JSON.stringify({
        servers: {
          'new-server': {
            name: 'new-server',
            command: 'node',
            args: ['server.js'],
            enabled: true
          }
        }
      }));

      // Act
      const registryService = new MCPRegistryService();
      await registryService.initialize();

      // Assert
      expect(mockMCPClientWrapper.disconnect).toHaveBeenCalled();
    });
  });

  describe('server management', () => {
    beforeEach(async () => {
      await mcpRegistryService.initialize();
    });

    it('should get list of available servers', async () => {
      // Act
      const servers = await mcpRegistryService.getAvailableServers();

      // Assert
      expect(servers).toContain('jenkins');
      expect(servers).toContain('test-server');
    });

    it('should get server information', async () => {
      // Act
      const serverInfo = await mcpRegistryService.getServerInfo('jenkins');

      // Assert
      expect(serverInfo).toEqual(
        expect.objectContaining({
          name: 'jenkins',
          connected: expect.any(Boolean)
        })
      );
    });

    it('should return null for non-existent server info', async () => {
      // Act
      const serverInfo = await mcpRegistryService.getServerInfo('non-existent');

      // Assert
      expect(serverInfo).toBeNull();
    });

    it('should connect to server', async () => {
      // Act
      await mcpRegistryService.connectToServer('jenkins');

      // Assert
      expect(mockMCPClientWrapper.connect).toHaveBeenCalled();
    });

    it('should handle connection errors', async () => {
      // Arrange
      mockMCPClientWrapper.connect.mockRejectedValueOnce(new Error('Connection failed'));

      // Act & Assert
      await expect(mcpRegistryService.connectToServer('jenkins')).rejects.toThrow('Connection failed');
    });

    it('should disconnect from server', async () => {
      // Act
      await mcpRegistryService.disconnectFromServer('jenkins');

      // Assert
      expect(mockMCPClientWrapper.disconnect).toHaveBeenCalled();
    });

    it('should disconnect all servers', async () => {
      // Act
      await mcpRegistryService.disconnectAll();

      // Assert
      expect(mockMCPClientWrapper.disconnect).toHaveBeenCalledTimes(
        Object.keys(mockMCPServersConfig).length
      );
    });
  });

  describe('tool discovery', () => {
    beforeEach(async () => {
      await mcpRegistryService.initialize();
    });

    it('should discover tools from connected servers', async () => {
      // Act
      const tools = await mcpRegistryService.discoverTools();

      // Assert
      expect(tools).toHaveProperty('jenkins');
      expect(tools.jenkins).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'trigger_job',
            description: expect.any(String)
          })
        ])
      );
    });

    it('should get tools from specific server', async () => {
      // Act
      const tools = await mcpRegistryService.getServerTools('jenkins');

      // Assert
      expect(tools).toHaveLength(1);
      expect(tools[0]).toMatchObject({
        name: 'trigger_job',
        description: 'Triggers a Jenkins job'
      });
    });

    it('should return empty array for non-existent server tools', async () => {
      // Act
      const tools = await mcpRegistryService.getServerTools('non-existent');

      // Assert
      expect(tools).toEqual([]);
    });

    it('should handle tool discovery errors', async () => {
      // Arrange
      mockMCPClientWrapper.listTools.mockRejectedValueOnce(new Error('Failed to list tools'));

      // Act
      const tools = await mcpRegistryService.getServerTools('jenkins');

      // Assert
      expect(tools).toEqual([]);
      const { logger } = require('../../../src/utils/logger');
      expect(logger().error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to discover tools'),
        expect.any(Object)
      );
    });

    it('should cache discovered tools', async () => {
      // Act
      await mcpRegistryService.getServerTools('jenkins');
      await mcpRegistryService.getServerTools('jenkins'); // Second call should use cache

      // Assert
      expect(mockMCPClientWrapper.listTools).toHaveBeenCalledTimes(1);
    });
  });

  describe('tool execution', () => {
    beforeEach(async () => {
      await mcpRegistryService.initialize();
    });

    it('should execute tool on specified server', async () => {
      // Arrange
      const toolName = 'trigger_job';
      const serverName = 'jenkins';
      const args = { job_name: 'test-job' };

      // Act
      const result = await mcpRegistryService.callTool(serverName, toolName, args);

      // Assert
      expect(mockMCPClientWrapper.callTool).toHaveBeenCalledWith(toolName, args);
      expect(result).toEqual({ success: true });
    });

    it('should handle tool execution errors', async () => {
      // Arrange
      mockMCPClientWrapper.callTool.mockRejectedValueOnce(new Error('Tool execution failed'));

      // Act & Assert
      await expect(
        mcpRegistryService.callTool('jenkins', 'trigger_job', {})
      ).rejects.toThrow('Tool execution failed');
    });

    it('should validate server exists before tool execution', async () => {
      // Act & Assert
      await expect(
        mcpRegistryService.callTool('non-existent', 'some_tool', {})
      ).rejects.toThrow();
    });
  });

  describe('health monitoring', () => {
    beforeEach(async () => {
      await mcpRegistryService.initialize();
    });

    it('should check server health status', async () => {
      // Act
      const healthStatus = await mcpRegistryService.getHealthStatus();

      // Assert
      expect(healthStatus).toHaveProperty('servers');
      expect(healthStatus.servers).toHaveProperty('jenkins');
      expect(healthStatus.servers.jenkins).toMatchObject({
        connected: expect.any(Boolean),
        lastCheck: expect.any(Number)
      });
    });

    it('should update server status on connection changes', async () => {
      // Arrange
      mockMCPClientWrapper.isConnected.mockReturnValue(false);

      // Act
      const healthStatus = await mcpRegistryService.getHealthStatus();

      // Assert
      expect(healthStatus.servers.jenkins.connected).toBe(false);
    });

    it('should track server response times', async () => {
      // Arrange
      const startTime = Date.now();
      mockMCPClientWrapper.callTool.mockImplementation(() => 
        new Promise(resolve => setTimeout(() => resolve({ success: true }), 100))
      );

      // Act
      await mcpRegistryService.callTool('jenkins', 'trigger_job', {});
      
      // Assert
      expect(Date.now() - startTime).toBeGreaterThanOrEqual(100);
    });
  });

  describe('configuration management', () => {
    it('should validate server configurations', async () => {
      // Arrange
      const invalidConfig = {
        servers: {
          'invalid-server': {
            name: 'invalid-server',
            // Missing required command field
            args: ['server.js'],
            enabled: true
          }
        }
      };
      
      mockFs.readFile.mockResolvedValueOnce(JSON.stringify(invalidConfig));

      // Act & Assert
      await expect(mcpRegistryService.initialize()).rejects.toThrow();
    });

    it('should only load enabled servers', async () => {
      // Arrange
      const configWithDisabled = {
        servers: {
          'enabled-server': {
            name: 'enabled-server',
            command: 'node',
            args: ['enabled.js'],
            enabled: true
          },
          'disabled-server': {
            name: 'disabled-server',
            command: 'node',
            args: ['disabled.js'],
            enabled: false
          }
        }
      };
      
      mockFs.readFile.mockResolvedValueOnce(JSON.stringify(configWithDisabled));

      // Act
      const registryService = new MCPRegistryService();
      await registryService.initialize();
      const servers = await registryService.getAvailableServers();

      // Assert
      expect(servers).toContain('enabled-server');
      expect(servers).not.toContain('disabled-server');
    });

    it('should handle server configuration updates', async () => {
      // Arrange
      await mcpRegistryService.initialize();

      const newConfig = {
        servers: {
          'updated-server': {
            name: 'updated-server',
            command: 'node',
            args: ['updated.js'],
            enabled: true
          }
        }
      };

      mockFs.readFile.mockResolvedValueOnce(JSON.stringify(newConfig));

      // Act
      await mcpRegistryService.reloadConfiguration();
      const servers = await mcpRegistryService.getAvailableServers();

      // Assert
      expect(servers).toContain('updated-server');
      expect(servers).not.toContain('jenkins');
    });
  });
});