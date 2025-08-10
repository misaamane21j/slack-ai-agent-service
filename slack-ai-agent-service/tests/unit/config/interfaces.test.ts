import { describe, it, expect } from '@jest/globals';
import { EnvironmentConfig } from '../../../src/config/interfaces';

describe('Configuration Interfaces', () => {
  describe('EnvironmentConfig', () => {
    it('should accept a complete configuration object', () => {
      const config: EnvironmentConfig = {
        slack: {
          botToken: 'xoxb-test-token',
          signingSecret: 'test-signing-secret-32-characters-long',
          appToken: 'xapp-test-token',
        },
        ai: {
          anthropicApiKey: 'sk-ant-api03-test-key',
          model: 'claude-3-5-sonnet-20241022',
          confidenceThreshold: 0.8,
        },
        mcp: {
          jenkinsServerPath: '/path/to/jenkins/server.js',
          allowedPaths: ['/path/to/allowed'],
          processTimeout: 30000,
          allowRelativePaths: false,
        },
        redis: {
          url: 'redis://localhost:6379',
        },
        app: {
          nodeEnv: 'development',
          logLevel: 'info',
        },
        port: 3000,
      };

      // Type check - this should compile without errors
      expect(config).toBeDefined();
      expect(config.slack.botToken).toBe('xoxb-test-token');
      expect(config.ai.model).toBe('claude-3-5-sonnet-20241022');
      expect(config.mcp.jenkinsServerPath).toBe('/path/to/jenkins/server.js');
      expect(config.redis.url).toBe('redis://localhost:6379');
      expect(config.app.nodeEnv).toBe('development');
      expect(config.port).toBe(3000);
    });

    it('should enforce correct types for each field', () => {
      // This test primarily serves as a TypeScript compilation check
      const config: EnvironmentConfig = {
        slack: {
          botToken: 'xoxb-test-token',
          signingSecret: 'test-signing-secret-32-characters-long',
          appToken: 'xapp-test-token',
        },
        ai: {
          anthropicApiKey: 'sk-ant-api03-test-key',
          model: 'claude-3-5-sonnet-20241022',
          confidenceThreshold: 0.8,
        },
        mcp: {
          jenkinsServerPath: '/path/to/jenkins/server.js',
          allowedPaths: ['/path/to/allowed'],
          processTimeout: 30000,
          allowRelativePaths: false,
        },
        redis: {
          url: 'redis://localhost:6379',
        },
        app: {
          nodeEnv: 'development',
          logLevel: 'info',
        },
        port: 3000,
      };

      // Verify types
      expect(typeof config.slack.botToken).toBe('string');
      expect(typeof config.slack.signingSecret).toBe('string');
      expect(typeof config.slack.appToken).toBe('string');
      expect(typeof config.ai.anthropicApiKey).toBe('string');
      expect(typeof config.ai.model).toBe('string');
      expect(typeof config.ai.confidenceThreshold).toBe('number');
      expect(typeof config.mcp.jenkinsServerPath).toBe('string');
      expect(Array.isArray(config.mcp.allowedPaths)).toBe(true);
      expect(typeof config.mcp.processTimeout).toBe('number');
      expect(typeof config.mcp.allowRelativePaths).toBe('boolean');
      expect(typeof config.redis.url).toBe('string');
      expect(typeof config.app.nodeEnv).toBe('string');
      expect(typeof config.app.logLevel).toBe('string');
      expect(typeof config.port).toBe('number');
    });

    it('should allow valid AI model values', () => {
      const validModels: EnvironmentConfig['ai']['model'][] = [
        'claude-3-5-sonnet-20241022',
        'claude-3-5-haiku-20241022',
        'claude-3-opus-20240229',
        'claude-3-sonnet-20240229',
        'claude-3-haiku-20240307'
      ];

      validModels.forEach(model => {
        const config: EnvironmentConfig = {
          slack: {
            botToken: 'xoxb-test-token',
            signingSecret: 'test-signing-secret-32-characters-long',
            appToken: 'xapp-test-token',
          },
          ai: {
            anthropicApiKey: 'sk-ant-api03-test-key',
            model,
            confidenceThreshold: 0.8,
          },
          mcp: {
            jenkinsServerPath: '/path/to/jenkins/server.js',
            allowedPaths: ['/path/to/allowed'],
            processTimeout: 30000,
            allowRelativePaths: false,
          },
          redis: {
            url: 'redis://localhost:6379',
          },
          app: {
            nodeEnv: 'development',
            logLevel: 'info',
          },
          port: 3000,
        };

        expect(config.ai.model).toBe(model);
      });
    });

    it('should allow valid node environment values', () => {
      const validEnvs: EnvironmentConfig['app']['nodeEnv'][] = [
        'development',
        'production', 
        'test'
      ];

      validEnvs.forEach(nodeEnv => {
        const config: EnvironmentConfig = {
          slack: {
            botToken: 'xoxb-test-token',
            signingSecret: 'test-signing-secret-32-characters-long',
            appToken: 'xapp-test-token',
          },
          ai: {
            anthropicApiKey: 'sk-ant-api03-test-key',
            model: 'gpt-4-turbo',
            confidenceThreshold: 0.8,
          },
          mcp: {
            jenkinsServerPath: '/path/to/jenkins/server.js',
            allowedPaths: ['/path/to/allowed'],
            processTimeout: 30000,
            allowRelativePaths: false,
          },
          redis: {
            url: 'redis://localhost:6379',
          },
          app: {
            nodeEnv,
            logLevel: 'info',
          },
          port: 3000,
        };

        expect(config.app.nodeEnv).toBe(nodeEnv);
      });
    });

    it('should allow valid log level values', () => {
      const validLogLevels: EnvironmentConfig['app']['logLevel'][] = [
        'error',
        'warn',
        'info',
        'debug'
      ];

      validLogLevels.forEach(logLevel => {
        const config: EnvironmentConfig = {
          slack: {
            botToken: 'xoxb-test-token',
            signingSecret: 'test-signing-secret-32-characters-long',
            appToken: 'xapp-test-token',
          },
          ai: {
            anthropicApiKey: 'sk-ant-api03-test-key',
            model: 'gpt-4-turbo',
            confidenceThreshold: 0.8,
          },
          mcp: {
            jenkinsServerPath: '/path/to/jenkins/server.js',
            allowedPaths: ['/path/to/allowed'],
            processTimeout: 30000,
            allowRelativePaths: false,
          },
          redis: {
            url: 'redis://localhost:6379',
          },
          app: {
            nodeEnv: 'development',
            logLevel,
          },
          port: 3000,
        };

        expect(config.app.logLevel).toBe(logLevel);
      });
    });

    it('should include MCP security configuration fields', () => {
      const config: EnvironmentConfig = {
        slack: {
          botToken: 'xoxb-test-token',
          signingSecret: 'test-signing-secret-32-characters-long',
          appToken: 'xapp-test-token',
        },
        ai: {
          anthropicApiKey: 'sk-ant-api03-test-key',
          model: 'claude-3-5-sonnet-20241022',
          confidenceThreshold: 0.8,
        },
        mcp: {
          jenkinsServerPath: '/path/to/jenkins/server.js',
          allowedPaths: ['/opt/jenkins', '/usr/local/jenkins'],
          processTimeout: 45000,
          userId: 1001,
          groupId: 1001,
          maxMemoryMb: 512,
          allowRelativePaths: true,
        },
        redis: {
          url: 'redis://localhost:6379',
        },
        app: {
          nodeEnv: 'development',
          logLevel: 'info',
        },
        port: 3000,
      };

      // Verify MCP security fields
      expect(Array.isArray(config.mcp.allowedPaths)).toBe(true);
      expect(config.mcp.allowedPaths.length).toBe(2);
      expect(typeof config.mcp.processTimeout).toBe('number');
      expect(config.mcp.processTimeout).toBe(45000);
      expect(typeof config.mcp.userId).toBe('number');
      expect(config.mcp.userId).toBe(1001);
      expect(typeof config.mcp.groupId).toBe('number');
      expect(config.mcp.groupId).toBe(1001);
      expect(typeof config.mcp.maxMemoryMb).toBe('number');
      expect(config.mcp.maxMemoryMb).toBe(512);
      expect(typeof config.mcp.allowRelativePaths).toBe('boolean');
      expect(config.mcp.allowRelativePaths).toBe(true);
    });
  });
});