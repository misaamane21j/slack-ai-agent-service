/**
 * TLS/HTTPS Enforcement Middleware
 * Enforces secure connections and implements security headers
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { TLSConfig } from '../config/network-security';

/**
 * Extended request interface with TLS information
 */
export interface TLSRequest extends Request {
  /** Whether the request is secure */
  isSecure?: boolean;
  /** TLS version if available */
  tlsVersion?: string;
  /** Whether request was redirected to HTTPS */
  redirectedToHTTPS?: boolean;
}

/**
 * TLS enforcement options
 */
export interface TLSEnforcementOptions extends TLSConfig {
  /** Skip TLS enforcement for certain paths */
  skipPaths?: string[];
  /** Skip TLS enforcement for localhost */
  skipLocalhost?: boolean;
  /** Skip TLS enforcement for private networks */
  skipPrivateNetworks?: boolean;
  /** Custom secure check function */
  customSecureCheck?: (req: Request) => boolean;
  /** Redirect HTTP to HTTPS instead of blocking */
  redirectToHTTPS?: boolean;
  /** HTTPS port for redirects */
  httpsPort?: number;
}

/**
 * TLS Enforcement Middleware Class
 */
export class TLSEnforcementMiddleware {
  private config: TLSEnforcementOptions;
  private stats: {
    totalRequests: number;
    secureRequests: number;
    insecureRequests: number;
    redirectedRequests: number;
    blockedRequests: number;
    lastReset: Date;
  };

  constructor(config: TLSEnforcementOptions) {
    this.config = {
      skipLocalhost: true,
      skipPrivateNetworks: false,
      redirectToHTTPS: true,
      httpsPort: 443,
      ...config,
    };

    this.stats = {
      totalRequests: 0,
      secureRequests: 0,
      insecureRequests: 0,
      redirectedRequests: 0,
      blockedRequests: 0,
      lastReset: new Date(),
    };

    logger().info('TLS Enforcement Middleware initialized', {
      enforceHTTPS: this.config.enforceHTTPS,
      minVersion: this.config.minVersion,
      enableHSTS: this.config.enableHSTS,
      redirectToHTTPS: this.config.redirectToHTTPS,
    });
  }

  /**
   * Check if request is secure
   */
  private isRequestSecure(req: Request): boolean {
    // Use custom check if provided
    if (this.config.customSecureCheck) {
      return this.config.customSecureCheck(req);
    }

    // Check if request is HTTPS
    if (req.protocol === 'https') {
      return true;
    }

    // Check for secure headers from reverse proxy
    const forwardedProto = req.get('x-forwarded-proto');
    if (forwardedProto === 'https') {
      return true;
    }

    const forwardedSsl = req.get('x-forwarded-ssl');
    if (forwardedSsl === 'on') {
      return true;
    }

    return req.secure || false;
  }

  /**
   * Check if request should skip TLS enforcement
   */
  private shouldSkipRequest(req: Request): boolean {
    // Skip if HTTPS enforcement is disabled
    if (!this.config.enforceHTTPS) {
      return true;
    }

    // Skip certain paths
    if (this.config.skipPaths && this.config.skipPaths.some(path => req.path.startsWith(path))) {
      logger().debug('Skipping TLS enforcement for path', { path: req.path });
      return true;
    }

    // Skip localhost if configured
    if (this.config.skipLocalhost) {
      const host = req.get('host') || '';
      const hostname = host.split(':')[0];
      
      if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
        logger().debug('Skipping TLS enforcement for localhost', { host });
        return true;
      }
    }

    // Skip private networks if configured
    if (this.config.skipPrivateNetworks) {
      const clientIP = req.socket.remoteAddress?.replace(/^::ffff:/, '') || '';
      
      if (this.isPrivateIP(clientIP)) {
        logger().debug('Skipping TLS enforcement for private network', { ip: clientIP });
        return true;
      }
    }

