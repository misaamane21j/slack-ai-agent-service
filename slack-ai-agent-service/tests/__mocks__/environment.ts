// Mock environment configuration for tests
export const mockEnvironmentConfig = {
  slack: {
    signingSecret: 'test_signing_secret_32_characters_long',
    botToken: 'xoxb-test-bot-token-12345',
    appToken: 'xapp-test-app-token-12345'
  },
  anthropic: {
    apiKey: 'sk-ant-api03-test-anthropic-key-12345'
  },
  mcp: {
    jenkinsServerPath: process.cwd() + '/test-jenkins-server.js',
    processTimeout: 45000,
    userId: 1001,
    maxMemoryMb: 256,
    allowRelativePaths: true,
    allowedDirectories: ['/usr/local/bin', '/opt/mcp'],
    maxConcurrentConnections: 5,
    defaultNetworkTimeout: 30000
  },
  network: {
    ipWhitelist: ['127.0.0.1', '192.168.1.0/24'],
    enableFirewall: true,
    maxConnectionsPerIp: 10,
    rateLimitWindow: 60000,
    rateLimitRequests: 100
  },
  security: {
    enableRequestValidation: true,
    enableSecureLogging: true,
    logLevel: 'info' as const
  }
};

// Mock environment variables for different test scenarios
export const mockValidEnvVars = {
  SLACK_SIGNING_SECRET: mockEnvironmentConfig.slack.signingSecret,
  SLACK_BOT_TOKEN: mockEnvironmentConfig.slack.botToken,
  SLACK_APP_TOKEN: mockEnvironmentConfig.slack.appToken,
  ANTHROPIC_API_KEY: mockEnvironmentConfig.anthropic.apiKey,
  JENKINS_MCP_SERVER_PATH: mockEnvironmentConfig.mcp.jenkinsServerPath,
  JENKINS_MCP_PROCESS_TIMEOUT: mockEnvironmentConfig.mcp.processTimeout.toString(),
  JENKINS_MCP_USER_ID: mockEnvironmentConfig.mcp.userId.toString(),
  JENKINS_MCP_MAX_MEMORY_MB: mockEnvironmentConfig.mcp.maxMemoryMb.toString(),
  JENKINS_MCP_ALLOW_RELATIVE_PATHS: mockEnvironmentConfig.mcp.allowRelativePaths.toString(),
  NODE_ENV: 'test'
};

export const mockInvalidEnvVars = {
  SLACK_SIGNING_SECRET: 'too_short', // Invalid - too short
  SLACK_BOT_TOKEN: '', // Invalid - empty
  SLACK_APP_TOKEN: 'invalid-format', // Invalid - wrong format
  ANTHROPIC_API_KEY: '', // Invalid - empty
  JENKINS_MCP_SERVER_PATH: '../invalid/path', // Invalid - relative path
  JENKINS_MCP_PROCESS_TIMEOUT: '999999', // Invalid - too high
  NODE_ENV: 'test'
};

// Helper function to set environment variables for tests
export function setTestEnvironment(envVars: Record<string, string>) {
  // Clear existing environment variables
  Object.keys(process.env).forEach(key => {
    if (key.startsWith('SLACK_') || key.startsWith('ANTHROPIC_') || key.startsWith('JENKINS_')) {
      delete process.env[key];
    }
  });
  
  // Set new environment variables
  Object.entries(envVars).forEach(([key, value]) => {
    process.env[key] = value;
  });
}

// Helper function to reset environment to valid state
export function resetToValidEnvironment() {
  setTestEnvironment(mockValidEnvVars);
}

// Helper function to clear all test environment variables
export function clearTestEnvironment() {
  Object.keys(mockValidEnvVars).forEach(key => {
    delete process.env[key];
  });
}

// Helper function to create required test files
export function createTestFiles() {
  const fs = require('fs');
  const jenkinsServerPath = mockEnvironmentConfig.mcp.jenkinsServerPath;
  
  try {
    fs.writeFileSync(jenkinsServerPath, '#!/usr/bin/env node\nconsole.log("test jenkins server");');
    fs.chmodSync(jenkinsServerPath, '755');
  } catch (error) {
    console.warn('Failed to create test Jenkins server file:', error);
  }
}

// Helper function to cleanup test files
export function cleanupTestFiles() {
  const fs = require('fs');
  const jenkinsServerPath = mockEnvironmentConfig.mcp.jenkinsServerPath;
  
  try {
    if (fs.existsSync(jenkinsServerPath)) {
      fs.unlinkSync(jenkinsServerPath);
    }
  } catch (error) {
    console.warn('Failed to cleanup test Jenkins server file:', error);
  }
}