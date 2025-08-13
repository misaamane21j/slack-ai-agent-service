/**
 * IP Whitelisting Middleware
 * Express.js middleware for IP address whitelisting with CIDR range support
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { CIDRValidator, IPMatchResult } from '../utils/cidr-validator';
import { IPWhitelistConfig } from '../config/network-security';

/**
 * Extended request interface with IP information
 */
export interface IPWhitelistRequest extends Request {
  /** Client IP address (resolved from headers and connection) */
  clientIP?: string;
  /** Whether IP was resolved from proxy headers */
  fromProxy?: boolean;
  /** IP whitelist match result */
  ipMatchResult?: IPMatchResult;
}

/**
 * IP whitelist middleware options
 */
export interface IPWhitelistOptions extends IPWhitelistConfig {
  /** Custom IP resolver function */
  customIPResolver?: (req: Request) => string | null;
  /** Custom action handler */
  customActionHandler?: (req: IPWhitelistRequest, res: Response, matchResult: IPMatchResult) => void;
  /** Skip middleware for certain paths */
  skipPaths?: string[];
  /** Skip middleware for certain user agents */
  skipUserAgents?: string[];
}

/**
 * IP Whitelist Middleware Class
 */
export class IPWhitelistMiddleware {
  private cidrValidator: CIDRValidator;
  private config: IPWhitelistOptions;
  private stats: {
    totalRequests: number;
    allowedRequests: number;
    blockedRequests: number;
    lastReset: Date;
  };

  constructor(config: IPWhitelistOptions) {
    this.config = config;
    this.cidrValidator = new CIDRValidator();
    this.stats = {
      totalRequests: 0,
      allowedRequests: 0,
      blockedRequests: 0,
      lastReset: new Date(),
    };

    this.initialize();
  }

  /**
   * Initialize the middleware with configuration
   */
  private initialize(): void {
    // Load allowed IPs and ranges
    this.cidrValidator.loadFromConfiguration({
      ips: this.config.allowedIPs,
      ranges: this.config.allowedRanges,
    });

    // Add localhost if enabled in global config
    if (this.config.allowLocalhost) {
      this.cidrValidator.addAllowedIP('127.0.0.1');
      this.cidrValidator.addAllowedIP('::1');
    }

    // Add private networks if enabled
    if (this.config.allowPrivateNetworks) {
      this.cidrValidator.addAllowedRange('10.0.0.0/8');
      this.cidrValidator.addAllowedRange('172.16.0.0/12');
      this.cidrValidator.addAllowedRange('192.168.0.0/16');
      this.cidrValidator.addAllowedRange('fc00::/7'); // IPv6 private
    }

    logger().info('IP Whitelist Middleware initialized', {
      enabled: this.config.enabled,
      allowedIPs: this.config.allowedIPs.length,
      allowedRanges: this.config.allowedRanges.length,
      defaultAction: this.config.defaultAction,
    });
  }

  /**
   * Extract client IP address from request
   */
  private extractClientIP(req: Request): { ip: string | null; fromProxy: boolean } {
    // Use custom resolver if provided
    if (this.config.customIPResolver) {
      const customIP = this.config.customIPResolver(req);
      if (customIP) {
        return { ip: customIP, fromProxy: false };
      }
    }

    // Check proxy headers if proxy is trusted
    if (this.config.trustProxy) {
      for (const header of this.config.proxyHeaders) {
        const headerValue = req.get(header);
        if (headerValue) {
          // Handle comma-separated IPs (take the first one)
          const ip = headerValue.split(',')[0].trim();
          if (ip) {
            logger().debug('IP resolved from proxy header', { header, ip });
            return { ip, fromProxy: true };
          }
        }
      }
    }

    // Fall back to connection remote address
    const connectionIP = req.socket.remoteAddress;
    if (connectionIP) {
      // Remove IPv6 wrapper for IPv4 addresses
      const cleanIP = connectionIP.replace(/^::ffff:/, '');
      return { ip: cleanIP, fromProxy: false };
    }

    logger().warn('Unable to determine client IP address', {
      headers: this.config.proxyHeaders.map(h => ({ [h]: req.get(h) })),
      remoteAddress: connectionIP,
    });

    return { ip: null, fromProxy: false };
  }

