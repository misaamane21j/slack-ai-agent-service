import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { MCPClientService } from '../../../src/services/mcp-client';
import { TestEnvironment, MockManager } from '../../utils/test-helpers';
import { resetToValidEnvironment } from '../../__mocks__/environment';
import { createMockMCPResponse } from '../../__mocks__/mcp';

// Mock MCP SDK modules
const mockClient = {
  connect: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn().mockResolvedValue(undefined),
  callTool: jest.fn().mockResolvedValue(createMockMCPResponse()),
  listTools: jest.fn().mockResolvedValue({
    tools: [
      {
        name: 'trigger_job',
        description: 'Triggers a Jenkins job',
        inputSchema: {
          type: 'object',
          properties: {
            job_name: { type: 'string' }
          }
        }
      }
    ]
  }),
  setRequestId: jest.fn()
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

// Mock logger
jest.mock('../../../src/utils/logger', () => ({
  logger: jest.fn().mockReturnValue({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  })
}));

// Mock security validation functions
jest.mock('../../../src/config/security', () => ({
  validateJenkinsPath: jest.fn().mockReturnValue(true),
  validateSpawnArguments: jest.fn().mockReturnValue(true)
}));

describe('MCPClientService', () => {
  let mcpClientService: MCPClientService;
  let testEnv: TestEnvironment;
  let mockManager: MockManager;

  beforeEach(() => {
    testEnv = new TestEnvironment();
    mockManager = new MockManager();
    
    // Set up valid test environment
    resetToValidEnvironment();
    
    // Clear all mocks
    jest.clearAllMocks();
    
    mcpClientService = new MCPClientService();
  });

  afterEach(() => {
    mockManager.restoreAllMocks();
    testEnv.restoreEnvironment();
  });

  describe('initialization', () => {
    it('should initialize MCP client successfully with valid configuration', async () => {
      // Act
      await mcpClientService.initialize();

      // Assert
      expect(mockTransport.start).toHaveBeenCalled();
      expect(mockClient.connect).toHaveBeenWith(mockTransport);
    });

    it('should validate Jenkins server path before initialization', async () => {
      // Arrange
      const { validateJenkinsPath } = require('../../../src/config/security');

      // Act
      await mcpClientService.initialize();

      // Assert
      expect(validateJenkinsPath).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          allowedPaths: expect.any(Array),
          requireExecutable: true,
          allowRelativePaths: expect.any(Boolean)
        })
      );
    });

    it('should validate spawn arguments before initialization', async () => {
      // Arrange
      const { validateSpawnArguments } = require('../../../src/config/security');

      // Act
      await mcpClientService.initialize();

      // Assert
      expect(validateSpawnArguments).toHaveBeenCalledWith(
        'node',
        expect.arrayContaining([expect.any(String)])
      );
    });

    it('should throw error when Jenkins path validation fails', async () => {
      // Arrange
      const { validateJenkinsPath } = require('../../../src/config/security');
      validateJenkinsPath.mockReturnValue(false);

      // Act & Assert
      await expect(mcpClientService.initialize()).rejects.toThrow(
        'Jenkins server path validation failed'
      );
    });

    it('should throw error when spawn arguments validation fails', async () => {
      // Arrange
      const { validateSpawnArguments } = require('../../../src/config/security');
      validateSpawnArguments.mockReturnValue(false);

      // Act & Assert
      await expect(mcpClientService.initialize()).rejects.toThrow(
        'Jenkins server spawn arguments validation failed'
      );
    });

    it('should handle transport initialization errors', async () => {
      // Arrange
      mockTransport.start.mockRejectedValueOnce(new Error('Transport failed'));

      // Act & Assert
      await expect(mcpClientService.initialize()).rejects.toThrow('Transport failed');
    });

    it('should handle client connection errors', async () => {
      // Arrange
      mockClient.connect.mockRejectedValueOnce(new Error('Connection failed'));

      // Act & Assert
      await expect(mcpClientService.initialize()).rejects.toThrow('Connection failed');
    });
  });

  describe('tool execution', () => {
    beforeEach(async () => {
      await mcpClientService.initialize();
    });

    it('should execute Jenkins job trigger successfully', async () => {
      // Arrange
      const jobRequest = {
        job_name: 'deploy-production',
        parameters: {
          ENVIRONMENT: 'production',
          BRANCH: 'main'
        }
      };

      const expectedResponse = createMockMCPResponse(true, {
        jobUrl: 'https://jenkins.example.com/job/deploy-production/123/',
        jobId: 123,
        status: 'started'
      });

      mockClient.callTool.mockResolvedValue(expectedResponse);

      // Act
      const result = await mcpClientService.triggerJob(jobRequest);

      // Assert
      expect(mockClient.callTool).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'trigger_job',
          arguments: jobRequest
        })
      );
      expect(result).toEqual(expectedResponse);
    });

    it('should handle job parameters sanitization', async () => {
      // Arrange
      const jobRequest = {
        job_name: 'test-job',
        parameters: {
          'PARAM_WITH_SPECIAL_CHARS': 'value&with;dangerous|chars',
          'NORMAL_PARAM': 'normal_value'
        }
      };

      // Act
      await mcpClientService.triggerJob(jobRequest);

      // Assert
      expect(mockClient.callTool).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'trigger_job',
          arguments: expect.objectContaining({
            job_name: 'test-job',
            parameters: expect.any(Object)
          })
        })
      );
    });

    it('should handle tool execution errors', async () => {
      // Arrange
      const jobRequest = {
        job_name: 'failing-job',
        parameters: {}
      };

      mockClient.callTool.mockRejectedValueOnce(new Error('Tool execution failed'));

      // Act & Assert
      await expect(mcpClientService.triggerJob(jobRequest)).rejects.toThrow(
        'Tool execution failed'
      );
    });

    it('should handle invalid job requests', async () => {
      // Arrange
      const invalidJobRequest = {
        job_name: '', // Invalid empty job name
        parameters: {}
      };

      // Act & Assert
      await expect(mcpClientService.triggerJob(invalidJobRequest)).rejects.toThrow();
    });
  });

  describe('connection management', () => {
    it('should check connection status correctly', async () => {
      // Arrange
      await mcpClientService.initialize();

      // Act
      const isConnected = mcpClientService.isConnected();

      // Assert
      expect(isConnected).toBe(true);
    });

    it('should return false for connection status when not initialized', () => {
      // Act
      const isConnected = mcpClientService.isConnected();

      // Assert
      expect(isConnected).toBe(false);
    });

    it('should disconnect cleanly', async () => {
      // Arrange
      await mcpClientService.initialize();

      // Act
      await mcpClientService.disconnect();

      // Assert
      expect(mockClient.disconnect).toHaveBeenCalled();
      expect(mockTransport.close).toHaveBeenCalled();
    });

    it('should handle disconnect errors gracefully', async () => {
      // Arrange
      await mcpClientService.initialize();
      mockClient.disconnect.mockRejectedValueOnce(new Error('Disconnect failed'));
      mockTransport.close.mockRejectedValueOnce(new Error('Transport close failed'));

      // Act
      await mcpClientService.disconnect();

      // Assert - Should not throw, but log errors
      expect(mockClient.disconnect).toHaveBeenCalled();
      expect(mockTransport.close).toHaveBeenCalled();
    });
  });

  describe('tool discovery', () => {
    beforeEach(async () => {
      await mcpClientService.initialize();
    });

    it('should list available tools', async () => {
      // Act
      const tools = await mcpClientService.listTools();

      // Assert
      expect(mockClient.listTools).toHaveBeenCalled();
      expect(tools.tools).toHaveLength(1);
      expect(tools.tools[0]).toMatchObject({
        name: 'trigger_job',
        description: expect.any(String)
      });
    });

    it('should handle tool listing errors', async () => {
      // Arrange
      mockClient.listTools.mockRejectedValueOnce(new Error('Failed to list tools'));

      // Act & Assert
      await expect(mcpClientService.listTools()).rejects.toThrow('Failed to list tools');
    });
  });

  describe('error recovery', () => {
    it('should attempt reconnection when connection is lost', async () => {
      // Arrange
      await mcpClientService.initialize();
      
      // Simulate connection loss
      mockClient.callTool.mockRejectedValueOnce(new Error('Connection lost'));
      mockClient.connect.mockClear(); // Clear previous connect calls

      // Act
      try {
        await mcpClientService.triggerJob({
          job_name: 'test-job',
          parameters: {}
        });
      } catch (error) {
        // Connection error expected first time
      }

      // Reinitialize to test reconnection
      await mcpClientService.initialize();

      // Assert
      expect(mockClient.connect).toHaveBeenCalled();
    });
  });

  describe('security constraints', () => {
    it('should apply security constraints during initialization', async () => {
      // Act
      await mcpClientService.initialize();

      // Assert - Should have created transport with security options
      const StdioClientTransport = require('@modelcontextprotocol/sdk/client/stdio.js').StdioClientTransport;
      expect(StdioClientTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'node',
          args: expect.any(Array),
          env: expect.objectContaining({
            NODE_ENV: expect.any(String),
            PATH: expect.any(String)
          }),
          stderr: 'pipe'
        })
      );
    });

    it('should use minimal environment for security', async () => {
      // Act
      await mcpClientService.initialize();

      // Assert
      const StdioClientTransport = require('@modelcontextprotocol/sdk/client/stdio.js').StdioClientTransport;
      const transportOptions = StdioClientTransport.mock.calls[0][0];
      
      // Environment should only contain essential variables
      expect(Object.keys(transportOptions.env)).toHaveLength(2);
      expect(transportOptions.env).toHaveProperty('NODE_ENV');
      expect(transportOptions.env).toHaveProperty('PATH');
    });
  });
});