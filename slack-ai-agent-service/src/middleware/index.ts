/**
 * Network Security Middleware Suite
 * Enterprise-grade network security middleware for Node.js/Express applications
 */

// Core security middleware components
export { 
  IPWhitelistMiddleware, 
  createIPWhitelistMiddleware,
  type IPWhitelistOptions,
  type IPWhitelistRequest,
} from './ip-whitelist';

export {
  RateLimitingMiddleware,
  MemoryRateLimitStore,
  createRateLimitingMiddleware,
  type RateLimitOptions,
  type RateLimitRequest,
  type RateLimitStore,
} from './rate-limiter';

export {
  TLSEnforcementMiddleware,
  createTLSEnforcementMiddleware,
  type TLSEnforcementOptions,
  type TLSRequest,
} from './tls-enforcement';

export {
  SecurityEventMonitor,
  createSecurityMonitor,
  type SecurityEvent,
  type SecurityAlert,
  type SecurityEventType,
  type SecurityEventSeverity,
  type SecurityMonitoringOptions,
} from './security-monitor';

// Unified security system
export {
  NetworkSecuritySystem,
  createNetworkSecuritySystem,
  type NetworkSecurityRequest,
  type SecurityHealthStatus,
} from './network-security';

// Configuration interfaces
export {
  type NetworkSecurityConfig,
  type IPWhitelistConfig,
  type RateLimitConfig,
  type TLSConfig,
  type SecurityLoggingConfig,
  DEFAULT_SECURITY_CONFIG,
  loadNetworkSecurityFromEnvironment,
  validateNetworkSecurityConfig,
  applySecurityMode,
} from '../config/network-security';

// CIDR utilities
export {
  CIDRValidator,
  cidrValidator,
  type CIDRBlock,
  type IPValidationResult,
  type CIDRValidationResult,
  type IPMatchResult,
} from '../utils/cidr-validator';

/**
 * Quick setup function for common use cases
 */
export function setupNetworkSecurity(options: {
  app: import('express').Express;
  mode?: 'strict' | 'balanced' | 'permissive';
  config?: Partial<NetworkSecurityConfig>;
}): NetworkSecuritySystem {
  const { app, mode = 'balanced', config = {} } = options;
  
  // Apply mode to configuration
  const modeConfig = { ...config };
  if (mode) {
    modeConfig.global = { ...modeConfig.global, mode };
  }
  
  const securitySystem = createNetworkSecuritySystem(modeConfig);
  securitySystem.applyToApp(app);
  
  return securitySystem;
}