    return false;
  }

  /**
   * Check if IP is in private range
   */
  private isPrivateIP(ip: string): boolean {
    if (!ip) return false;

    // IPv4 private ranges
    const ipv4Private = [
      /^10\./,
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
      /^192\.168\./,
      /^127\./,
    ];

    for (const pattern of ipv4Private) {
      if (pattern.test(ip)) {
        return true;
      }
    }

    // IPv6 private ranges (simplified)
    if (ip.startsWith('::1') || ip.startsWith('fc') || ip.startsWith('fd')) {
      return true;
    }

    return false;
  }

  /**
   * Get TLS version from request
   */
  private getTLSVersion(req: Request): string | undefined {
    // Try to get TLS version from socket
    const socket = (req as any).socket;
    if (socket && socket.getCipher) {
      const cipher = socket.getCipher();
      return cipher?.version;
    }

    // Try from headers
    const tlsVersion = req.get('x-forwarded-tls-version') || req.get('x-tls-version');
    if (tlsVersion) {
      return tlsVersion;
    }

    return undefined;
  }

  /**
   * Validate TLS version against minimum requirements
   */
  private isTLSVersionValid(version?: string): boolean {
    if (!version) {
      return true; // Can't validate, assume valid
    }

    const minVersion = parseFloat(this.config.minVersion);
    const currentVersion = parseFloat(version.replace(/^TLSv/, ''));

    return currentVersion >= minVersion;
  }

  /**
   * Set security headers
   */
  private setSecurityHeaders(req: Request, res: Response): void {
    // HSTS (HTTP Strict Transport Security)
    if (this.config.enableHSTS && this.isRequestSecure(req)) {
      let hstsValue = `max-age=${this.config.hstsMaxAge}`;
      
      if (this.config.hstsIncludeSubdomains) {
        hstsValue += '; includeSubDomains';
      }
      
      res.set('Strict-Transport-Security', hstsValue);
    }

    // Additional security headers
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Frame-Options', 'DENY');
    res.set('X-XSS-Protection', '1; mode=block');
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin');

    // CSP (Content Security Policy) - basic implementation
    res.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'");
  }

  /**
   * Handle insecure request
   */
  private handleInsecureRequest(req: TLSRequest, res: Response): void {
    this.stats.insecureRequests++;

    const securityEvent = {
      type: 'insecure_connection_attempt',
      protocol: req.protocol,
      host: req.get('host'),
      path: req.path,
      method: req.method,
      userAgent: req.get('user-agent'),
      clientIP: req.socket.remoteAddress,
      timestamp: new Date().toISOString(),
    };

    if (this.config.redirectToHTTPS) {
      // Redirect to HTTPS
      const host = req.get('host') || 'localhost';
      const hostWithoutPort = host.split(':')[0];
      const httpsHost = this.config.httpsPort === 443 
        ? hostWithoutPort 
        : `${hostWithoutPort}:${this.config.httpsPort}`;
      
      const httpsUrl = `https://${httpsHost}${req.originalUrl}`;
      
      logger().info('Redirecting HTTP to HTTPS', { 
        ...securityEvent,
        httpsUrl 
      });

      req.redirectedToHTTPS = true;
      this.stats.redirectedRequests++;
      
      res.redirect(301, httpsUrl);
    } else {
      // Block request
      logger().warn('Blocking insecure HTTP request', securityEvent);
      
      this.stats.blockedRequests++;
      
      res.status(426).json({
        error: 'Upgrade Required',
        message: 'This service requires HTTPS. Please use a secure connection.',
        code: 'HTTPS_REQUIRED',
        upgrade: 'TLS/1.2, TLS/1.3',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Create Express middleware function
   */
  middleware(): (req: Request, res: Response, next: NextFunction) => void {
    return (req: Request, res: Response, next: NextFunction) => {
      const tlsReq = req as TLSRequest;

      try {
        this.stats.totalRequests++;

        // Check if request should skip TLS enforcement
        if (this.shouldSkipRequest(req)) {
          // Still set security headers for all requests
          this.setSecurityHeaders(req, res);
          return next();
        }

        // Check if request is secure
        const isSecure = this.isRequestSecure(req);
        tlsReq.isSecure = isSecure;

        if (!isSecure) {
          this.handleInsecureRequest(tlsReq, res);
          return; // Response already sent
        }

        // Request is secure - proceed with additional checks
        this.stats.secureRequests++;

        // Get and validate TLS version
        const tlsVersion = this.getTLSVersion(req);
        tlsReq.tlsVersion = tlsVersion;

        if (tlsVersion && !this.isTLSVersionValid(tlsVersion)) {
          logger().warn('Request using outdated TLS version', {
            tlsVersion,
            minRequired: this.config.minVersion,
            clientIP: req.socket.remoteAddress,
            userAgent: req.get('user-agent'),
          });

          // For now, just log the warning and continue
          // In strict mode, you might want to block the request
        }

        // Set security headers
        this.setSecurityHeaders(req, res);

        logger().debug('TLS enforcement passed', {
          isSecure,
          tlsVersion,
          host: req.get('host'),
        });

        next();
      } catch (error) {
        logger().error('TLS enforcement middleware error', { error });
        
        // In case of error, set basic security headers and continue
        this.setSecurityHeaders(req, res);
        next();
      }
    };
  }

  /**
   * Update configuration at runtime
   */
  updateConfiguration(newConfig: Partial<TLSEnforcementOptions>): void {
    this.config = { ...this.config, ...newConfig };
    logger().info('TLS enforcement configuration updated', {
      enforceHTTPS: this.config.enforceHTTPS,
      minVersion: this.config.minVersion,
      enableHSTS: this.config.enableHSTS,
    });
  }

  /**
   * Get current statistics
   */
  getStatistics(): typeof this.stats {
    return { ...this.stats };
  }

  /**
   * Reset statistics
   */
  resetStatistics(): void {
    this.stats = {
      totalRequests: 0,
      secureRequests: 0,
      insecureRequests: 0,
      redirectedRequests: 0,
      blockedRequests: 0,
      lastReset: new Date(),
    };
    logger().info('TLS enforcement statistics reset');
  }

  /**
   * Get health status
   */
  getHealthStatus(): {
    healthy: boolean;
    enabled: boolean;
    configuration: {
      enforceHTTPS: boolean;
      minVersion: string;
      enableHSTS: boolean;
      redirectToHTTPS?: boolean;
    };
    activity: {
      totalRequests: number;
      secureRequests: number;
      insecureRequests: number;
      securityRate: number;
    };
  } {
    const securityRate = this.stats.totalRequests > 0
      ? Math.round((this.stats.secureRequests / this.stats.totalRequests) * 100)
      : 100;

    return {
      healthy: true,
      enabled: this.config.enforceHTTPS,
      configuration: {
        enforceHTTPS: this.config.enforceHTTPS,
        minVersion: this.config.minVersion,
        enableHSTS: this.config.enableHSTS,
        redirectToHTTPS: this.config.redirectToHTTPS,
      },
      activity: {
        totalRequests: this.stats.totalRequests,
        secureRequests: this.stats.secureRequests,
        insecureRequests: this.stats.insecureRequests,
        securityRate,
      },
    };
  }
}

/**
 * Create TLS enforcement middleware from configuration
 */
export function createTLSEnforcementMiddleware(config: TLSEnforcementOptions): TLSEnforcementMiddleware {
  return new TLSEnforcementMiddleware(config);
}