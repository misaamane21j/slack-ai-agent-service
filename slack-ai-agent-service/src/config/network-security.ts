/**
 * Network Security Configuration Interface
 * Provides comprehensive network security configuration including IP whitelisting,
 * rate limiting, TLS enforcement, and firewall integration
 */

import { logger } from '../utils/logger';
import Joi from 'joi';

/**
 * Rate limiting configuration
 */
export interface RateLimitConfig {
  /** Enable rate limiting */
  enabled: boolean;
  /** Maximum requests per window */
  maxRequests: number;
  /** Time window in milliseconds */
  windowMs: number;
  /** Delay between requests in milliseconds */
  delayMs?: number;
  /** Skip rate limiting for whitelisted IPs */
  skipWhitelisted: boolean;
  /** Custom error message for rate limit exceeded */
  message?: string;
  /** Headers to include in rate limit response */
  headers: {
    /** Include remaining requests header */
    includeRemaining: boolean;
    /** Include reset time header */
    includeResetTime: boolean;
    /** Include retry after header */
    includeRetryAfter: boolean;
  };
}

/**
 * TLS/Encryption configuration
 */
export interface TLSConfig {
  /** Enforce HTTPS for all connections */
  enforceHTTPS: boolean;
  /** Minimum TLS version */
  minVersion: '1.0' | '1.1' | '1.2' | '1.3';
  /** Allowed cipher suites */
  allowedCiphers?: string[];
  /** Certificate validation mode */
  certificateValidation: 'strict' | 'permissive' | 'disabled';
  /** Enable HSTS (HTTP Strict Transport Security) */
  enableHSTS: boolean;
  /** HSTS max age in seconds */
  hstsMaxAge: number;
  /** Include HSTS subdomains */
  hstsIncludeSubdomains: boolean;
}

/**
 * IP whitelisting configuration
 */
export interface IPWhitelistConfig {
  /** Enable IP whitelisting */
  enabled: boolean;
  /** Allowed individual IP addresses */
  allowedIPs: string[];
  /** Allowed CIDR ranges */
  allowedRanges: string[];
  /** Default action when IP is not whitelisted */
  defaultAction: 'block' | 'log' | 'warn';
  /** Custom rejection message */
  rejectionMessage?: string;
  /** Enable reverse proxy IP detection */
  trustProxy: boolean;
  /** Headers to check for real IP */
  proxyHeaders: string[];
}

/**
 * Firewall integration configuration
 */
export interface FirewallConfig {
  /** Enable firewall integration */
  enabled: boolean;
  /** Firewall type */
  type: 'iptables' | 'ufw' | 'pf' | 'windows' | 'custom';
  /** Custom firewall command templates */
  customCommands?: {
    /** Command to block an IP */
    block: string;
    /** Command to unblock an IP */
    unblock: string;
    /** Command to list blocked IPs */
    list: string;
  };
  /** Automatic IP blocking */
  autoBlock: {
    /** Enable automatic blocking */
    enabled: boolean;
    /** Threshold for failed attempts */
    failureThreshold: number;
    /** Time window for counting failures (ms) */
    windowMs: number;
    /** Block duration in milliseconds */
    blockDurationMs: number;
    /** Maximum number of blocked IPs */
    maxBlockedIPs: number;
  };
}

/**
 * Security event logging configuration
 */
export interface SecurityLoggingConfig {
  /** Enable security event logging */
  enabled: boolean;
  /** Log level for security events */
  level: 'debug' | 'info' | 'warn' | 'error';
  /** Include request details in logs */
  includeRequestDetails: boolean;
  /** Include response details in logs */
  includeResponseDetails: boolean;
  /** Log file path (optional, uses default logger if not specified) */
  logFile?: string;
  /** Send security alerts to monitoring system */
  alerting: {
    /** Enable alerting */
    enabled: boolean;
    /** Alert threshold for events per minute */
    threshold: number;
    /** Alert cooldown period in minutes */
    cooldownMinutes: number;
  };
}

/**
 * Complete network security configuration
 */
export interface NetworkSecurityConfig {
  /** IP whitelisting configuration */
  ipWhitelist: IPWhitelistConfig;
  /** Rate limiting configuration */
  rateLimit: RateLimitConfig;
  /** TLS/encryption configuration */
  tls: TLSConfig;
  /** Firewall integration configuration */
  firewall: FirewallConfig;
  /** Security logging configuration */
  logging: SecurityLoggingConfig;
  /** Global security settings */
  global: {
    /** Enable all security features */
    enabled: boolean;
    /** Security mode: 'strict', 'balanced', 'permissive' */
    mode: 'strict' | 'balanced' | 'permissive';
    /** Allow localhost connections to bypass security */
    allowLocalhost: boolean;
    /** Allow private network ranges */
    allowPrivateNetworks: boolean;
  };
}

