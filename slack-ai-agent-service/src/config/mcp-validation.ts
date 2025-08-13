/**
 * Joi validation schemas for enhanced MCP configuration
 */

import Joi from 'joi';
import { EnhancedMCPConfig, MCPServerConfig, MCPConfigValidationResult, MCP_CONFIG_DEFAULTS } from './mcp-interfaces';

/**
 * Security configuration schema
 */
const MCPSecurityConfigSchema = Joi.object({
  encryptionKey: Joi.string().min(32).max(256).optional(),
  useEnvSubstitution: Joi.boolean().default(true),
  allowedEnvPrefixes: Joi.array()
    .items(Joi.string().min(1).max(50))
    .default(MCP_CONFIG_DEFAULTS.security.allowedEnvPrefixes),
  credentialExpiration: Joi.number()
    .integer()
    .min(60000) // 1 minute minimum
    .max(7 * 24 * 60 * 60 * 1000) // 7 days maximum
    .optional()
    .default(MCP_CONFIG_DEFAULTS.security.credentialExpiration),
});

/**
 * Health check configuration schema
 */
const MCPHealthConfigSchema = Joi.object({
  enabled: Joi.boolean().default(true),
  interval: Joi.number()
    .integer()
    .min(5000) // 5 seconds minimum
    .max(300000) // 5 minutes maximum
    .default(MCP_CONFIG_DEFAULTS.server.health.interval),
  failureThreshold: Joi.number()
    .integer()
    .min(1)
    .max(10)
    .default(MCP_CONFIG_DEFAULTS.server.health.failureThreshold),
  timeout: Joi.number()
    .integer()
    .min(1000) // 1 second minimum
    .max(30000) // 30 seconds maximum
    .default(MCP_CONFIG_DEFAULTS.server.health.timeout),
  autoRestart: Joi.boolean().default(true),
});

/**
 * Resource limits schema
 */
const MCPResourceLimitsSchema = Joi.object({
  maxMemoryMb: Joi.number()
    .integer()
    .min(64) // 64MB minimum
    .max(8192) // 8GB maximum
    .optional()
    .default(MCP_CONFIG_DEFAULTS.server.resources.maxMemoryMb),
  maxCpuPercent: Joi.number()
    .integer()
    .min(1)
    .max(100)
    .optional()
    .default(MCP_CONFIG_DEFAULTS.server.resources.maxCpuPercent),
  maxExecutionTime: Joi.number()
    .integer()
    .min(5000) // 5 seconds minimum
    .max(3600000) // 1 hour maximum
    .optional()
    .default(MCP_CONFIG_DEFAULTS.server.resources.maxExecutionTime),
  maxFileDescriptors: Joi.number()
    .integer()
    .min(64)
    .max(65536)
    .optional()
    .default(MCP_CONFIG_DEFAULTS.server.resources.maxFileDescriptors),
});

/**
 * Retry configuration schema
 */
const MCPRetryConfigSchema = Joi.object({
  maxRetries: Joi.number()
    .integer()
    .min(0)
    .max(10)
    .default(MCP_CONFIG_DEFAULTS.server.retry.maxRetries),
  initialDelay: Joi.number()
    .integer()
    .min(100) // 100ms minimum
    .max(60000) // 1 minute maximum
    .default(MCP_CONFIG_DEFAULTS.server.retry.initialDelay),
  backoffMultiplier: Joi.number()
    .min(1)
    .max(5)
    .default(MCP_CONFIG_DEFAULTS.server.retry.backoffMultiplier),
  maxDelay: Joi.number()
    .integer()
    .min(1000) // 1 second minimum
    .max(300000) // 5 minutes maximum
    .default(MCP_CONFIG_DEFAULTS.server.retry.maxDelay),
  resetOnSuccess: Joi.boolean().default(true),
});

/**
 * MCP server configuration schema
 */
