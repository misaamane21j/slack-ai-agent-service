/**
 * Environment configuration interfaces for the Slack AI Agent Service
 */

/**
 * Slack bot configuration
 */
export interface SlackConfig {
  /** Slack bot token for OAuth authentication */
  botToken: string;
  /** Slack signing secret for request verification */
  signingSecret: string;
  /** Slack app token for socket mode connections */
  appToken: string;
}

/**
 * AI service configuration
 */
export interface AIConfig {
  /** Anthropic API key for Claude models */
  anthropicApiKey: string;
  /** AI model to use for processing */
  model: string;
  /** Confidence threshold for AI responses (0-1) */
  confidenceThreshold: number;
}

/**
 * MCP (Model Context Protocol) configuration
 */
export interface MCPConfig {
  /** Path to the Jenkins MCP server executable */
  jenkinsServerPath: string;
  /** Allowed directories for Jenkins MCP server executables */
  allowedPaths: string[];
  /** Process timeout in milliseconds */
  processTimeout: number;
  /** User ID to run the process as (Unix systems only) */
  userId?: number;
  /** Group ID to run the process as (Unix systems only) */
  groupId?: number;
  /** Maximum memory usage in MB */
  maxMemoryMb?: number;
  /** Whether to allow relative paths (development only) */
  allowRelativePaths: boolean;
}

/**
 * Redis configuration
 */
export interface RedisConfig {
  /** Redis connection URL */
  url: string;
}

/**
 * Application configuration
 */
export interface AppConfig {
  /** Node environment (development, production, test) */
  nodeEnv: string;
  /** Log level (error, warn, info, debug) */
  logLevel: string;
}

/**
 * Complete environment configuration
 */
export interface EnvironmentConfig {
  /** Slack bot configuration */
  slack: SlackConfig;
  /** AI service configuration */
  ai: AIConfig;
  /** MCP configuration */
  mcp: MCPConfig;
  /** Redis configuration */
  redis: RedisConfig;
  /** Application configuration */
  app: AppConfig;
  /** HTTP server port */
  port: number;
}