/**
 * Default network security configuration
 */
export const DEFAULT_SECURITY_CONFIG: NetworkSecurityConfig = {
  global: {
    enabled: true,
    mode: 'balanced',
    allowLocalhost: true,
    allowPrivateNetworks: false,
  },
  ipWhitelist: {
    enabled: false, // Disabled by default for easier setup
    allowedIPs: [],
    allowedRanges: [],
    defaultAction: 'block',
    rejectionMessage: 'Access denied: IP address not in whitelist',
    trustProxy: true,
    proxyHeaders: ['x-forwarded-for', 'x-real-ip', 'x-client-ip'],
  },
  rateLimit: {
    enabled: true,
    maxRequests: 100,
    windowMs: 60000, // 1 minute
    delayMs: 0,
    skipWhitelisted: true,
    message: 'Too many requests, please try again later',
    headers: {
      includeRemaining: true,
      includeResetTime: true,
      includeRetryAfter: true,
    },
  },
  tls: {
    enforceHTTPS: false, // Allow HTTP for development
    minVersion: '1.2',
    certificateValidation: 'strict',
    enableHSTS: false,
    hstsMaxAge: 31536000, // 1 year
    hstsIncludeSubdomains: true,
  },
  firewall: {
    enabled: false,
    type: 'iptables',
    autoBlock: {
      enabled: false,
      failureThreshold: 10,
      windowMs: 300000, // 5 minutes
      blockDurationMs: 3600000, // 1 hour
      maxBlockedIPs: 1000,
    },
  },
  logging: {
    enabled: true,
    level: 'info',
    includeRequestDetails: true,
    includeResponseDetails: false,
    alerting: {
      enabled: false,
      threshold: 50,
      cooldownMinutes: 15,
    },
  },
};

/**
 * Joi schema for network security configuration validation
 */
const NetworkSecurityConfigSchema = Joi.object<NetworkSecurityConfig>({
  global: Joi.object({
    enabled: Joi.boolean().required(),
    mode: Joi.string().valid('strict', 'balanced', 'permissive').required(),
    allowLocalhost: Joi.boolean().required(),
    allowPrivateNetworks: Joi.boolean().required(),
  }).required(),

  ipWhitelist: Joi.object({
    enabled: Joi.boolean().required(),
    allowedIPs: Joi.array().items(Joi.string().ip()).required(),
    allowedRanges: Joi.array().items(
      Joi.string().pattern(/^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$|^([0-9a-fA-F:]+)\/\d{1,3}$/)
    ).required(),
    defaultAction: Joi.string().valid('block', 'log', 'warn').required(),
    rejectionMessage: Joi.string().optional(),
    trustProxy: Joi.boolean().required(),
    proxyHeaders: Joi.array().items(Joi.string()).required(),
  }).required(),

  rateLimit: Joi.object({
    enabled: Joi.boolean().required(),
    maxRequests: Joi.number().integer().min(1).required(),
    windowMs: Joi.number().integer().min(1000).required(),
    delayMs: Joi.number().integer().min(0).optional(),
    skipWhitelisted: Joi.boolean().required(),
    message: Joi.string().optional(),
    headers: Joi.object({
      includeRemaining: Joi.boolean().required(),
      includeResetTime: Joi.boolean().required(),
      includeRetryAfter: Joi.boolean().required(),
    }).required(),
  }).required(),

  tls: Joi.object({
    enforceHTTPS: Joi.boolean().required(),
    minVersion: Joi.string().valid('1.0', '1.1', '1.2', '1.3').required(),
    allowedCiphers: Joi.array().items(Joi.string()).optional(),
    certificateValidation: Joi.string().valid('strict', 'permissive', 'disabled').required(),
    enableHSTS: Joi.boolean().required(),
    hstsMaxAge: Joi.number().integer().min(0).required(),
    hstsIncludeSubdomains: Joi.boolean().required(),
  }).required(),

  firewall: Joi.object({
    enabled: Joi.boolean().required(),
    type: Joi.string().valid('iptables', 'ufw', 'pf', 'windows', 'custom').required(),
    customCommands: Joi.object({
      block: Joi.string().required(),
      unblock: Joi.string().required(),
      list: Joi.string().required(),
    }).when('type', { is: 'custom', then: Joi.required(), otherwise: Joi.optional() }),
    autoBlock: Joi.object({
      enabled: Joi.boolean().required(),
      failureThreshold: Joi.number().integer().min(1).required(),
      windowMs: Joi.number().integer().min(1000).required(),
      blockDurationMs: Joi.number().integer().min(1000).required(),
      maxBlockedIPs: Joi.number().integer().min(1).required(),
    }).required(),
  }).required(),

  logging: Joi.object({
    enabled: Joi.boolean().required(),
    level: Joi.string().valid('debug', 'info', 'warn', 'error').required(),
    includeRequestDetails: Joi.boolean().required(),
    includeResponseDetails: Joi.boolean().required(),
    logFile: Joi.string().optional(),
    alerting: Joi.object({
      enabled: Joi.boolean().required(),
      threshold: Joi.number().integer().min(1).required(),
      cooldownMinutes: Joi.number().integer().min(1).required(),
    }).required(),
  }).required(),
});