const MCPServerConfigSchema = Joi.object({
  id: Joi.string()
    .pattern(/^[a-zA-Z0-9-_]+$/)
    .min(1)
    .max(50)
    .required()
    .messages({
      'string.pattern.base': 'Server ID must contain only alphanumeric characters, hyphens, and underscores',
    }),
  name: Joi.string().min(1).max(100).required(),
  description: Joi.string().min(1).max(500).required(),
  enabled: Joi.boolean().default(true),
  version: Joi.string()
    .pattern(/^\d+\.\d+\.\d+(-[\w\.-]+)?$/)
    .optional()
    .messages({
      'string.pattern.base': 'Version must follow semantic versioning (e.g., 1.0.0)',
    }),
  priority: Joi.number()
    .integer()
    .min(0)
    .max(100)
    .default(MCP_CONFIG_DEFAULTS.server.priority),
  
  // Execution configuration
  command: Joi.string().min(1).required(),
  args: Joi.array().items(Joi.string()).default([]),
  workingDirectory: Joi.string().optional(),
  env: Joi.object().pattern(
    Joi.string().pattern(/^[A-Z_][A-Z0-9_]*$/),
    Joi.string()
  ).default({}),
  
  // Connection configuration
  timeout: Joi.number()
    .integer()
    .min(5000) // 5 seconds minimum
    .max(300000) // 5 minutes maximum
    .default(MCP_CONFIG_DEFAULTS.server.timeout),
  retry: MCPRetryConfigSchema.default(MCP_CONFIG_DEFAULTS.server.retry),
  health: MCPHealthConfigSchema.default(MCP_CONFIG_DEFAULTS.server.health),
  
  // Security and resources
  resources: MCPResourceLimitsSchema.default(MCP_CONFIG_DEFAULTS.server.resources),
  security: MCPSecurityConfigSchema.default(MCP_CONFIG_DEFAULTS.server.security),
  
  // Tool configuration
  capabilities: Joi.array()
    .items(Joi.string().min(1).max(100))
    .default([]),
  toolConfig: Joi.object().optional(),
  cacheResponses: Joi.boolean().default(true),
  cacheTtl: Joi.number()
    .integer()
    .min(0) // 0 = no cache
    .max(24 * 60 * 60 * 1000) // 24 hours maximum
    .default(MCP_CONFIG_DEFAULTS.server.cacheTtl),
  
  // Metadata
  tags: Joi.array()
    .items(Joi.string().min(1).max(50))
    .default([]),
  lastModified: Joi.date().default(() => new Date()),
  source: Joi.string()
    .valid('file', 'api', 'discovery', 'migration')
    .default('file'),
});

/**
 * Registry configuration schema
 */
const MCPRegistryConfigSchema = Joi.object({
  updateInterval: Joi.number()
    .integer()
    .min(10000) // 10 seconds minimum
    .max(600000) // 10 minutes maximum
    .default(MCP_CONFIG_DEFAULTS.registry.updateInterval),
  autoDiscovery: Joi.boolean().default(false),
  discovery: Joi.object({
    scanDirectories: Joi.array()
      .items(Joi.string().min(1))
      .default([]),
    filePatterns: Joi.array()
      .items(Joi.string().min(1))
      .default(MCP_CONFIG_DEFAULTS.registry.discovery.filePatterns),
    recursive: Joi.boolean().default(true),
  }).default(MCP_CONFIG_DEFAULTS.registry.discovery),
  defaults: MCPServerConfigSchema.fork(['id', 'name', 'description', 'command'], schema => schema.optional()),
});

/**
 * Enhanced MCP configuration schema
 */
const EnhancedMCPConfigSchema = Joi.object({
  configFile: Joi.string().min(1).required(),
  watchConfigFile: Joi.boolean().default(true),
  globalTimeout: Joi.number()
    .integer()
    .min(5000) // 5 seconds minimum
    .max(600000) // 10 minutes maximum
    .default(30000),
  maxConcurrentConnections: Joi.number()
    .integer()
    .min(1)
    .max(100)
    .default(10),
  allowedPaths: Joi.array()
    .items(Joi.string().min(1))
    .min(1)
    .required(),
  processTimeout: Joi.number()
    .integer()
    .min(5000) // 5 seconds minimum
    .max(3600000) // 1 hour maximum
    .default(30000),
  defaultUserId: Joi.number()
    .integer()
    .min(1000)
    .optional(),
  defaultGroupId: Joi.number()
    .integer()
    .min(1000)
    .optional(),
  allowRelativePaths: Joi.boolean().default(false),
  security: MCPSecurityConfigSchema.default(MCP_CONFIG_DEFAULTS.security),
  registry: MCPRegistryConfigSchema.default(MCP_CONFIG_DEFAULTS.registry),
  servers: Joi.object()
    .pattern(Joi.string(), MCPServerConfigSchema)
    .default({}),
  stats: Joi.object({
    totalOperations: Joi.number().integer().min(0).default(0),
    totalFailures: Joi.number().integer().min(0).default(0),
    lastSuccess: Joi.date().optional(),
    lastFailure: Joi.date().optional(),
  }).default({
    totalOperations: 0,
    totalFailures: 0,
  }),
});

/**
 * Validate MCP server configuration
 */
