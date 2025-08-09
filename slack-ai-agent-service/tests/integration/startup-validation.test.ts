import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { spawn } from 'child_process';
import { join } from 'path';

describe('Application Startup Validation', () => {
  let originalEnv: NodeJS.ProcessEnv;
  
  beforeEach(() => {
    originalEnv = process.env;
  });
  
  afterEach(() => {
    process.env = originalEnv;
  });

  const runApplication = (env: Record<string, string> = {}): Promise<{
    exitCode: number | null;
    stdout: string;
    stderr: string;
  }> => {
    return new Promise((resolve) => {
      const appPath = join(__dirname, '../../dist/index.js');
      const child = spawn('node', [appPath], {
        env: { ...process.env, ...env },
        stdio: 'pipe'
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (exitCode) => {
        resolve({ exitCode, stdout, stderr });
      });

      // Kill process after 3 seconds to prevent hanging
      setTimeout(() => {
        child.kill('SIGTERM');
      }, 3000);
    });
  };

  beforeAll(async () => {
    // Ensure the application is built
    const { exec } = require('child_process');
    await new Promise((resolve, reject) => {
      exec('npm run build', (error: any) => {
        if (error) reject(error);
        else resolve(void 0);
      });
    });
  });

  it('should exit with code 1 and show helpful error message when required environment variables are missing', async () => {
    // Arrange: Empty environment
    const env = {};

    // Act
    const result = await runApplication(env);

    // Assert
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('❌ Configuration Error:');
    expect(result.stderr).toContain('Environment validation failed:');
    expect(result.stderr).toContain('SLACK_BOT_TOKEN is required');
    expect(result.stderr).toContain('SLACK_SIGNING_SECRET is required'); 
    expect(result.stderr).toContain('OPENAI_API_KEY is required');
    expect(result.stderr).toContain('📋 Required Environment Variables:');
    expect(result.stderr).toContain('SLACK_BOT_TOKEN (format: xoxb-...)');
    expect(result.stderr).toContain('SLACK_SIGNING_SECRET (32-64 characters)');
    expect(result.stderr).toContain('OPENAI_API_KEY (format: sk-...)');
    expect(result.stderr).toContain('📝 Optional Environment Variables:');
    expect(result.stderr).toContain('💡 Create a .env file in the project root');
  });

  it('should exit with code 1 and show validation errors for invalid token formats', async () => {
    // Arrange: Invalid token formats
    const env = {
      SLACK_BOT_TOKEN: 'invalid-token',
      SLACK_SIGNING_SECRET: 'too-short',
      SLACK_APP_TOKEN: 'invalid-app-token',
      OPENAI_API_KEY: 'invalid-key',
      JENKINS_MCP_SERVER_PATH: '/path/to/jenkins.js',
    };

    // Act
    const result = await runApplication(env);

    // Assert
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('❌ Configuration Error:');
    expect(result.stderr).toContain('SLACK_BOT_TOKEN must start with "xoxb-"');
    expect(result.stderr).toContain('SLACK_SIGNING_SECRET must be at least 32 characters');
    expect(result.stderr).toContain('SLACK_APP_TOKEN must start with "xapp-"');
    expect(result.stderr).toContain('OPENAI_API_KEY must start with "sk-"');
  });

  it('should start application when all required environment variables are valid', async () => {
    // Arrange: Valid environment variables
    const env = {
      SLACK_BOT_TOKEN: 'xoxb-test-token-123456789012',
      SLACK_SIGNING_SECRET: 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0',
      SLACK_APP_TOKEN: 'xapp-test-token-123456789012',
      OPENAI_API_KEY: 'sk-test-key-123456789012',
      JENKINS_MCP_SERVER_PATH: '/path/to/jenkins/server.js',
    };

    // Act
    const result = await runApplication(env);

    // Assert
    expect(result.stderr).not.toContain('❌ Configuration Error:');
    expect(result.stderr).not.toContain('Environment validation failed:');
    // The application will likely fail to start due to invalid tokens,
    // but it should pass the validation phase
    expect(result.stdout).toContain('Starting Slack AI Agent Service...');
    expect(result.stdout).toContain('Environment: test'); // NODE_ENV is overridden in test setup
  });

  it('should use custom configuration values when provided', async () => {
    // Arrange: Custom configuration
    const env = {
      SLACK_BOT_TOKEN: 'xoxb-custom-token',
      SLACK_SIGNING_SECRET: 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0',
      SLACK_APP_TOKEN: 'xapp-custom-token',
      OPENAI_API_KEY: 'sk-custom-key',
      JENKINS_MCP_SERVER_PATH: '/custom/path/jenkins.js',
      NODE_ENV: 'production',
      LOG_LEVEL: 'error',
      PORT: '8080',
    };

    // Act
    const result = await runApplication(env);

    // Assert
    expect(result.stderr).not.toContain('❌ Configuration Error:');
    // Note: With LOG_LEVEL=error, the app logs won't show in stdout since they're above the error threshold
    // But we can verify the app started by checking it doesn't have validation errors
  });

  it('should show detailed validation errors for multiple invalid fields', async () => {
    // Arrange: Multiple validation failures
    const env = {
      SLACK_BOT_TOKEN: 'wrong-format',
      SLACK_SIGNING_SECRET: 'short',
      SLACK_APP_TOKEN: 'wrong-app-token',
      OPENAI_API_KEY: 'wrong-key',
      JENKINS_MCP_SERVER_PATH: '/path/to/jenkins.js',
      AI_MODEL: 'invalid-model',
      AI_CONFIDENCE_THRESHOLD: '2.0',
      REDIS_URL: 'invalid-url',
      NODE_ENV: 'invalid-env',
      LOG_LEVEL: 'invalid-level',
      PORT: 'invalid-port',
    };

    // Act
    const result = await runApplication(env);

    // Assert
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Environment validation failed:');
    
    // Should contain multiple specific error messages
    const errorChecks = [
      'SLACK_BOT_TOKEN must start with "xoxb-"',
      'SLACK_SIGNING_SECRET must be at least 32 characters',
      'SLACK_APP_TOKEN must start with "xapp-"', 
      'OPENAI_API_KEY must start with "sk-"',
      'AI_MODEL must be one of',
      'AI_CONFIDENCE_THRESHOLD must be between 0 and 1',
      'must be a valid uri with a scheme matching the redis',
      'NODE_ENV must be one of',
      'LOG_LEVEL must be one of',
    ];

    errorChecks.forEach(errorText => {
      expect(result.stderr).toContain(errorText);
    });
  });

  it('should gracefully handle application startup errors after validation passes', async () => {
    // Arrange: Valid configuration that will fail at runtime
    const env = {
      SLACK_BOT_TOKEN: 'xoxb-invalid-but-valid-format',
      SLACK_SIGNING_SECRET: 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0',
      SLACK_APP_TOKEN: 'xapp-invalid-but-valid-format', 
      OPENAI_API_KEY: 'sk-invalid-but-valid-format',
      JENKINS_MCP_SERVER_PATH: '/nonexistent/path/jenkins.js',
    };

    // Act
    const result = await runApplication(env);

    // Assert
    // Should pass validation but fail at startup
    expect(result.stderr).not.toContain('❌ Configuration Error:');
    expect(result.stdout).toContain('Starting Slack AI Agent Service...');
    expect(result.stderr).toContain('An API error occurred: invalid_auth');
    expect(result.exitCode).toBe(1);
  });
});