/**
 * Validate network security configuration
 */
export function validateNetworkSecurityConfig(config: unknown): {
  valid: boolean;
  config?: NetworkSecurityConfig;
  errors: Array<{ path: string; message: string }>;
} {
  const { error, value } = NetworkSecurityConfigSchema.validate(config, {
    abortEarly: false,
    allowUnknown: false,
  });

  if (error) {
    const errors = error.details.map(detail => ({
      path: detail.path.join('.'),
      message: detail.message,
    }));

    logger().error('Network security configuration validation failed', { errors });

    return {
      valid: false,
      errors,
    };
  }

  return {
    valid: true,
    config: value,
    errors: [],
  };
}

/**
 * Load network security configuration from environment variables
 */
export function loadNetworkSecurityFromEnvironment(): NetworkSecurityConfig {
  const config = { ...DEFAULT_SECURITY_CONFIG };

  try {
    // Global settings
    if (process.env.SECURITY_ENABLED !== undefined) {
      config.global.enabled = process.env.SECURITY_ENABLED.toLowerCase() === 'true';
    }
    if (process.env.SECURITY_MODE) {
      config.global.mode = process.env.SECURITY_MODE as 'strict' | 'balanced' | 'permissive';
    }
    if (process.env.SECURITY_ALLOW_LOCALHOST !== undefined) {
      config.global.allowLocalhost = process.env.SECURITY_ALLOW_LOCALHOST.toLowerCase() === 'true';
    }
    if (process.env.SECURITY_ALLOW_PRIVATE !== undefined) {
      config.global.allowPrivateNetworks = process.env.SECURITY_ALLOW_PRIVATE.toLowerCase() === 'true';
    }

    // IP Whitelist settings
    if (process.env.IP_WHITELIST_ENABLED !== undefined) {
      config.ipWhitelist.enabled = process.env.IP_WHITELIST_ENABLED.toLowerCase() === 'true';
    }
    if (process.env.IP_WHITELIST_IPS) {
      config.ipWhitelist.allowedIPs = process.env.IP_WHITELIST_IPS.split(',').map(ip => ip.trim());
    }
    if (process.env.IP_WHITELIST_RANGES) {
      config.ipWhitelist.allowedRanges = process.env.IP_WHITELIST_RANGES.split(',').map(range => range.trim());
    }
    if (process.env.IP_WHITELIST_ACTION) {
      config.ipWhitelist.defaultAction = process.env.IP_WHITELIST_ACTION as 'block' | 'log' | 'warn';
    }
    if (process.env.IP_WHITELIST_MESSAGE) {
      config.ipWhitelist.rejectionMessage = process.env.IP_WHITELIST_MESSAGE;
    }

    // Rate limiting settings
    if (process.env.RATE_LIMIT_ENABLED !== undefined) {
      config.rateLimit.enabled = process.env.RATE_LIMIT_ENABLED.toLowerCase() === 'true';
    }
    if (process.env.RATE_LIMIT_MAX_REQUESTS) {
      config.rateLimit.maxRequests = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10);
    }
    if (process.env.RATE_LIMIT_WINDOW_MS) {
      config.rateLimit.windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10);
    }
    if (process.env.RATE_LIMIT_DELAY_MS) {
      config.rateLimit.delayMs = parseInt(process.env.RATE_LIMIT_DELAY_MS, 10);
    }

    // TLS settings
    if (process.env.TLS_ENFORCE_HTTPS !== undefined) {
      config.tls.enforceHTTPS = process.env.TLS_ENFORCE_HTTPS.toLowerCase() === 'true';
    }
    if (process.env.TLS_MIN_VERSION) {
      config.tls.minVersion = process.env.TLS_MIN_VERSION as '1.0' | '1.1' | '1.2' | '1.3';
    }
    if (process.env.TLS_ENABLE_HSTS !== undefined) {
      config.tls.enableHSTS = process.env.TLS_ENABLE_HSTS.toLowerCase() === 'true';
    }

    // Firewall settings
    if (process.env.FIREWALL_ENABLED !== undefined) {
      config.firewall.enabled = process.env.FIREWALL_ENABLED.toLowerCase() === 'true';
    }
    if (process.env.FIREWALL_TYPE) {
      config.firewall.type = process.env.FIREWALL_TYPE as 'iptables' | 'ufw' | 'pf' | 'windows' | 'custom';
    }
    if (process.env.FIREWALL_AUTO_BLOCK !== undefined) {
      config.firewall.autoBlock.enabled = process.env.FIREWALL_AUTO_BLOCK.toLowerCase() === 'true';
    }

    // Logging settings
    if (process.env.SECURITY_LOGGING_ENABLED !== undefined) {
      config.logging.enabled = process.env.SECURITY_LOGGING_ENABLED.toLowerCase() === 'true';
    }
    if (process.env.SECURITY_LOGGING_LEVEL) {
      config.logging.level = process.env.SECURITY_LOGGING_LEVEL as 'debug' | 'info' | 'warn' | 'error';
    }

    logger().info('Loaded network security configuration from environment', {
      globalEnabled: config.global.enabled,
      ipWhitelistEnabled: config.ipWhitelist.enabled,
      rateLimitEnabled: config.rateLimit.enabled,
      tlsEnforced: config.tls.enforceHTTPS,
      firewallEnabled: config.firewall.enabled,
    });

  } catch (error) {
    logger().error('Error loading network security configuration from environment', { error });
    logger().info('Using default network security configuration');
  }

  return config;
}

