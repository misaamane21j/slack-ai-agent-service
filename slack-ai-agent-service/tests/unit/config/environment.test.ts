import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

// Mock dotenv before importing the module
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

describe('Environment Configuration', () => {
  let originalEnv: NodeJS.ProcessEnv;
  
  beforeEach(() => {
    // Save original environment
    originalEnv = process.env;
    
    // Reset modules to ensure clean state
    jest.resetModules();
    
    // Clear environment
    process.env = {};
  });
  
  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('loadConfig', () => {
    it('should successfully validate config with valid format tokens', async () => {
      // Arrange - Test that valid format validation passes
      const testFile = process.cwd() + '/test-jenkins-server.js';
      const fs = require('fs');
      fs.writeFileSync(testFile, 'console.log("test");');

      process.env = {
        SLACK_BOT_TOKEN: 'xoxb-valid-format-token', // Tests xoxb- validation
        SLACK_SIGNING_SECRET: 'this-is-a-32-character-secret-', // Tests minimum length
        SLACK_APP_TOKEN: 'xapp-valid-format-token', // Tests xapp- validation  
        ANTHROPIC_API_KEY: 'sk-ant-api03-valid-format-key', // Tests sk-ant-api03- validation
        JENKINS_MCP_SERVER_PATH: testFile, // Tests file exists validation
      };

      try {
        // Act
        const { loadConfig } = await import('../../../src/config/environment');
        const config = loadConfig();

        // Assert - Test validation logic worked, not specific values
        expect(config.slack.botToken).toMatch(/^xoxb-/); // Validates format rule
        expect(config.slack.signingSecret.length).toBeGreaterThanOrEqual(32); // Validates length rule
        expect(config.slack.appToken).toMatch(/^xapp-/); // Validates format rule
        expect(config.ai.anthropicApiKey).toMatch(/^sk-ant-api03-/); // Validates format rule
        expect(config.ai.model).toBe('claude-3-5-sonnet-20241022'); // Tests default
        expect(config.ai.confidenceThreshold).toBe(0.8); // Tests default
        expect(config.port).toBe(3000); // Tests default
        expect(config.app.nodeEnv).toBe('development'); // Tests default
      } finally {
        fs.unlinkSync(testFile);
      }
    });

    it('should use custom values when provided', async () => {
      // Arrange
      const testFile = process.cwd() + '/test-custom-jenkins.js';
      const fs = require('fs');
      fs.writeFileSync(testFile, 'console.log("test");');
      
      process.env = {
        SLACK_BOT_TOKEN: 'xoxb-custom-token',
        SLACK_SIGNING_SECRET: 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0',
        SLACK_APP_TOKEN: 'xapp-custom-token',
        ANTHROPIC_API_KEY: 'sk-ant-api03-custom-key-abcdef',
        JENKINS_MCP_SERVER_PATH: testFile,
        AI_MODEL: 'claude-3-opus-20240229',
        AI_CONFIDENCE_THRESHOLD: '0.9',
        REDIS_URL: 'redis://custom:6379',
        NODE_ENV: 'production',
        LOG_LEVEL: 'error',
        PORT: '8080',
      };

      try {
        // Act
        const { loadConfig } = await import('../../../src/config/environment');
        const config = loadConfig();

        // Assert - Test that custom values override defaults
        expect(config.ai.model).toBe('claude-3-opus-20240229');
        expect(config.ai.confidenceThreshold).toBe(0.9);
        expect(config.redis.url).toBe('redis://custom:6379');
        expect(config.app.nodeEnv).toBe('production');
        expect(config.app.logLevel).toBe('error');
        expect(config.port).toBe(8080);
      } finally {
        fs.unlinkSync(testFile);
      }
    });

    it('should throw error when SLACK_BOT_TOKEN is missing', async () => {
      // Arrange
      process.env = {
        SLACK_SIGNING_SECRET: 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0',
        SLACK_APP_TOKEN: 'xapp-test-token',
        ANTHROPIC_API_KEY: 'sk-ant-api03-test-key',
        JENKINS_MCP_SERVER_PATH: '/path/to/jenkins.js',
      };

      // Act & Assert
      const { loadConfig } = await import('../../../src/config/environment');
      expect(() => loadConfig()).toThrow(/SLACK_BOT_TOKEN is required/);
    });

    it('should throw error when SLACK_BOT_TOKEN has wrong format', async () => {
      // Arrange
      process.env = {
        SLACK_BOT_TOKEN: 'invalid-token-format',
        SLACK_SIGNING_SECRET: 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0',
        SLACK_APP_TOKEN: 'xapp-test-token',
        ANTHROPIC_API_KEY: 'sk-ant-api03-test-key',
        JENKINS_MCP_SERVER_PATH: '/path/to/jenkins.js',
      };

      // Act & Assert
      const { loadConfig } = await import('../../../src/config/environment');
      expect(() => loadConfig()).toThrow(/SLACK_BOT_TOKEN must start with "xoxb-"/);
    });

    it('should throw error when SLACK_SIGNING_SECRET is too short', async () => {
      // Arrange
      process.env = {
        SLACK_BOT_TOKEN: 'xoxb-test-token',
        SLACK_SIGNING_SECRET: 'short',
        SLACK_APP_TOKEN: 'xapp-test-token',
        ANTHROPIC_API_KEY: 'sk-ant-api03-test-key',
        JENKINS_MCP_SERVER_PATH: '/path/to/jenkins.js',
      };

      // Act & Assert
      const { loadConfig } = await import('../../../src/config/environment');
      expect(() => loadConfig()).toThrow(/SLACK_SIGNING_SECRET must be at least 32 characters/);
    });

    it('should throw error when SLACK_APP_TOKEN has wrong format', async () => {
      // Arrange
      process.env = {
        SLACK_BOT_TOKEN: 'xoxb-test-token',
        SLACK_SIGNING_SECRET: 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0',
        SLACK_APP_TOKEN: 'invalid-app-token',
        ANTHROPIC_API_KEY: 'sk-ant-api03-test-key',
        JENKINS_MCP_SERVER_PATH: '/path/to/jenkins.js',
      };

      // Act & Assert
      const { loadConfig } = await import('../../../src/config/environment');
      expect(() => loadConfig()).toThrow(/SLACK_APP_TOKEN must start with "xapp-"/);
    });

    it('should throw error when ANTHROPIC_API_KEY has wrong format', async () => {
      // Arrange
      process.env = {
        SLACK_BOT_TOKEN: 'xoxb-test-token',
        SLACK_SIGNING_SECRET: 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0',
        SLACK_APP_TOKEN: 'xapp-test-token',
        ANTHROPIC_API_KEY: 'invalid-key',
        JENKINS_MCP_SERVER_PATH: '/path/to/jenkins.js',
      };

      // Act & Assert
      const { loadConfig } = await import('../../../src/config/environment');
      expect(() => loadConfig()).toThrow(/ANTHROPIC_API_KEY must start with "sk-ant-api03-"/);
    });

    it('should throw error when AI_MODEL is invalid', async () => {
      // Arrange
      process.env = {
        SLACK_BOT_TOKEN: 'xoxb-test-token',
        SLACK_SIGNING_SECRET: 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0',
        SLACK_APP_TOKEN: 'xapp-test-token',
        ANTHROPIC_API_KEY: 'sk-ant-api03-test-key',
        JENKINS_MCP_SERVER_PATH: '/path/to/jenkins.js',
        AI_MODEL: 'invalid-model',
      };

      // Act & Assert
      const { loadConfig } = await import('../../../src/config/environment');
      expect(() => loadConfig()).toThrow(/AI_MODEL must be one of/);
    });

    it('should throw error when AI_CONFIDENCE_THRESHOLD is out of range', async () => {
      // Arrange
      process.env = {
        SLACK_BOT_TOKEN: 'xoxb-test-token',
        SLACK_SIGNING_SECRET: 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0',
        SLACK_APP_TOKEN: 'xapp-test-token',
        ANTHROPIC_API_KEY: 'sk-ant-api03-test-key',
        JENKINS_MCP_SERVER_PATH: '/path/to/jenkins.js',
        AI_CONFIDENCE_THRESHOLD: '1.5',
      };

      // Act & Assert
      const { loadConfig } = await import('../../../src/config/environment');
      expect(() => loadConfig()).toThrow(/AI_CONFIDENCE_THRESHOLD must be between 0 and 1/);
    });

    it('should throw error when REDIS_URL is invalid', async () => {
      // Arrange
      process.env = {
        SLACK_BOT_TOKEN: 'xoxb-test-token',
        SLACK_SIGNING_SECRET: 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0',
        SLACK_APP_TOKEN: 'xapp-test-token',
        ANTHROPIC_API_KEY: 'sk-ant-api03-test-key',
        JENKINS_MCP_SERVER_PATH: '/path/to/jenkins.js',
        REDIS_URL: 'invalid-url',
      };

      // Act & Assert
      const { loadConfig } = await import('../../../src/config/environment');
      expect(() => loadConfig()).toThrow(/must be a valid uri with a scheme matching the redis/);
    });

    it('should throw error when PORT is invalid', async () => {
      // Arrange
      process.env = {
        SLACK_BOT_TOKEN: 'xoxb-test-token',
        SLACK_SIGNING_SECRET: 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0',
        SLACK_APP_TOKEN: 'xapp-test-token',
        ANTHROPIC_API_KEY: 'sk-ant-api03-test-key',
        JENKINS_MCP_SERVER_PATH: '/path/to/jenkins.js',
        PORT: '99999',
      };

      // Act & Assert
      const { loadConfig } = await import('../../../src/config/environment');
      expect(() => loadConfig()).toThrow(/PORT must be a valid port number/);
    });

    it('should throw error with multiple validation failures', async () => {
      // Arrange
      process.env = {
        SLACK_BOT_TOKEN: 'invalid',
        SLACK_SIGNING_SECRET: 'short',
        ANTHROPIC_API_KEY: 'invalid',
        JENKINS_MCP_SERVER_PATH: '/path/to/jenkins.js',
      };

      // Act & Assert
      const { loadConfig } = await import('../../../src/config/environment');
      const error = (() => {
        try {
          loadConfig();
          return null;
        } catch (e) {
          return e as Error;
        }
      })();

      expect(error).not.toBeNull();
      expect(error!.message).toContain('Environment validation failed:');
      expect(error!.message).toContain('SLACK_BOT_TOKEN must start with "xoxb-"');
      expect(error!.message).toContain('SLACK_SIGNING_SECRET must be at least 32 characters');
      expect(error!.message).toContain('ANTHROPIC_API_KEY must start with "sk-ant-api03-"');
    });

    it('should validate MCP security configurations', async () => {
      // Arrange
      const testFile = process.cwd() + '/test-mcp-security.js';
      const fs = require('fs');
      fs.writeFileSync(testFile, 'console.log("test");');

      process.env = {
        SLACK_BOT_TOKEN: 'xoxb-test-token',
        SLACK_SIGNING_SECRET: 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0',
        SLACK_APP_TOKEN: 'xapp-test-token',
        ANTHROPIC_API_KEY: 'sk-ant-api03-test-key',
        JENKINS_MCP_SERVER_PATH: testFile,
        JENKINS_MCP_PROCESS_TIMEOUT: '45000',
        JENKINS_MCP_USER_ID: '1001',
        JENKINS_MCP_MAX_MEMORY_MB: '256',
        JENKINS_MCP_ALLOW_RELATIVE_PATHS: 'true',
      };

      try {
        // Act
        const { loadConfig } = await import('../../../src/config/environment');
        const config = loadConfig();

        // Assert - Test MCP security configurations are loaded
        expect(config.mcp.processTimeout).toBe(45000);
        expect(config.mcp.userId).toBe(1001);
        expect(config.mcp.maxMemoryMb).toBe(256);
        expect(config.mcp.allowRelativePaths).toBe(true);
        expect(Array.isArray(config.mcp.allowedPaths)).toBe(true);
      } finally {
        fs.unlinkSync(testFile);
      }
    });

    it('should reject invalid MCP timeout values', async () => {
      // Arrange
      process.env = {
        SLACK_BOT_TOKEN: 'xoxb-test-token',
        SLACK_SIGNING_SECRET: 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0',
        SLACK_APP_TOKEN: 'xapp-test-token',
        ANTHROPIC_API_KEY: 'sk-ant-api03-test-key',
        JENKINS_MCP_SERVER_PATH: '/path/to/jenkins.js',
        JENKINS_MCP_PROCESS_TIMEOUT: '400000', // Too high
      };

      // Act & Assert
      const { loadConfig } = await import('../../../src/config/environment');
      expect(() => loadConfig()).toThrow(/JENKINS_MCP_PROCESS_TIMEOUT must be at most 300000ms/);
    });
  });

  describe('getConfig', () => {
    it('should return the same config instance on multiple calls (singleton pattern)', async () => {
      // Arrange
      process.env = {
        SLACK_BOT_TOKEN: 'xoxb-test-token',
        SLACK_SIGNING_SECRET: 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0',
        SLACK_APP_TOKEN: 'xapp-test-token',
        ANTHROPIC_API_KEY: 'sk-ant-api03-test-key',
        JENKINS_MCP_SERVER_PATH: '/path/to/jenkins.js',
      };

      // Act
      const { getConfig } = await import('../../../src/config/environment');
      const config1 = getConfig();
      const config2 = getConfig();

      // Assert
      expect(config1).toBe(config2);
      expect(config1).toEqual(config2);
    });

    it('should initialize config lazily on first getConfig call', async () => {
      // Arrange
      process.env = {
        SLACK_BOT_TOKEN: 'xoxb-test-token',
        SLACK_SIGNING_SECRET: 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0',
        SLACK_APP_TOKEN: 'xapp-test-token',
        ANTHROPIC_API_KEY: 'sk-ant-api03-test-key',
        JENKINS_MCP_SERVER_PATH: '/path/to/jenkins.js',
      };

      // Act
      const { getConfig } = await import('../../../src/config/environment');
      
      // First call should work
      const config = getConfig();
      expect(config).toBeDefined();
      expect(config.slack.botToken).toBe('xoxb-test-token');

      // Subsequent calls should return the same instance
      const config2 = getConfig();
      expect(config2).toBe(config);
    });

    it('should throw error when environment validation fails', async () => {
      // Arrange
      process.env = {
        SLACK_BOT_TOKEN: 'invalid',
      };

      // Act & Assert
      const { getConfig } = await import('../../../src/config/environment');
      expect(() => getConfig()).toThrow(/Environment validation failed/);
    });
  });
});