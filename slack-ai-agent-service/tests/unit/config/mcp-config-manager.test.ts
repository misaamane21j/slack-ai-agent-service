import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { promises as fs } from 'fs';
import path from 'path';
import { MCPConfigManager } from '../../../src/config/mcp-config-manager';
import { EnhancedMCPConfig, MCPServerConfig } from '../../../src/config/mcp-interfaces';

// Mock dependencies
jest.mock('../../../src/utils/logger', () => ({
  logger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

jest.mock('fs/promises');
jest.mock('chokidar', () => ({
  watch: jest.fn(() => ({
    on: jest.fn(),
    close: jest.fn(),
  })),
}));

const mockFs = fs as jest.Mocked<typeof fs>;

describe('MCPConfigManager', () => {
  let configManager: MCPConfigManager;
  let tempConfigPath: string;
  let originalEnv: NodeJS.ProcessEnv;

  const mockConfig: EnhancedMCPConfig = {
    configFile: './test-config.json',
    watchConfigFile: true,
    globalTimeout: 30000,
    maxConcurrentConnections: 10,
    allowedPaths: ['/usr/local/bin'],
    processTimeout: 30000,
    allowRelativePaths: false,
    security: {
      useEnvSubstitution: true,
      allowedEnvPrefixes: ['MCP_', 'JENKINS_'],
      credentialExpiration: 86400000,
    },
    registry: {
      updateInterval: 60000,
      autoDiscovery: false,
      discovery: {
        scanDirectories: [],
        filePatterns: ['*mcp*.js'],
        recursive: true,
      },
      defaults: {},
    },
    servers: {
      jenkins: {
        id: 'jenkins',
        name: 'Jenkins CI/CD',
        description: 'Manage Jenkins jobs',
        enabled: true,
        priority: 80,
        command: 'node',
        args: ['jenkins-server.js'],
        env: {
          JENKINS_URL: '${JENKINS_URL}',
          JENKINS_TOKEN: '${JENKINS_TOKEN}',
        },
        timeout: 30000,
        retry: {
          maxRetries: 3,
          initialDelay: 1000,
          backoffMultiplier: 2,
          maxDelay: 10000,
          resetOnSuccess: true,
        },
        health: {
          enabled: true,
          interval: 30000,
          failureThreshold: 3,
          timeout: 5000,
          autoRestart: true,
        },
        resources: {
          maxMemoryMb: 512,
          maxCpuPercent: 50,
          maxExecutionTime: 300000,
          maxFileDescriptors: 1024,
        },
        security: {
          useEnvSubstitution: true,
          allowedEnvPrefixes: ['JENKINS_'],
          credentialExpiration: 86400000,
        },
        capabilities: ['build', 'deployment'],
        cacheResponses: true,
        cacheTtl: 300000,
        tags: ['jenkins', 'ci'],
        lastModified: new Date(),
        source: 'file',
        toolConfig: {},
      },
    },
    stats: {
      totalOperations: 0,
      totalFailures: 0,
    },
  };

  beforeEach(() => {
    originalEnv = process.env;
    process.env = {
      ...originalEnv,
      JENKINS_URL: 'http://jenkins.example.com',
      JENKINS_TOKEN: 'test-token-123',
    };

    tempConfigPath = path.join(__dirname, 'test-mcp-config.json');
    configManager = new MCPConfigManager(tempConfigPath);

    jest.clearAllMocks();
  });

  afterEach(async () => {
    process.env = originalEnv;
    await configManager.stop();
    jest.restoreAllMocks();
  });

  describe('Configuration Loading', () => {
    it('should load and validate configuration from file', async () => {
      // Arrange
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readFile.mockResolvedValue(JSON.stringify(mockConfig));

      // Act
      const config = await configManager.loadConfig();

      // Assert
      expect(config).toBeDefined();
      expect(config.servers.jenkins).toBeDefined();
      expect(config.servers.jenkins.name).toBe('Jenkins CI/CD');
      expect(mockFs.readFile).toHaveBeenCalledWith(tempConfigPath, 'utf-8');
    });

    it('should create default configuration when file does not exist', async () => {
      // Arrange
      mockFs.access.mockRejectedValue(new Error('File not found'));
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.readFile.mockResolvedValue(JSON.stringify({
        configFile: tempConfigPath,
        watchConfigFile: true,
        globalTimeout: 30000,
        maxConcurrentConnections: 10,
        allowedPaths: ['/usr/local/bin'],
        processTimeout: 30000,
        allowRelativePaths: false,
        security: { useEnvSubstitution: true, allowedEnvPrefixes: ['MCP_'] },
        registry: { updateInterval: 60000, autoDiscovery: false, discovery: { scanDirectories: [], filePatterns: ['*mcp*.js'], recursive: true } },
        servers: {},
        stats: { totalOperations: 0, totalFailures: 0 },
      }));

      // Act
      const config = await configManager.loadConfig();

      // Assert
      expect(mockFs.writeFile).toHaveBeenCalled();
      expect(config).toBeDefined();
    });

    it('should throw error for invalid configuration', async () => {
      // Arrange
      const invalidConfig = { invalid: 'config' };
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readFile.mockResolvedValue(JSON.stringify(invalidConfig));

      // Act & Assert
      await expect(configManager.loadConfig()).rejects.toThrow('Configuration validation failed');
    });

    it('should process environment variable substitution', async () => {
      // Arrange
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readFile.mockResolvedValue(JSON.stringify(mockConfig));

      // Act
      const config = await configManager.loadConfig();

      // Assert
      expect(config.servers.jenkins.env.JENKINS_URL).toBe('http://jenkins.example.com');
      expect(config.servers.jenkins.env.JENKINS_TOKEN).toBe('test-token-123');
    });
  });

  describe('Server Management', () => {
    beforeEach(async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readFile.mockResolvedValue(JSON.stringify(mockConfig));
      mockFs.writeFile.mockResolvedValue(undefined);
      await configManager.loadConfig();
    });

    it('should add new server configuration', async () => {
      // Arrange
      const newServerConfig: Partial<MCPServerConfig> = {
        name: 'GitHub Integration',
        description: 'Manage GitHub repositories',
        command: 'node',
        args: ['github-server.js'],
        env: { GITHUB_TOKEN: '${GITHUB_TOKEN}' },
      };

      // Act
      await configManager.addOrUpdateServer('github', newServerConfig);

      // Assert
      const config = configManager.getConfig();
      expect(config.servers.github).toBeDefined();
      expect(config.servers.github.name).toBe('GitHub Integration');
      expect(mockFs.writeFile).toHaveBeenCalled();
    });

    it('should update existing server configuration', async () => {
      // Arrange
      const updates: Partial<MCPServerConfig> = {
        enabled: false,
        priority: 90,
      };

      // Act
      await configManager.addOrUpdateServer('jenkins', updates);

      // Assert
      const config = configManager.getConfig();
      expect(config.servers.jenkins.enabled).toBe(false);
      expect(config.servers.jenkins.priority).toBe(90);
    });

    it('should remove server configuration', async () => {
      // Act
      await configManager.removeServer('jenkins');

      // Assert
      const config = configManager.getConfig();
      expect(config.servers.jenkins).toBeUndefined();
      expect(mockFs.writeFile).toHaveBeenCalled();
    });

    it('should throw error when removing non-existent server', async () => {
      // Act & Assert
      await expect(configManager.removeServer('nonexistent')).rejects.toThrow("Server 'nonexistent' not found");
    });

    it('should validate server configuration before adding', async () => {
      // Arrange
      const invalidServerConfig = {
        name: '', // Invalid - empty name
        command: 'node',
      };

      // Act & Assert
      await expect(configManager.addOrUpdateServer('invalid', invalidServerConfig))
        .rejects.toThrow('Server configuration validation failed');
    });
  });

  describe('Configuration Retrieval', () => {
    beforeEach(async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readFile.mockResolvedValue(JSON.stringify(mockConfig));
      await configManager.loadConfig();
    });

    it('should get complete configuration', () => {
      // Act
      const config = configManager.getConfig();

      // Assert
      expect(config).toBeDefined();
      expect(config.servers).toBeDefined();
      expect(config.globalTimeout).toBe(30000);
    });

    it('should get server configuration by ID', () => {
      // Act
      const serverConfig = configManager.getServerConfig('jenkins');

      // Assert
      expect(serverConfig).toBeDefined();
      expect(serverConfig!.name).toBe('Jenkins CI/CD');
    });

    it('should return null for non-existent server', () => {
      // Act
      const serverConfig = configManager.getServerConfig('nonexistent');

      // Assert
      expect(serverConfig).toBeNull();
    });

    it('should get enabled servers only', () => {
      // Act
      const enabledServers = configManager.getEnabledServers();

      // Assert
      expect(Object.keys(enabledServers)).toContain('jenkins');
      expect(enabledServers.jenkins.enabled).toBe(true);
    });
  });

  describe('Configuration Validation', () => {
    beforeEach(async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readFile.mockResolvedValue(JSON.stringify(mockConfig));
      await configManager.loadConfig();
    });

    it('should validate current configuration', () => {
      // Act
      const validation = configManager.validateConfiguration();

      // Assert
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should return validation errors for invalid configuration', () => {
      // Arrange - Manually corrupt the configuration
      const config = configManager.getConfig();
      (config as any).globalTimeout = 'invalid'; // Invalid type

      // Act
      const validation = configManager.validateConfiguration();

      // Assert
      expect(validation.valid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
    });
  });

  describe('Statistics and Status', () => {
    beforeEach(async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readFile.mockResolvedValue(JSON.stringify(mockConfig));
      await configManager.loadConfig();
    });

    it('should get configuration statistics', () => {
      // Act
      const stats = configManager.getStats();

      // Assert
      expect(stats).toBeDefined();
      expect(stats.serverCount).toBe(1);
      expect(stats.enabledServerCount).toBe(1);
      expect(stats.configPath).toBe(tempConfigPath);
      expect(stats.lastModified).toBeDefined();
    });
  });

  describe('Configuration Reloading', () => {
    beforeEach(async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readFile.mockResolvedValue(JSON.stringify(mockConfig));
      await configManager.loadConfig();
    });

    it('should reload configuration manually', async () => {
      // Arrange
      const updatedConfig = { ...mockConfig };
      updatedConfig.globalTimeout = 60000;
      mockFs.readFile.mockResolvedValue(JSON.stringify(updatedConfig));

      // Act
      const reloadedConfig = await configManager.reloadConfig();

      // Assert
      expect(reloadedConfig.globalTimeout).toBe(60000);
    });
  });

  describe('Event Handling', () => {
    beforeEach(async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readFile.mockResolvedValue(JSON.stringify(mockConfig));
      mockFs.writeFile.mockResolvedValue(undefined);
      await configManager.loadConfig();
    });

    it('should emit events when server is added', async () => {
      // Arrange
      const eventListener = jest.fn();
      configManager.on('server-added', eventListener);

      // Act
      await configManager.addOrUpdateServer('github', {
        name: 'GitHub',
        description: 'GitHub integration',
        command: 'node',
        args: ['github.js'],
      });

      // Assert
      expect(eventListener).toHaveBeenCalledWith('github', expect.any(Object));
    });

    it('should emit events when server is updated', async () => {
      // Arrange
      const eventListener = jest.fn();
      configManager.on('server-updated', eventListener);

      // Act
      await configManager.addOrUpdateServer('jenkins', { priority: 95 });

      // Assert
      expect(eventListener).toHaveBeenCalledWith(
        'jenkins',
        expect.any(Object),
        expect.any(Object)
      );
    });

    it('should emit events when server is removed', async () => {
      // Arrange
      const eventListener = jest.fn();
      configManager.on('server-removed', eventListener);

      // Act
      await configManager.removeServer('jenkins');

      // Assert
      expect(eventListener).toHaveBeenCalledWith('jenkins');
    });
  });

  describe('Error Handling', () => {
    it('should handle file read errors gracefully', async () => {
      // Arrange
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readFile.mockRejectedValue(new Error('Permission denied'));

      // Act & Assert
      await expect(configManager.loadConfig()).rejects.toThrow();
    });

    it('should handle malformed JSON gracefully', async () => {
      // Arrange
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readFile.mockResolvedValue('invalid json');

      // Act & Assert
      await expect(configManager.loadConfig()).rejects.toThrow();
    });

    it('should throw error when trying to get config without loading', () => {
      // Arrange
      const freshConfigManager = new MCPConfigManager('/tmp/test.json');

      // Act & Assert
      expect(() => freshConfigManager.getConfig()).toThrow('Configuration not loaded');
    });
  });
});