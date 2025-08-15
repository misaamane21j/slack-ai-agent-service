import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { MCPRegistryService } from '../../src/services/mcp-registry';
import { MCPClientService } from '../../src/services/mcp-client';
import { MCPClientWrapper } from '../../src/services/mcp-client-wrapper';
import { TestEnvironment, AsyncTestHelper } from '../utils/test-helpers';
import { resetToValidEnvironment } from '../__mocks__/environment';
import { mockMCPServersConfig, createMockMCPResponse } from '../__mocks__/mcp';

// Mock file system operations
const mockFs = {
  readFile: jest.fn(),
  writeFile: jest.fn(),
  access: jest.fn(),
  stat: jest.fn()
};

jest.mock('fs/promises', () => mockFs);

// Mock MCP SDK
const mockClient = {
  connect: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn().mockResolvedValue(undefined),
  callTool: jest.fn().mockResolvedValue(createMockMCPResponse()),
  listTools: jest.fn().mockResolvedValue({
    tools: [
      { name: 'trigger_job', description: 'Triggers a Jenkins job' },
      { name: 'get_job_status', description: 'Gets Jenkins job status' },
      { name: 'cancel_job', description: 'Cancels a Jenkins job' }
    ]
  }),
  listResources: jest.fn().mockResolvedValue({ resources: [] }),
  readResource: jest.fn().mockResolvedValue({ contents: [] })
};

const mockTransport = {
  start: jest.fn().mockResolvedValue(undefined),
  close: jest.fn().mockResolvedValue(undefined)
};

jest.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: jest.fn().mockImplementation(() => mockClient)
}));

jest.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: jest.fn().mockImplementation(() => mockTransport)
}));

// Mock security validation
jest.mock('../../src/config/security', () => ({
  validateJenkinsPath: jest.fn().mockReturnValue(true),
  validateSpawnArguments: jest.fn().mockReturnValue(true)
}));

// Mock logger
jest.mock('../../src/utils/logger', () => ({
  logger: jest.fn().mockReturnValue({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  })
}));

