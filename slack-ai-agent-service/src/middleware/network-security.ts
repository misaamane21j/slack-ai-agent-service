/**
 * Network Security Middleware Orchestrator
 * Combines all security middleware components into a unified system
 */

import { Express, Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { 
  NetworkSecurityConfig, 
  loadNetworkSecurityFromEnvironment,
  validateNetworkSecurityConfig,
  applySecurityMode 
} from '../config/network-security';
import { IPWhitelistMiddleware, createIPWhitelistMiddleware, IPWhitelistRequest } from './ip-whitelist';
import { RateLimitingMiddleware, createRateLimitingMiddleware, RateLimitRequest } from './rate-limiter';
import { TLSEnforcementMiddleware, createTLSEnforcementMiddleware, TLSRequest } from './tls-enforcement';
import { SecurityEventMonitor, createSecurityMonitor } from './security-monitor';

/**
 * Combined request interface with all security extensions
 */
export interface NetworkSecurityRequest extends IPWhitelistRequest, RateLimitRequest, TLSRequest {
  /** Security context */
  securityContext?: {
    /** Whether all security checks passed */
    passed: boolean;
    /** Security violations encountered */
    violations: string[];
    /** Risk score (0-100) */
    riskScore: number;
    /** Start time for performance measurement */
    startTime: number;
  };
}

/**
 * Security health status
 */
export interface SecurityHealthStatus {
  /** Overall health status */
  healthy: boolean;
  /** Individual component health */
  components: {
    ipWhitelist: ReturnType<IPWhitelistMiddleware['getHealthStatus']>;
    rateLimit: ReturnType<RateLimitingMiddleware['getHealthStatus']>;
    tlsEnforcement: ReturnType<TLSEnforcementMiddleware['getHealthStatus']>;
    securityMonitor: ReturnType<SecurityEventMonitor['getHealthStatus']>;
  };
  /** Overall configuration */
  configuration: {
    enabled: boolean;
    mode: NetworkSecurityConfig['global']['mode'];
    componentsEnabled: {
      ipWhitelist: boolean;
      rateLimit: boolean;
      tlsEnforcement: boolean;
      securityMonitor: boolean;
    };
  };
  /** Activity summary */
  activity: {
    totalRequests: number;
    blockedRequests: number;
    securityViolations: number;
    averageRiskScore: number;
  };
}

/**
 * Network Security System Class
 */
export class NetworkSecuritySystem {
  private config: NetworkSecurityConfig;
  private ipWhitelistMiddleware?: IPWhitelistMiddleware;
  private rateLimitMiddleware?: RateLimitingMiddleware;
  private tlsEnforcementMiddleware?: TLSEnforcementMiddleware;
  private securityMonitor: SecurityEventMonitor;
  private stats: {
    totalRequests: number;
    passedRequests: number;
    blockedRequests: number;
    violations: Map<string, number>;
    startTime: Date;
  };

  constructor(config?: Partial<NetworkSecurityConfig>) {
    // Load configuration
    const envConfig = loadNetworkSecurityFromEnvironment();
    this.config = { ...envConfig, ...config };

    // Apply security mode
    this.config = applySecurityMode(this.config, this.config.global.mode);

    // Validate configuration
    const validation = validateNetworkSecurityConfig(this.config);
    if (!validation.valid) {
      logger().error('Invalid network security configuration', { errors: validation.errors });
      throw new Error(`Network security configuration validation failed: ${validation.errors[0]?.message}`);
    }

    // Initialize components
    this.initializeComponents();

    // Initialize statistics
    this.stats = {
      totalRequests: 0,
      passedRequests: 0,
      blockedRequests: 0,
      violations: new Map(),
      startTime: new Date(),
    };

    logger().info('Network Security System initialized', {
      enabled: this.config.global.enabled,
      mode: this.config.global.mode,
      components: {
        ipWhitelist: this.config.ipWhitelist.enabled,
        rateLimit: this.config.rateLimit.enabled,
        tlsEnforcement: this.config.tls.enforceHTTPS,
        securityMonitor: this.config.logging.enabled,
      },
    });
  }

  /**
   * Initialize security components
   */
  private initializeComponents(): void {
    // Initialize security monitor first (needed by other components)
    this.securityMonitor = createSecurityMonitor({
      ...this.config.logging,
      eventProcessors: [
        async (event) => {
          // Custom event processor for integration
          logger().debug('Security event processed', { 
            eventId: event.id, 
            type: event.type,
            severity: event.severity,
          });
        },
      ],
      alertHandlers: [
        async (alert) => {
          // Custom alert handler
          logger().warn('Security alert generated', {
            alertId: alert.id,
            type: alert.type,
            severity: alert.severity,
            description: alert.description,
            eventCount: alert.events.length,
          });
        },
      ],
    });

    // Initialize IP whitelist middleware
    if (this.config.ipWhitelist.enabled) {
      this.ipWhitelistMiddleware = createIPWhitelistMiddleware({
        ...this.config.ipWhitelist,
        allowLocalhost: this.config.global.allowLocalhost,
        allowPrivateNetworks: this.config.global.allowPrivateNetworks,
        customActionHandler: async (req, res, matchResult) => {
          if (!matchResult.allowed) {
            await this.securityMonitor.recordEvent({
              type: 'ip_whitelist_violation',
              severity: 'high',
              description: `IP address ${req.clientIP} not in whitelist`,
              details: { 
                reason: matchResult.reason,
                fromProxy: req.fromProxy,
              },
              req,
              res,
              blocked: this.config.ipWhitelist.defaultAction === 'block',
            });
          }
        },
      });
    }

    // Initialize rate limiting middleware
    if (this.config.rateLimit.enabled) {
      this.rateLimitMiddleware = createRateLimitingMiddleware({
        ...this.config.rateLimit,
        responseHandler: async (req, res, result) => {
          if (!result.allowed) {
            await this.securityMonitor.recordEvent({
              type: 'rate_limit_exceeded',
              severity: 'medium',
              description: `Rate limit exceeded for ${req.rateLimitKey}`,
              details: {
                limit: result.limit,
                remaining: result.remaining,
                retryAfter: result.retryAfter,
              },
              req,
              res,
              blocked: true,
            });
          }
        },
      });
    }

    // Initialize TLS enforcement middleware
    if (this.config.tls.enforceHTTPS) {
      this.tlsEnforcementMiddleware = createTLSEnforcementMiddleware({
        ...this.config.tls,
        skipLocalhost: this.config.global.allowLocalhost,
        skipPrivateNetworks: this.config.global.allowPrivateNetworks,
      });
    }
  }

  /**
   * Create security context middleware
   */
  private createSecurityContextMiddleware(): (req: Request, res: Response, next: NextFunction) => void {
    return (req: Request, res: Response, next: NextFunction) => {
      const securityReq = req as NetworkSecurityRequest;
      const startTime = Date.now();

      securityReq.securityContext = {
        passed: false,
        violations: [],
        riskScore: 0,
        startTime,
      };

      // Hook into response to finalize security context
      const originalEnd = res.end;
      res.end = function(this: Response, ...args: any[]) {
        const responseTime = Date.now() - startTime;
        const context = securityReq.securityContext!;

        // Update statistics
        this.updateRequestStats(securityReq, context, responseTime);

        // Record security event if there were violations
        if (context.violations.length > 0 || context.riskScore > 50) {
          this.securityMonitor.recordEvent({
            type: 'suspicious_activity',
            severity: context.riskScore > 70 ? 'high' : 'medium',
            description: `Security violations detected: ${context.violations.join(', ')}`,
            details: {
              violations: context.violations,
              riskScore: context.riskScore,
            },
            req: securityReq,
            res: this as Response,
            blocked: res.statusCode === 403 || res.statusCode === 429,
            responseTime,
          });
        }

        return originalEnd.apply(this, args);
      }.bind(this);

      next();
    };
  }

  /**
   * Update request statistics
   */
  private updateRequestStats(req: NetworkSecurityRequest, context: typeof req.securityContext, responseTime: number): void {
    this.stats.totalRequests++;

    if (context?.passed) {
      this.stats.passedRequests++;
    } else {
      this.stats.blockedRequests++;
    }

    // Update violation counts
    context?.violations.forEach(violation => {
      const current = this.stats.violations.get(violation) || 0;
      this.stats.violations.set(violation, current + 1);
    });

    logger().debug('Request security analysis completed', {
      clientIP: req.clientIP,
      path: req.path,
      passed: context?.passed,
      violations: context?.violations.length || 0,
      riskScore: context?.riskScore,
      responseTime,
    });
  }

  /**
   * Apply all security middleware to Express app
   */
  applyToApp(app: Express): void {
    if (!this.config.global.enabled) {
      logger().info('Network security is disabled, skipping middleware setup');
      return;
    }

    logger().info('Applying network security middleware to Express app');

    // Apply security context middleware first
    app.use(this.createSecurityContextMiddleware());

    // Apply security monitor middleware
    if (this.config.logging.enabled) {
      app.use(this.securityMonitor.middleware());
    }

    // Apply TLS enforcement middleware
    if (this.tlsEnforcementMiddleware) {
      app.use(this.tlsEnforcementMiddleware.middleware());
    }

    // Apply IP whitelist middleware
    if (this.ipWhitelistMiddleware) {
      app.use(this.ipWhitelistMiddleware.middleware());
    }

    // Apply rate limiting middleware
    if (this.rateLimitMiddleware) {
      app.use(this.rateLimitMiddleware.middleware());
    }

    // Add security finalization middleware
    app.use((req: Request, res: Response, next: NextFunction) => {
      const securityReq = req as NetworkSecurityRequest;
      
      if (securityReq.securityContext) {
        // Mark as passed if we reach this point
        securityReq.securityContext.passed = true;
        
        // Calculate final risk score
        let riskScore = 0;
        
        if (securityReq.ipMatchResult && !securityReq.ipMatchResult.allowed) {
          riskScore += 40;
          securityReq.securityContext.violations.push('ip_not_whitelisted');
        }
        
        if (securityReq.rateLimitResult && !securityReq.rateLimitResult.allowed) {
          riskScore += 30;
          securityReq.securityContext.violations.push('rate_limit_exceeded');
        }
        
        if (securityReq.isSecure === false && this.config.tls.enforceHTTPS) {
          riskScore += 20;
          securityReq.securityContext.violations.push('insecure_connection');
        }
        
        securityReq.securityContext.riskScore = riskScore;
      }
      
      next();
    });

    logger().info('Network security middleware applied successfully');
  }

  /**
   * Update configuration at runtime
   */
  updateConfiguration(newConfig: Partial<NetworkSecurityConfig>): void {
    this.config = { ...this.config, ...newConfig };

    // Validate updated configuration
    const validation = validateNetworkSecurityConfig(this.config);
    if (!validation.valid) {
      logger().error('Invalid updated network security configuration', { errors: validation.errors });
      throw new Error(`Configuration validation failed: ${validation.errors[0]?.message}`);
    }

    // Update individual components
    if (this.ipWhitelistMiddleware && newConfig.ipWhitelist) {
      this.ipWhitelistMiddleware.updateConfiguration({
        ...newConfig.ipWhitelist,
        allowLocalhost: this.config.global.allowLocalhost,
        allowPrivateNetworks: this.config.global.allowPrivateNetworks,
      });
    }

    if (this.rateLimitMiddleware && newConfig.rateLimit) {
      this.rateLimitMiddleware.updateConfiguration(newConfig.rateLimit);
    }

    if (this.tlsEnforcementMiddleware && newConfig.tls) {
      this.tlsEnforcementMiddleware.updateConfiguration({
        ...newConfig.tls,
        skipLocalhost: this.config.global.allowLocalhost,
        skipPrivateNetworks: this.config.global.allowPrivateNetworks,
      });
    }

    logger().info('Network security configuration updated', {
      mode: this.config.global.mode,
      enabled: this.config.global.enabled,
    });
  }

  /**
   * Get comprehensive health status
   */
  async getHealthStatus(): Promise<SecurityHealthStatus> {
    const components = {
      ipWhitelist: this.ipWhitelistMiddleware ? 
        this.ipWhitelistMiddleware.getHealthStatus() : 
        { healthy: true, enabled: false, rulesCount: 0, recentActivity: { totalRequests: 0, blockedRequests: 0, allowedPercentage: 100 } },
      
      rateLimit: this.rateLimitMiddleware ? 
        await this.rateLimitMiddleware.getHealthStatus() : 
        { healthy: true, enabled: false, storeConnected: true, configuration: { maxRequests: 0, windowMs: 0 }, activity: { totalRequests: 0, rateLimitedRequests: 0, uniqueIPs: 0, successRate: 100 } },
      
      tlsEnforcement: this.tlsEnforcementMiddleware ? 
        this.tlsEnforcementMiddleware.getHealthStatus() : 
        { healthy: true, enabled: false, configuration: { enforceHTTPS: false, minVersion: '1.2', enableHSTS: false }, activity: { totalRequests: 0, secureRequests: 0, insecureRequests: 0, securityRate: 100 } },
      
      securityMonitor: this.securityMonitor.getHealthStatus(),
    };

    const overallHealthy = Object.values(components).every(component => component.healthy);
    
    const totalViolations = Array.from(this.stats.violations.values()).reduce((sum, count) => sum + count, 0);
    const averageRiskScore = totalViolations > 0 ? Math.round((totalViolations * 30) / this.stats.totalRequests) : 0;

    return {
      healthy: overallHealthy,
      components,
      configuration: {
        enabled: this.config.global.enabled,
        mode: this.config.global.mode,
        componentsEnabled: {
          ipWhitelist: this.config.ipWhitelist.enabled,
          rateLimit: this.config.rateLimit.enabled,
          tlsEnforcement: this.config.tls.enforceHTTPS,
          securityMonitor: this.config.logging.enabled,
        },
      },
      activity: {
        totalRequests: this.stats.totalRequests,
        blockedRequests: this.stats.blockedRequests,
        securityViolations: totalViolations,
        averageRiskScore,
      },
    };
  }

  /**
   * Get current statistics
   */
  getStatistics(): typeof this.stats & {
    securityMonitor?: ReturnType<SecurityEventMonitor['getStatistics']>;
    ipWhitelist?: ReturnType<IPWhitelistMiddleware['getStatistics']>;
    rateLimit?: ReturnType<RateLimitingMiddleware['getStatistics']>;
    tlsEnforcement?: ReturnType<TLSEnforcementMiddleware['getStatistics']>;
  } {
    return {
      ...this.stats,
      violations: new Map(this.stats.violations), // Return copy
      securityMonitor: this.securityMonitor ? this.securityMonitor.getStatistics() : undefined,
      ipWhitelist: this.ipWhitelistMiddleware ? this.ipWhitelistMiddleware.getStatistics() : undefined,
      rateLimit: this.rateLimitMiddleware ? this.rateLimitMiddleware.getStatistics() : undefined,
      tlsEnforcement: this.tlsEnforcementMiddleware ? this.tlsEnforcementMiddleware.getStatistics() : undefined,
    };
  }

  /**
   * Reset all statistics
   */
  resetStatistics(): void {
    this.stats = {
      totalRequests: 0,
      passedRequests: 0,
      blockedRequests: 0,
      violations: new Map(),
      startTime: new Date(),
    };

    this.ipWhitelistMiddleware?.resetStatistics();
    this.rateLimitMiddleware?.resetStatistics();
    this.tlsEnforcementMiddleware?.resetStatistics();
    this.securityMonitor.resetStatistics();

    logger().info('All network security statistics reset');
  }

  /**
   * Get current configuration
   */
  getConfiguration(): NetworkSecurityConfig {
    return { ...this.config };
  }

  /**
   * Cleanup resources
   */
  async destroy(): Promise<void> {
    await this.securityMonitor.destroy();
    this.rateLimitMiddleware?.destroy();
    logger().info('Network Security System destroyed');
  }
}

/**
 * Create network security system from configuration
 */
export function createNetworkSecuritySystem(config?: Partial<NetworkSecurityConfig>): NetworkSecuritySystem {
  return new NetworkSecuritySystem(config);
}