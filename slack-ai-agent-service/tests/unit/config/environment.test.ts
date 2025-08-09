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
    it('should successfully validate and return config with all required environment variables', async () => {
      // Arrange
      process.env = {
        SLACK_BOT_TOKEN: 'xoxb-test-token-123456789012',
        SLACK_SIGNING_SECRET: 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0',
        SLACK_APP_TOKEN: 'xapp-test-token-123456789012',
        OPENAI_API_KEY: 'sk-test-key-123456789012',
        JENKINS_MCP_SERVER_PATH: '/path/to/jenkins/server.js',
      };

      // Act
      const { loadConfig } = await import('../../../src/config/environment');
      const config = loadConfig();

      // Assert
      expect(config).toEqual({
        slack: {
          botToken: 'xoxb-test-token-123456789012',
          signingSecret: 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0',
          appToken: 'xapp-test-token-123456789012',
        },
        ai: {
          openaiApiKey: 'sk-test-key-123456789012',
          model: 'gpt-4-turbo',
          confidenceThreshold: 0.8,
        },
        mcp: {
          jenkinsServerPath: '/path/to/jenkins/server.js',
        },
        redis: {
          url: 'redis://localhost:6379',
        },
        app: {
          nodeEnv: 'development',
          logLevel: 'info',
        },
        port: 3000,
      });
    });

    it('should use custom values when provided', async () => {
      // Arrange
      process.env = {
        SLACK_BOT_TOKEN: 'xoxb-custom-token',
        SLACK_SIGNING_SECRET: 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0',
        SLACK_APP_TOKEN: 'xapp-custom-token',
        OPENAI_API_KEY: 'sk-custom-key',
        JENKINS_MCP_SERVER_PATH: '/custom/path/jenkins.js',
        AI_MODEL: 'gpt-4o',
        AI_CONFIDENCE_THRESHOLD: '0.9',
        REDIS_URL: 'redis://custom:6379',
        NODE_ENV: 'production',
        LOG_LEVEL: 'error',
        PORT: '8080',
      };

      // Act
      const { loadConfig } = await import('../../../src/config/environment');
      const config = loadConfig();

      // Assert
      expect(config.ai.model).toBe('gpt-4o');
      expect(config.ai.confidenceThreshold).toBe(0.9);
      expect(config.redis.url).toBe('redis://custom:6379');
      expect(config.app.nodeEnv).toBe('production');
      expect(config.app.logLevel).toBe('error');
      expect(config.port).toBe(8080);
    });

    it('should throw error when SLACK_BOT_TOKEN is missing', async () => {
      // Arrange
      process.env = {
        SLACK_SIGNING_SECRET: 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0',
        SLACK_APP_TOKEN: 'xapp-test-token',
        OPENAI_API_KEY: 'sk-test-key',
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
        OPENAI_API_KEY: 'sk-test-key',
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
        OPENAI_API_KEY: 'sk-test-key',
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
        OPENAI_API_KEY: 'sk-test-key',
        JENKINS_MCP_SERVER_PATH: '/path/to/jenkins.js',
      };

      // Act & Assert
      const { loadConfig } = await import('../../../src/config/environment');
      expect(() => loadConfig()).toThrow(/SLACK_APP_TOKEN must start with "xapp-"/);
    });

    it('should throw error when OPENAI_API_KEY has wrong format', async () => {
      // Arrange
      process.env = {
        SLACK_BOT_TOKEN: 'xoxb-test-token',
        SLACK_SIGNING_SECRET: 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0',
        SLACK_APP_TOKEN: 'xapp-test-token',
        OPENAI_API_KEY: 'invalid-key',
        JENKINS_MCP_SERVER_PATH: '/path/to/jenkins.js',
      };

      // Act & Assert
      const { loadConfig } = await import('../../../src/config/environment');
      expect(() => loadConfig()).toThrow(/OPENAI_API_KEY must start with "sk-"/);
    });

    it('should throw error when AI_MODEL is invalid', async () => {
      // Arrange
      process.env = {
        SLACK_BOT_TOKEN: 'xoxb-test-token',
        SLACK_SIGNING_SECRET: 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0',
        SLACK_APP_TOKEN: 'xapp-test-token',
        OPENAI_API_KEY: 'sk-test-key',
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
        OPENAI_API_KEY: 'sk-test-key',
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
        OPENAI_API_KEY: 'sk-test-key',
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
        OPENAI_API_KEY: 'sk-test-key',
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
        OPENAI_API_KEY: 'invalid',
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
      expect(error!.message).toContain('OPENAI_API_KEY must start with "sk-"');
    });
  });

  describe('getConfig', () => {
    it('should return the same config instance on multiple calls (singleton pattern)', async () => {
      // Arrange
      process.env = {
        SLACK_BOT_TOKEN: 'xoxb-test-token',
        SLACK_SIGNING_SECRET: 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0',
        SLACK_APP_TOKEN: 'xapp-test-token',
        OPENAI_API_KEY: 'sk-test-key',
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
        OPENAI_API_KEY: 'sk-test-key',
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