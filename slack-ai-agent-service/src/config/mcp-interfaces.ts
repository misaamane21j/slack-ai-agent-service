/**
 * Enhanced MCP (Model Context Protocol) configuration interfaces
 * Supports multiple MCP servers with dynamic configuration management
 */

/**
 * Security configuration for MCP server credentials
 */
export interface MCPSecurityConfig {
  /** Encryption key for credential storage */
  encryptionKey?: string;
  /** Whether to use environment variable substitution */
  useEnvSubstitution: boolean;
  /** Allowed environment variable prefixes */
  allowedEnvPrefixes: string[];
  /** Maximum credential expiration time in milliseconds */
  credentialExpiration?: number;
}

/**
 * Health check configuration for MCP servers
 */
export interface MCPHealthConfig {
  /** Enable health checking */
  enabled: boolean;
  /** Health check interval in milliseconds */
  interval: number;
  /** Number of failed checks before marking as unhealthy */
  failureThreshold: number;
  /** Timeout for health check requests */
  timeout: number;
  /** Whether to restart unhealthy servers */
  autoRestart: boolean;
}

/**
 * Resource limits for MCP server processes
 */
export interface MCPResourceLimits {
  /** Maximum memory usage in MB */
  maxMemoryMb?: number;
  /** Maximum CPU percentage (0-100) */
  maxCpuPercent?: number;
  /** Maximum execution time in milliseconds */
  maxExecutionTime?: number;
  /** Maximum file descriptors */
  maxFileDescriptors?: number;
}

/**
 * Retry configuration for MCP server connections
 */
export interface MCPRetryConfig {
  /** Maximum number of retry attempts */
  maxRetries: number;
  /** Initial retry delay in milliseconds */
  initialDelay: number;
  /** Retry delay multiplier for exponential backoff */
  backoffMultiplier: number;
  /** Maximum retry delay in milliseconds */
  maxDelay: number;
  /** Whether to reset retry count on successful operation */
  resetOnSuccess: boolean;
}

/**
 * Enhanced MCP server configuration
 */
export interface MCPServerConfig {
  /** Unique server identifier */
  id: string;
  /** Human-readable server name */
  name: string;
  /** Server description */
  description: string;
  /** Whether the server is enabled */
  enabled: boolean;
  /** Server version for compatibility checking */
  version?: string;
  /** Server priority for tool selection (higher = preferred) */
  priority: number;
  
  // Execution configuration
  /** Command to execute the server */
  command: string;
  /** Command arguments */
  args: string[];
  /** Working directory for the server process */
  workingDirectory?: string;
  /** Environment variables */
  env: Record<string, string>;
  
  // Connection configuration
  /** Connection timeout in milliseconds */
  timeout: number;
  /** Retry configuration */
  retry: MCPRetryConfig;
  /** Health check configuration */
  health: MCPHealthConfig;
  
  // Security and resources
  /** Resource limits */
  resources: MCPResourceLimits;
  /** Security configuration */
  security: MCPSecurityConfig;
  
  // Tool configuration
  /** Supported tool capabilities */
  capabilities: string[];
  /** Tool-specific configuration */
  toolConfig?: Record<string, any>;
  /** Whether to cache tool responses */
  cacheResponses: boolean;
  /** Cache TTL in milliseconds */
  cacheTtl: number;
  
  // Metadata
  /** Tags for categorization */
  tags: string[];
  /** Last modification timestamp */
  lastModified: Date;
  /** Configuration source (file, api, etc.) */
  source: string;
}

/**
 * MCP server registry configuration
 */
export interface MCPRegistryConfig {
  /** Registry update interval in milliseconds */
  updateInterval: number;
  /** Whether to auto-discover new servers */
  autoDiscovery: boolean;
  /** Discovery configuration */
  discovery: {
    /** Directories to scan for MCP servers */
    scanDirectories: string[];
    /** File patterns to match */
    filePatterns: string[];
    /** Whether to scan recursively */
    recursive: boolean;
  };
  /** Default server configuration overrides */
  defaults: Partial<MCPServerConfig>;
}

/**
 * Complete enhanced MCP configuration
 */
export interface EnhancedMCPConfig {
  /** Path to MCP servers configuration file */
  configFile: string;
  /** Whether to watch configuration file for changes */
  watchConfigFile: boolean;
  /** Global connection timeout in milliseconds */
  globalTimeout: number;
  /** Maximum concurrent connections across all servers */
  maxConcurrentConnections: number;
  /** Allowed directories for MCP server executables */
  allowedPaths: string[];
  /** Global process timeout in milliseconds */
  processTimeout: number;
  /** Default user ID to run processes as */
  defaultUserId?: number;
  /** Default group ID to run processes as */
  defaultGroupId?: number;
  /** Whether to allow relative paths */
  allowRelativePaths: boolean;
  /** Global security configuration */
  security: MCPSecurityConfig;
  /** Registry configuration */
  registry: MCPRegistryConfig;
  /** Server configurations */
  servers: Record<string, MCPServerConfig>;
  /** Runtime statistics */
  stats: {
    /** Total successful operations */
    totalOperations: number;
    /** Total failed operations */
    totalFailures: number;
    /** Last successful operation timestamp */
    lastSuccess?: Date;
    /** Last failure timestamp */
    lastFailure?: Date;
  };
}

/**
 * Configuration change event
 */
export interface MCPConfigChangeEvent {
  /** Type of change */
  type: 'server_added' | 'server_removed' | 'server_updated' | 'config_reloaded';
  /** Server ID (if applicable) */
  serverId?: string;
  /** Previous configuration (for updates) */
  previousConfig?: MCPServerConfig;
  /** New configuration */
  newConfig?: MCPServerConfig;
  /** Timestamp of change */
  timestamp: Date;
  /** Source of change */
  source: string;
}

/**
 * Configuration validation result
 */
export interface MCPConfigValidationResult {
  /** Whether configuration is valid */
  valid: boolean;
  /** Validation errors */
  errors: Array<{
    path: string;
    message: string;
    code: string;
  }>;
  /** Validation warnings */
  warnings: Array<{
    path: string;
    message: string;
    code: string;
  }>;
  /** Validated configuration (if valid) */
  config?: EnhancedMCPConfig;
}

/**
 * Default configuration values
 */
export const MCP_CONFIG_DEFAULTS = {
  server: {
    enabled: true,
    priority: 50,
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
      allowedEnvPrefixes: ['MCP_', 'JENKINS_', 'GITHUB_', 'DB_'],
      credentialExpiration: 24 * 60 * 60 * 1000, // 24 hours
    },
    cacheResponses: true,
    cacheTtl: 300000, // 5 minutes
    capabilities: [],
    tags: [],
    source: 'file',
  },
  registry: {
    updateInterval: 60000, // 1 minute
    autoDiscovery: false,
    discovery: {
      scanDirectories: [],
      filePatterns: ['*mcp*.js', '*mcp*.py', '*mcp*.json'],
      recursive: true,
    },
  },
  security: {
    useEnvSubstitution: true,
    allowedEnvPrefixes: ['MCP_', 'JENKINS_', 'GITHUB_', 'DB_', 'API_'],
    credentialExpiration: 24 * 60 * 60 * 1000, // 24 hours
  },
} as const;