export function validateMCPServerConfig(config: any): MCPConfigValidationResult {
  const { error, value } = MCPServerConfigSchema.validate(config, {
    abortEarly: false,
    stripUnknown: true,
    allowUnknown: false,
  });

  if (error) {
    return {
      valid: false,
      errors: error.details.map(detail => ({
        path: detail.path.join('.'),
        message: detail.message,
        code: detail.type,
      })),
      warnings: [],
    };
  }

  return {
    valid: true,
    errors: [],
    warnings: [],
    config: value,
  };
}

/**
 * Validate complete enhanced MCP configuration
 */
export function validateEnhancedMCPConfig(config: any): MCPConfigValidationResult {
  const { error, value, warning } = EnhancedMCPConfigSchema.validate(config, {
    abortEarly: false,
    stripUnknown: true,
    allowUnknown: false,
    warnings: true,
  });

  const warnings = warning ? warning.details.map(detail => ({
    path: detail.path.join('.'),
    message: detail.message,
    code: detail.type,
  })) : [];

  if (error) {
    return {
      valid: false,
      errors: error.details.map(detail => ({
        path: detail.path.join('.'),
        message: detail.message,
        code: detail.type,
      })),
      warnings,
    };
  }

  // Additional validation rules
  const additionalErrors: Array<{ path: string; message: string; code: string }> = [];
  
  // Validate server IDs are unique
  const serverIds = Object.keys(value.servers);
  const uniqueIds = new Set(serverIds);
  if (serverIds.length !== uniqueIds.size) {
    additionalErrors.push({
      path: 'servers',
      message: 'Server IDs must be unique',
      code: 'duplicate.serverIds',
    });
  }

  // Validate server priorities don't conflict
  const enabledServers = Object.values(value.servers).filter((server: any) => server.enabled);
  const priorities = enabledServers.map((server: any) => server.priority);
  const duplicatePriorities = priorities.filter((priority, index) => priorities.indexOf(priority) !== index);
  if (duplicatePriorities.length > 0) {
    warnings.push({
      path: 'servers',
      message: `Duplicate server priorities found: ${duplicatePriorities.join(', ')}. This may affect tool selection`,
      code: 'duplicate.priorities',
    });
  }

  // Validate environment variable substitution
  Object.entries(value.servers).forEach(([serverId, server]: [string, any]) => {
    if (server.security.useEnvSubstitution) {
      Object.entries(server.env).forEach(([key, envValue]) => {
        if (typeof envValue === 'string' && envValue.includes('${')) {
          const matches = envValue.match(/\$\{([^}]+)\}/g);
          if (matches) {
            matches.forEach(match => {
              const varName = match.slice(2, -1);
              const hasValidPrefix = server.security.allowedEnvPrefixes.some((prefix: string) => 
                varName.startsWith(prefix)
              );
              if (!hasValidPrefix) {
                additionalErrors.push({
                  path: `servers.${serverId}.env.${key}`,
                  message: `Environment variable ${varName} does not have an allowed prefix`,
                  code: 'security.invalidEnvPrefix',
                });
              }
            });
          }
        }
      });
    }
  });

  if (additionalErrors.length > 0) {
    return {
      valid: false,
      errors: additionalErrors,
      warnings,
    };
  }

  return {
    valid: true,
    errors: [],
    warnings,
    config: value as EnhancedMCPConfig,
  };
}

/**
 * Create default MCP server configuration
 */
export function createDefaultMCPServerConfig(id: string, overrides: Partial<MCPServerConfig> = {}): MCPServerConfig {
  const defaultConfig = {
    id,
    name: `${id} Server`,
    description: `MCP server for ${id}`,
    enabled: true,
    priority: 50,
    command: 'node',
    args: [`${id}-server.js`],
    env: {},
    timeout: 30000,
    retry: { ...MCP_CONFIG_DEFAULTS.server.retry },
    health: { ...MCP_CONFIG_DEFAULTS.server.health },
    resources: { ...MCP_CONFIG_DEFAULTS.server.resources },
    security: { ...MCP_CONFIG_DEFAULTS.server.security },
    capabilities: [],
    cacheResponses: true,
    cacheTtl: 300000,
    tags: [],
    lastModified: new Date(),
    source: 'api',
    ...overrides,
  };

  const validation = validateMCPServerConfig(defaultConfig);
  if (!validation.valid) {
    throw new Error(`Invalid default configuration: ${validation.errors.map(e => e.message).join(', ')}`);
  }

  return validation.config as MCPServerConfig;
}

export {
  MCPServerConfigSchema,
  EnhancedMCPConfigSchema,
  MCPSecurityConfigSchema,
  MCPHealthConfigSchema,
  MCPResourceLimitsSchema,
  MCPRetryConfigSchema,
  MCPRegistryConfigSchema,
};