  /**
   * Check if request should skip IP whitelist
   */
  private shouldSkipRequest(req: Request): boolean {
    // Skip if middleware is disabled
    if (!this.config.enabled) {
      return true;
    }

    // Skip certain paths
    if (this.config.skipPaths && this.config.skipPaths.some(path => req.path.startsWith(path))) {
      logger().debug('Skipping IP whitelist for path', { path: req.path });
      return true;
    }

    // Skip certain user agents
    const userAgent = req.get('user-agent');
    if (userAgent && this.config.skipUserAgents) {
      const shouldSkip = this.config.skipUserAgents.some(pattern => 
        userAgent.toLowerCase().includes(pattern.toLowerCase())
      );
      if (shouldSkip) {
        logger().debug('Skipping IP whitelist for user agent', { userAgent });
        return true;
      }
    }

    return false;
  }

  /**
   * Handle different actions based on configuration
   */
  private handleAction(req: IPWhitelistRequest, res: Response, matchResult: IPMatchResult): void {
    const clientIP = req.clientIP || 'unknown';

    // Use custom handler if provided
    if (this.config.customActionHandler) {
      this.config.customActionHandler(req, res, matchResult);
      return;
    }

    // Update statistics
    this.stats.totalRequests++;

    if (matchResult.allowed) {
      this.stats.allowedRequests++;
      logger().debug('IP whitelist: Request allowed', {
        ip: clientIP,
        matchedRange: matchResult.matchedRange,
        fromProxy: req.fromProxy,
      });
      return; // Continue to next middleware
    }

    // Handle blocked requests
    this.stats.blockedRequests++;

    const securityEvent = {
      type: 'ip_whitelist_violation',
      clientIP,
      userAgent: req.get('user-agent'),
      path: req.path,
      method: req.method,
      fromProxy: req.fromProxy,
      reason: matchResult.reason,
      timestamp: new Date().toISOString(),
    };

    switch (this.config.defaultAction) {
      case 'block':
        logger().warn('IP whitelist: Request blocked', securityEvent);
        
        res.status(403).json({
          error: 'Access Denied',
          message: this.config.rejectionMessage || 'Your IP address is not authorized to access this resource',
          code: 'IP_NOT_WHITELISTED',
          timestamp: new Date().toISOString(),
        });
        break;

      case 'log':
        logger().info('IP whitelist: Request logged (not blocked)', securityEvent);
        break;

      case 'warn':
        logger().warn('IP whitelist: Request warned (not blocked)', securityEvent);
        break;
    }
  }

  /**
   * Create Express middleware function
   */
  middleware(): (req: Request, res: Response, next: NextFunction) => void {
    return (req: Request, res: Response, next: NextFunction) => {
      const whitelistReq = req as IPWhitelistRequest;

      try {
        // Check if request should be skipped
        if (this.shouldSkipRequest(req)) {
          return next();
        }

        // Extract client IP
        const { ip, fromProxy } = this.extractClientIP(req);
        whitelistReq.clientIP = ip || undefined;
        whitelistReq.fromProxy = fromProxy;

        if (!ip) {
          logger().error('IP whitelist: Unable to determine client IP, blocking request');
          
          const matchResult: IPMatchResult = {
            allowed: false,
            reason: 'Unable to determine client IP address',
          };
          
          whitelistReq.ipMatchResult = matchResult;
          this.handleAction(whitelistReq, res, matchResult);
          
          if (this.config.defaultAction === 'block') {
            return; // Response already sent
          }
        } else {
          // Check if IP is allowed
          const matchResult = this.cidrValidator.isIPAllowed(ip);
          whitelistReq.ipMatchResult = matchResult;

          this.handleAction(whitelistReq, res, matchResult);

          if (!matchResult.allowed && this.config.defaultAction === 'block') {
            return; // Response already sent
          }
        }

        next();
      } catch (error) {
        logger().error('IP whitelist middleware error', { error, ip: whitelistReq.clientIP });
        
        // In case of error, apply default action
        const matchResult: IPMatchResult = {
          allowed: false,
          reason: 'Internal error during IP validation',
        };
        
        whitelistReq.ipMatchResult = matchResult;
        this.handleAction(whitelistReq, res, matchResult);

        if (this.config.defaultAction === 'block') {
          return; // Response already sent
        }

        next();
      }
    };
  }