/**
 * Apply security mode presets
 */
export function applySecurityMode(config: NetworkSecurityConfig, mode: 'strict' | 'balanced' | 'permissive'): NetworkSecurityConfig {
  const newConfig = { ...config };
  newConfig.global.mode = mode;

  switch (mode) {
    case 'strict':
      newConfig.ipWhitelist.enabled = true;
      newConfig.ipWhitelist.defaultAction = 'block';
      newConfig.rateLimit.enabled = true;
      newConfig.rateLimit.maxRequests = 50;
      newConfig.rateLimit.windowMs = 60000;
      newConfig.tls.enforceHTTPS = true;
      newConfig.tls.minVersion = '1.3';
      newConfig.tls.certificateValidation = 'strict';
      newConfig.tls.enableHSTS = true;
      newConfig.firewall.enabled = true;
      newConfig.firewall.autoBlock.enabled = true;
      newConfig.logging.level = 'info';
      newConfig.logging.alerting.enabled = true;
      break;

    case 'balanced':
      newConfig.ipWhitelist.enabled = false; // Allow configuration via environment
      newConfig.rateLimit.enabled = true;
      newConfig.rateLimit.maxRequests = 100;
      newConfig.rateLimit.windowMs = 60000;
      newConfig.tls.enforceHTTPS = false; // Allow HTTP for development
      newConfig.tls.minVersion = '1.2';
      newConfig.tls.certificateValidation = 'strict';
      newConfig.firewall.enabled = false; // Manual configuration
      newConfig.firewall.autoBlock.enabled = false;
      newConfig.logging.level = 'info';
      newConfig.logging.alerting.enabled = false;
      break;

    case 'permissive':
      newConfig.ipWhitelist.enabled = false;
      newConfig.ipWhitelist.defaultAction = 'log';
      newConfig.rateLimit.enabled = true;
      newConfig.rateLimit.maxRequests = 1000;
      newConfig.rateLimit.windowMs = 60000;
      newConfig.tls.enforceHTTPS = false;
      newConfig.tls.minVersion = '1.1';
      newConfig.tls.certificateValidation = 'permissive';
      newConfig.tls.enableHSTS = false;
      newConfig.firewall.enabled = false;
      newConfig.firewall.autoBlock.enabled = false;
      newConfig.logging.level = 'warn';
      newConfig.logging.alerting.enabled = false;
      break;
  }

  logger().info('Applied security mode preset', { mode });
  return newConfig;
}