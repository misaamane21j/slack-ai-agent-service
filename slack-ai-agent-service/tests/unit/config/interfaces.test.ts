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
          openaiApiKey: 'sk-test-key',
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
      };

      // Type check - this should compile without errors
      expect(config).toBeDefined();
      expect(config.slack.botToken).toBe('xoxb-test-token');
      expect(config.ai.model).toBe('gpt-4-turbo');
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
          openaiApiKey: 'sk-test-key',
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
      };

      // Verify types
      expect(typeof config.slack.botToken).toBe('string');
      expect(typeof config.slack.signingSecret).toBe('string');
      expect(typeof config.slack.appToken).toBe('string');
      expect(typeof config.ai.openaiApiKey).toBe('string');
      expect(typeof config.ai.model).toBe('string');
      expect(typeof config.ai.confidenceThreshold).toBe('number');
      expect(typeof config.mcp.jenkinsServerPath).toBe('string');
      expect(typeof config.redis.url).toBe('string');
      expect(typeof config.app.nodeEnv).toBe('string');
      expect(typeof config.app.logLevel).toBe('string');
      expect(typeof config.port).toBe('number');
    });

    it('should allow valid AI model values', () => {
      const validModels: EnvironmentConfig['ai']['model'][] = [
        'gpt-4-turbo',
        'gpt-4',
        'gpt-3.5-turbo',
        'gpt-4o',
        'gpt-4o-mini'
      ];

      validModels.forEach(model => {
        const config: EnvironmentConfig = {
          slack: {
            botToken: 'xoxb-test-token',
            signingSecret: 'test-signing-secret-32-characters-long',
            appToken: 'xapp-test-token',
          },
          ai: {
            openaiApiKey: 'sk-test-key',
            model,
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
            openaiApiKey: 'sk-test-key',
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
            openaiApiKey: 'sk-test-key',
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
            logLevel,
          },
          port: 3000,
        };

        expect(config.app.logLevel).toBe(logLevel);
      });
    });
  });
});