  /**
   * Update configuration at runtime
   */
  updateConfiguration(newConfig: Partial<IPWhitelistOptions>): void {
    this.config = { ...this.config, ...newConfig };
    
    // Reinitialize CIDR validator if IPs or ranges changed
    if (newConfig.allowedIPs !== undefined || newConfig.allowedRanges !== undefined) {
      this.cidrValidator.clearAll();
      this.initialize();
    }

    logger().info('IP whitelist configuration updated', {
      enabled: this.config.enabled,
      allowedIPs: this.config.allowedIPs.length,
      allowedRanges: this.config.allowedRanges.length,
    });
  }

  /**
   * Add allowed IP at runtime
   */
  addAllowedIP(ip: string): boolean {
    const success = this.cidrValidator.addAllowedIP(ip);
    if (success) {
      this.config.allowedIPs.push(ip);
    }
    return success;
  }

  /**
   * Add allowed CIDR range at runtime
   */
  addAllowedRange(range: string): boolean {
    const success = this.cidrValidator.addAllowedRange(range);
    if (success) {
      this.config.allowedRanges.push(range);
    }
    return success;
  }

  /**
   * Remove allowed IP at runtime
   */
  removeAllowedIP(ip: string): boolean {
    const success = this.cidrValidator.removeAllowedIP(ip);
    if (success) {
      this.config.allowedIPs = this.config.allowedIPs.filter(allowedIP => allowedIP !== ip);
    }
    return success;
  }

  /**
   * Remove allowed CIDR range at runtime
   */
  removeAllowedRange(range: string): boolean {
    const success = this.cidrValidator.removeAllowedRange(range);
    if (success) {
      this.config.allowedRanges = this.config.allowedRanges.filter(allowedRange => allowedRange !== range);
    }
    return success;
  }

  /**
   * Get current statistics
   */
  getStatistics(): typeof this.stats & { 
    allowedConfiguration: ReturnType<CIDRValidator['getAllowedConfiguration']> 
  } {
    return {
      ...this.stats,
      allowedConfiguration: this.cidrValidator.getAllowedConfiguration(),
    };
  }

  /**
   * Reset statistics
   */
  resetStatistics(): void {
    this.stats = {
      totalRequests: 0,
      allowedRequests: 0,
      blockedRequests: 0,
      lastReset: new Date(),
    };
    logger().info('IP whitelist statistics reset');
  }

  /**
   * Get health status
   */
  getHealthStatus(): {
    healthy: boolean;
    enabled: boolean;
    rulesCount: number;
    recentActivity: {
      totalRequests: number;
      blockedRequests: number;
      allowedPercentage: number;
    };
  } {
    const config = this.cidrValidator.getAllowedConfiguration();
    const allowedPercentage = this.stats.totalRequests > 0 
      ? Math.round((this.stats.allowedRequests / this.stats.totalRequests) * 100) 
      : 100;

    return {
      healthy: true,
      enabled: this.config.enabled,
      rulesCount: config.totalRules,
      recentActivity: {
        totalRequests: this.stats.totalRequests,
        blockedRequests: this.stats.blockedRequests,
        allowedPercentage,
      },
    };
  }
}

/**
 * Create IP whitelist middleware from configuration
 */
export function createIPWhitelistMiddleware(config: IPWhitelistOptions): IPWhitelistMiddleware {
  return new IPWhitelistMiddleware(config);
}