describe('MCP System Integration Tests', () => {
  let mcpRegistry: MCPRegistryService;
  let mcpClient: MCPClientService;
  let testEnv: TestEnvironment;

  beforeEach(async () => {
    testEnv = new TestEnvironment();
    resetToValidEnvironment();

    // Mock config file content
    mockFs.readFile.mockResolvedValue(JSON.stringify({
      servers: mockMCPServersConfig
    }));

    // Clear all mocks
    jest.clearAllMocks();

    // Initialize services
    mcpRegistry = new MCPRegistryService();
    mcpClient = new MCPClientService();
  });

  afterEach(() => {
    testEnv.restoreEnvironment();
  });

  describe('MCP Registry and Client Integration', () => {
    it('should initialize registry and discover tools from multiple servers', async () => {
      // Act
      await mcpRegistry.initialize();
      const discoveredTools = await mcpRegistry.discoverTools();

      // Assert
      expect(discoveredTools).toHaveProperty('jenkins');
      expect(discoveredTools).toHaveProperty('test-server');
      expect(discoveredTools.jenkins).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'trigger_job',
            description: expect.any(String)
          })
        ])
      );
    });

    it('should handle server connection lifecycle properly', async () => {
      // Arrange
      await mcpRegistry.initialize();

      // Act - Connect to server
      await mcpRegistry.connectToServer('jenkins');
      const serverInfo = await mcpRegistry.getServerInfo('jenkins');

      // Assert
      expect(serverInfo).toMatchObject({
        name: 'jenkins',
        connected: expect.any(Boolean)
      });
      expect(mockClient.connect).toHaveBeenCalled();
    });

    it('should execute tools through registry with proper error handling', async () => {
      // Arrange
      await mcpRegistry.initialize();
      await mcpRegistry.connectToServer('jenkins');

      const toolArgs = {
        job_name: 'test-deployment',
        parameters: {
          ENVIRONMENT: 'staging',
          BRANCH: 'feature/test'
        }
      };

      // Act
      const result = await mcpRegistry.callTool('jenkins', 'trigger_job', toolArgs);

      // Assert
      expect(result).toEqual(createMockMCPResponse());
      expect(mockClient.callTool).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'trigger_job',
          arguments: toolArgs
        })
      );
    });

    it('should handle multiple concurrent tool executions', async () => {
      // Arrange
      await mcpRegistry.initialize();
      await mcpRegistry.connectToServer('jenkins');

      const toolCalls = [
        { server: 'jenkins', tool: 'get_job_status', args: { job_name: 'job1' } },
        { server: 'jenkins', tool: 'get_job_status', args: { job_name: 'job2' } },
        { server: 'jenkins', tool: 'trigger_job', args: { job_name: 'job3' } }
      ];

      // Mock different responses for different calls
      mockClient.callTool
        .mockResolvedValueOnce(createMockMCPResponse(true, { status: 'running' }))
        .mockResolvedValueOnce(createMockMCPResponse(true, { status: 'idle' }))
        .mockResolvedValueOnce(createMockMCPResponse(true, { jobId: 123 }));

      // Act
      const promises = toolCalls.map(call => 
        mcpRegistry.callTool(call.server, call.tool, call.args)
      );
      const results = await Promise.all(promises);

      // Assert
      expect(results).toHaveLength(3);
      expect(mockClient.callTool).toHaveBeenCalledTimes(3);
      expect(results[0].content[0].text).toContain('running');
      expect(results[1].content[0].text).toContain('idle');
      expect(results[2].content[0].text).toContain('123');
    });

    it('should handle server disconnection and reconnection', async () => {
      // Arrange
      await mcpRegistry.initialize();
      await mcpRegistry.connectToServer('jenkins');

      // Act - Disconnect and reconnect
      await mcpRegistry.disconnectFromServer('jenkins');
      await mcpRegistry.connectToServer('jenkins');

      // Assert
      expect(mockClient.disconnect).toHaveBeenCalled();
      expect(mockClient.connect).toHaveBeenCalledTimes(2); // Initial connect + reconnect
    });
  });

  describe('Error Handling and Recovery', () => {
    it('should handle server initialization failures', async () => {
      // Arrange
      mockFs.readFile.mockRejectedValueOnce(new Error('Config file not found'));

      // Act & Assert
      await expect(mcpRegistry.initialize()).rejects.toThrow('Config file not found');
    });

    it('should handle tool execution failures with proper error propagation', async () => {
      // Arrange
      await mcpRegistry.initialize();
      await mcpRegistry.connectToServer('jenkins');

      mockClient.callTool.mockRejectedValueOnce(new Error('Tool execution failed'));

      // Act & Assert
      await expect(
        mcpRegistry.callTool('jenkins', 'trigger_job', {})
      ).rejects.toThrow('Tool execution failed');
    });

    it('should handle connection failures gracefully', async () => {
      // Arrange
      await mcpRegistry.initialize();
      mockClient.connect.mockRejectedValueOnce(new Error('Connection refused'));

      // Act & Assert
      await expect(
        mcpRegistry.connectToServer('jenkins')
      ).rejects.toThrow('Connection refused');
    });

    it('should continue working with other servers when one fails', async () => {
      // Arrange
      await mcpRegistry.initialize();
      
      // Mock one server to fail, another to succeed
      let callCount = 0;
      mockClient.connect.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          throw new Error('First server failed');
        }
        return Promise.resolve();
      });

      // Act
      let firstServerError;
      try {
        await mcpRegistry.connectToServer('jenkins');
      } catch (error) {
        firstServerError = error;
      }

      const secondServerResult = await mcpRegistry.connectToServer('test-server');

      // Assert
      expect(firstServerError).toBeInstanceOf(Error);
      expect(mockClient.connect).toHaveBeenCalledTimes(2);
    });
  });

  describe('Performance and Scalability', () => {
    it('should handle high-frequency tool calls efficiently', async () => {
      // Arrange
      await mcpRegistry.initialize();
      await mcpRegistry.connectToServer('jenkins');

      const numberOfCalls = 50;
      const startTime = Date.now();

      // Act
      const promises = Array(numberOfCalls).fill(0).map((_, i) =>
        mcpRegistry.callTool('jenkins', 'get_job_status', { job_name: `job_${i}` })
      );

      await Promise.all(promises);
      const endTime = Date.now();

      // Assert
      expect(mockClient.callTool).toHaveBeenCalledTimes(numberOfCalls);
      expect(endTime - startTime).toBeLessThan(5000); // Should complete within 5 seconds
    });

    it('should handle tool caching effectively', async () => {
      // Arrange
      await mcpRegistry.initialize();

      // Act - Call getServerTools multiple times
      await mcpRegistry.getServerTools('jenkins');
      await mcpRegistry.getServerTools('jenkins');
      await mcpRegistry.getServerTools('jenkins');

      // Assert - Should only call listTools once due to caching
      expect(mockClient.listTools).toHaveBeenCalledTimes(1);
    });

    it('should handle resource cleanup on disconnection', async () => {
      // Arrange
      await mcpRegistry.initialize();
      await mcpRegistry.connectToServer('jenkins');

      // Act
      await mcpRegistry.disconnectAll();

      // Assert
      expect(mockClient.disconnect).toHaveBeenCalled();
      expect(mockTransport.close).toHaveBeenCalled();
    });
  });

  describe('Configuration Management', () => {
    it('should reload configuration without breaking existing connections', async () => {
      // Arrange
      await mcpRegistry.initialize();
      const initialServers = await mcpRegistry.getAvailableServers();

      // Update config
      const newConfig = {
        servers: {
          'jenkins': mockMCPServersConfig.jenkins,
          'new-server': {
            name: 'new-server',
            command: 'node',
            args: ['new-server.js'],
            enabled: true
          }
        }
      };

      mockFs.readFile.mockResolvedValueOnce(JSON.stringify(newConfig));

      // Act
      await mcpRegistry.reloadConfiguration();
      const updatedServers = await mcpRegistry.getAvailableServers();

      // Assert
      expect(updatedServers).toContain('new-server');
      expect(updatedServers).toContain('jenkins');
      expect(updatedServers).not.toContain('test-server');
    });

    it('should validate server configurations during loading', async () => {
      // Arrange
      const invalidConfig = {
        servers: {
          'invalid-server': {
            // Missing required command field
            name: 'invalid-server',
            args: ['server.js'],
            enabled: true
          }
        }
      };

      mockFs.readFile.mockResolvedValueOnce(JSON.stringify(invalidConfig));

      // Act & Assert
      await expect(mcpRegistry.initialize()).rejects.toThrow();
    });

    it('should filter out disabled servers', async () => {
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
      await mcpRegistry.initialize();
      const servers = await mcpRegistry.getAvailableServers();

      // Assert
      expect(servers).toContain('enabled-server');
      expect(servers).not.toContain('disabled-server');
    });
  });

  describe('Health Monitoring Integration', () => {
    it('should track server health status over time', async () => {
      // Arrange
      await mcpRegistry.initialize();
      await mcpRegistry.connectToServer('jenkins');

      // Act - Simulate some tool calls to generate health data
      await mcpRegistry.callTool('jenkins', 'get_job_status', { job_name: 'test' });
      await mcpRegistry.callTool('jenkins', 'get_job_status', { job_name: 'test2' });

      const healthStatus = await mcpRegistry.getHealthStatus();

      // Assert
      expect(healthStatus).toHaveProperty('servers');
      expect(healthStatus.servers).toHaveProperty('jenkins');
      expect(healthStatus.servers.jenkins).toMatchObject({
        connected: expect.any(Boolean),
        lastCheck: expect.any(Number),
        callCount: expect.any(Number),
        errorCount: expect.any(Number)
      });
    });

    it('should detect and report unhealthy servers', async () => {
      // Arrange
      await mcpRegistry.initialize();
      await mcpRegistry.connectToServer('jenkins');

      // Simulate server failures
      mockClient.callTool.mockRejectedValue(new Error('Server unavailable'));

      // Act - Try multiple failed calls
      for (let i = 0; i < 3; i++) {
        try {
          await mcpRegistry.callTool('jenkins', 'trigger_job', {});
        } catch (error) {
          // Expected to fail
        }
      }

      const healthStatus = await mcpRegistry.getHealthStatus();

      // Assert
      expect(healthStatus.servers.jenkins.errorCount).toBeGreaterThan(0);
    });
  });
});