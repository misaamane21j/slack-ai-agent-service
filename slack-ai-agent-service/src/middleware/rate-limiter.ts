/**
 * Rate Limiting Middleware
 * Advanced rate limiting with IP-based tracking, whitelisting support, and configurable responses
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { RateLimitConfig } from '../config/network-security';
import { IPWhitelistRequest } from './ip-whitelist';

/**
 * Rate limit entry for tracking requests
 */
interface RateLimitEntry {
  /** Number of requests made */
  count: number;
  /** Window start time */
  windowStart: number;
  /** First request time in current window */
  firstRequestTime: number;
  /** Last request time */
  lastRequestTime: number;
  /** Whether this IP is currently blocked */
  blocked: boolean;
  /** Block expiry time (if blocked) */
  blockExpiry?: number;
}

/**
 * Rate limit result
 */
interface RateLimitResult {
  /** Whether request is allowed */
  allowed: boolean;
  /** Remaining requests in current window */
  remaining: number;
  /** Time until window resets (ms) */
  resetTime: number;
  /** Total requests allowed per window */
  limit: number;
  /** Current window start time */
  windowStart: number;
  /** Retry after time in seconds (if blocked) */
  retryAfter?: number;
  /** Reason for rate limit (if blocked) */
  reason?: string;
}

/**
 * Enhanced request interface with rate limit info
 */
export interface RateLimitRequest extends IPWhitelistRequest {
  /** Rate limit result */
  rateLimitResult?: RateLimitResult;
  /** Request identifier (usually IP) */
  rateLimitKey?: string;
}

/**
 * Rate limiting options
 */
export interface RateLimitOptions extends RateLimitConfig {
  /** Custom key generator function */
  keyGenerator?: (req: Request) => string;
  /** Custom response handler */
  responseHandler?: (req: RateLimitRequest, res: Response, result: RateLimitResult) => void;
  /** Skip paths */
  skipPaths?: string[];
  /** Skip successful requests from rate limiting */
  skipSuccessfulRequests?: boolean;
  /** Store implementation for clustering support */
  store?: RateLimitStore;
}

/**
 * Rate limit store interface for distributed rate limiting
 */
export interface RateLimitStore {
  /** Get rate limit entry for key */
  get(key: string): Promise<RateLimitEntry | null>;
  /** Set rate limit entry for key */
  set(key: string, entry: RateLimitEntry, ttl?: number): Promise<void>;
  /** Delete rate limit entry */
  delete(key: string): Promise<void>;
  /** Clear all entries */
  clear(): Promise<void>;
  /** Get store statistics */
  getStats(): Promise<{ totalKeys: number; memoryUsage?: number }>;
}

/**
 * In-memory rate limit store implementation
 */
export class MemoryRateLimitStore implements RateLimitStore {
  private store = new Map<string, RateLimitEntry>();
  private timers = new Map<string, NodeJS.Timeout>();

  async get(key: string): Promise<RateLimitEntry | null> {
    return this.store.get(key) || null;
  }

  async set(key: string, entry: RateLimitEntry, ttl = 0): Promise<void> {
    this.store.set(key, entry);

    // Set expiry timer if TTL is provided
    if (ttl > 0) {
      // Clear existing timer
      const existingTimer = this.timers.get(key);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }

      // Set new timer
      const timer = setTimeout(() => {
        this.store.delete(key);
        this.timers.delete(key);
      }, ttl);

      this.timers.set(key, timer);
    }
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
    const timer = this.timers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(key);
    }
  }

  async clear(): Promise<void> {
    this.store.clear();
    this.timers.forEach(timer => clearTimeout(timer));
    this.timers.clear();
  }

  async getStats(): Promise<{ totalKeys: number; memoryUsage?: number }> {
    return {
      totalKeys: this.store.size,
      memoryUsage: this.estimateMemoryUsage(),
    };
  }

  private estimateMemoryUsage(): number {
    // Rough estimation of memory usage in bytes
    let size = 0;
    this.store.forEach((entry, key) => {
      size += key.length * 2; // String characters are 2 bytes
      size += 64; // Approximate size of RateLimitEntry object
    });
    return size;
  }
}

/**
 * Rate Limiting Middleware Class
 */
export class RateLimitingMiddleware {
  private config: RateLimitOptions;
  private store: RateLimitStore;
  private stats: {
    totalRequests: number;
    allowedRequests: number;
    rateLimitedRequests: number;
    uniqueIPs: Set<string>;
    lastReset: Date;
  };
  private cleanupInterval?: NodeJS.Timeout;

  constructor(config: RateLimitOptions) {
    this.config = config;
    this.store = config.store || new MemoryRateLimitStore();
    this.stats = {
      totalRequests: 0,
      allowedRequests: 0,
      rateLimitedRequests: 0,
      uniqueIPs: new Set(),
      lastReset: new Date(),
    };

    this.startCleanupProcess();
    
    logger().info('Rate Limiting Middleware initialized', {
      enabled: this.config.enabled,
      maxRequests: this.config.maxRequests,
      windowMs: this.config.windowMs,
      skipWhitelisted: this.config.skipWhitelisted,
    });
  }

  /**
   * Start cleanup process to remove expired entries
   */
  private startCleanupProcess(): void {
    // Cleanup every 5 minutes
    this.cleanupInterval = setInterval(async () => {
      await this.cleanupExpiredEntries();
    }, 5 * 60 * 1000);
  }

  /**
   * Clean up expired rate limit entries
   */
  private async cleanupExpiredEntries(): Promise<void> {
    try {
      const stats = await this.store.getStats();
      logger().debug('Rate limiter cleanup started', { totalKeys: stats.totalKeys });
      
      // This is a simple implementation - for production, consider more sophisticated cleanup
      // The current MemoryRateLimitStore handles TTL automatically
      
    } catch (error) {
      logger().error('Rate limiter cleanup error', { error });
    }
  }

  /**
   * Generate rate limit key for request
   */
  private generateKey(req: Request): string {
    if (this.config.keyGenerator) {
      return this.config.keyGenerator(req);
    }

    // Use IP address from whitelist middleware if available
    const whitelistReq = req as IPWhitelistRequest;
    const clientIP = whitelistReq.clientIP;
    
    if (clientIP) {
      return `ip:${clientIP}`;
    }

    // Fallback to connection remote address
    const fallbackIP = req.socket.remoteAddress?.replace(/^::ffff:/, '') || 'unknown';
    return `ip:${fallbackIP}`;
  }

  /**
   * Check if request should skip rate limiting
   */
  private shouldSkipRequest(req: Request): boolean {
    // Skip if disabled
    if (!this.config.enabled) {
      return true;
    }

    // Skip if IP is whitelisted and skipWhitelisted is enabled
    if (this.config.skipWhitelisted) {
      const whitelistReq = req as IPWhitelistRequest;
      if (whitelistReq.ipMatchResult?.allowed) {
        logger().debug('Skipping rate limit for whitelisted IP', { 
          ip: whitelistReq.clientIP 
        });
        return true;
      }
    }

    // Skip certain paths
    if (this.config.skipPaths && this.config.skipPaths.some(path => req.path.startsWith(path))) {
      logger().debug('Skipping rate limit for path', { path: req.path });
      return true;
    }

    return false;
  }

  /**
   * Calculate rate limit for a request
   */
  private async calculateRateLimit(key: string): Promise<RateLimitResult> {
    const now = Date.now();
    const windowStart = Math.floor(now / this.config.windowMs) * this.config.windowMs;

    // Get existing entry
    let entry = await this.store.get(key);

    // Initialize new entry if doesn't exist or window has changed
    if (!entry || entry.windowStart !== windowStart) {
      entry = {
        count: 0,
        windowStart,
        firstRequestTime: now,
        lastRequestTime: now,
        blocked: false,
      };
    }

    // Check if currently blocked
    if (entry.blocked && entry.blockExpiry && now < entry.blockExpiry) {
      const retryAfter = Math.ceil((entry.blockExpiry - now) / 1000);
      return {
        allowed: false,
        remaining: 0,
        resetTime: entry.blockExpiry - now,
        limit: this.config.maxRequests,
        windowStart: entry.windowStart,
        retryAfter,
        reason: 'Rate limit exceeded, currently blocked',
      };
    }

    // Clear block if expired
    if (entry.blocked && entry.blockExpiry && now >= entry.blockExpiry) {
      entry.blocked = false;
      entry.blockExpiry = undefined;
      entry.count = 0; // Reset count after block expires
    }

    // Increment request count
    entry.count++;
    entry.lastRequestTime = now;

    // Check if limit exceeded
    const allowed = entry.count <= this.config.maxRequests;
    const remaining = Math.max(0, this.config.maxRequests - entry.count);
    const resetTime = (windowStart + this.config.windowMs) - now;

    // Block if limit exceeded and not already blocked
    if (!allowed && !entry.blocked) {
      entry.blocked = true;
      entry.blockExpiry = now + this.config.windowMs; // Block for one window period
      logger().warn('Rate limit exceeded, blocking requests', {
        key,
        count: entry.count,
        limit: this.config.maxRequests,
        blockDuration: this.config.windowMs,
      });
    }

    // Save updated entry with TTL
    const ttl = this.config.windowMs * 2; // Keep entry for 2 windows
    await this.store.set(key, entry, ttl);

    return {
      allowed,
      remaining,
      resetTime,
      limit: this.config.maxRequests,
      windowStart: entry.windowStart,
      retryAfter: entry.blocked && entry.blockExpiry ? Math.ceil((entry.blockExpiry - now) / 1000) : undefined,
      reason: allowed ? undefined : 'Rate limit exceeded',
    };
  }

  /**
   * Handle rate limit response
   */
  private handleResponse(req: RateLimitRequest, res: Response, result: RateLimitResult): void {
    // Use custom handler if provided
    if (this.config.responseHandler) {
      this.config.responseHandler(req, res, result);
      return;
    }

    // Update statistics
    this.stats.totalRequests++;
    if (req.rateLimitKey) {
      this.stats.uniqueIPs.add(req.rateLimitKey);
    }

    // Add rate limit headers
    if (this.config.headers.includeRemaining) {
      res.set('X-RateLimit-Remaining', result.remaining.toString());
    }

    if (this.config.headers.includeResetTime) {
      const resetTimeSeconds = Math.ceil(result.resetTime / 1000);
      res.set('X-RateLimit-Reset', (Date.now() + result.resetTime).toString());
      res.set('X-RateLimit-Reset-Time', resetTimeSeconds.toString());
    }

    if (result.retryAfter && this.config.headers.includeRetryAfter) {
      res.set('Retry-After', result.retryAfter.toString());
    }

    // Always include limit
    res.set('X-RateLimit-Limit', result.limit.toString());

    if (result.allowed) {
      this.stats.allowedRequests++;
      logger().debug('Rate limit check passed', {
        key: req.rateLimitKey,
        remaining: result.remaining,
        resetTime: result.resetTime,
      });
      return; // Continue to next middleware
    }

    // Handle rate limited requests
    this.stats.rateLimitedRequests++;
    
    const securityEvent = {
      type: 'rate_limit_exceeded',
      key: req.rateLimitKey,
      clientIP: (req as IPWhitelistRequest).clientIP,
      userAgent: req.get('user-agent'),
      path: req.path,
      method: req.method,
      limit: result.limit,
      retryAfter: result.retryAfter,
      timestamp: new Date().toISOString(),
    };

    logger().warn('Rate limit exceeded', securityEvent);

    // Send rate limit response
    res.status(429).json({
      error: 'Too Many Requests',
      message: this.config.message || 'Rate limit exceeded. Please try again later.',
      code: 'RATE_LIMIT_EXCEEDED',
      details: {
        limit: result.limit,
        remaining: result.remaining,
        resetTime: Math.ceil(result.resetTime / 1000),
        retryAfter: result.retryAfter,
      },
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Create Express middleware function
   */
  middleware(): (req: Request, res: Response, next: NextFunction) => void {
    return async (req: Request, res: Response, next: NextFunction) => {
      const rateLimitReq = req as RateLimitRequest;

      try {
        // Check if request should be skipped
        if (this.shouldSkipRequest(req)) {
          return next();
        }

        // Generate rate limit key
        const key = this.generateKey(req);
        rateLimitReq.rateLimitKey = key;

        // Calculate rate limit
        const result = await this.calculateRateLimit(key);
        rateLimitReq.rateLimitResult = result;

        // Apply delay if configured
        if (this.config.delayMs && this.config.delayMs > 0 && result.allowed) {
          await new Promise(resolve => setTimeout(resolve, this.config.delayMs));
        }

        this.handleResponse(rateLimitReq, res, result);

        if (result.allowed) {
          next();
        }
        // If not allowed, response is already sent

      } catch (error) {
        logger().error('Rate limiting middleware error', { 
          error, 
          key: rateLimitReq.rateLimitKey 
        });
        
        // In case of error, allow request to proceed
        next();
      }
    };
  }

  /**
   * Update configuration at runtime
   */
  updateConfiguration(newConfig: Partial<RateLimitOptions>): void {
    this.config = { ...this.config, ...newConfig };
    logger().info('Rate limit configuration updated', {
      enabled: this.config.enabled,
      maxRequests: this.config.maxRequests,
      windowMs: this.config.windowMs,
    });
  }

  /**
   * Reset rate limit for specific key
   */
  async resetRateLimit(key: string): Promise<boolean> {
    try {
      await this.store.delete(key);
      logger().info('Rate limit reset', { key });
      return true;
    } catch (error) {
      logger().error('Failed to reset rate limit', { key, error });
      return false;
    }
  }

  /**
   * Get current statistics
   */
  getStatistics(): typeof this.stats & { 
    storeStats?: { totalKeys: number; memoryUsage?: number } 
  } {
    return {
      ...this.stats,
      uniqueIPs: new Set(this.stats.uniqueIPs), // Return copy
    };
  }

  /**
   * Get store statistics
   */
  async getStoreStatistics(): Promise<{ totalKeys: number; memoryUsage?: number }> {
    return await this.store.getStats();
  }

  /**
   * Reset statistics
   */
  resetStatistics(): void {
    this.stats = {
      totalRequests: 0,
      allowedRequests: 0,
      rateLimitedRequests: 0,
      uniqueIPs: new Set(),
      lastReset: new Date(),
    };
    logger().info('Rate limit statistics reset');
  }

  /**
   * Clear all rate limit entries
   */
  async clearAllEntries(): Promise<void> {
    await this.store.clear();
    logger().info('All rate limit entries cleared');
  }

  /**
   * Get health status
   */
  async getHealthStatus(): Promise<{
    healthy: boolean;
    enabled: boolean;
    storeConnected: boolean;
    configuration: {
      maxRequests: number;
      windowMs: number;
      delayMs?: number;
    };
    activity: {
      totalRequests: number;
      rateLimitedRequests: number;
      uniqueIPs: number;
      successRate: number;
    };
  }> {
    let storeConnected = true;
    try {
      await this.store.getStats();
    } catch (error) {
      storeConnected = false;
      logger().error('Rate limiter store health check failed', { error });
    }

    const successRate = this.stats.totalRequests > 0
      ? Math.round(((this.stats.totalRequests - this.stats.rateLimitedRequests) / this.stats.totalRequests) * 100)
      : 100;

    return {
      healthy: storeConnected,
      enabled: this.config.enabled,
      storeConnected,
      configuration: {
        maxRequests: this.config.maxRequests,
        windowMs: this.config.windowMs,
        delayMs: this.config.delayMs,
      },
      activity: {
        totalRequests: this.stats.totalRequests,
        rateLimitedRequests: this.stats.rateLimitedRequests,
        uniqueIPs: this.stats.uniqueIPs.size,
        successRate,
      },
    };
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    logger().info('Rate limiting middleware destroyed');
  }
}

/**
 * Create rate limiting middleware from configuration
 */
export function createRateLimitingMiddleware(config: RateLimitOptions): RateLimitingMiddleware {
  return new RateLimitingMiddleware(config);
}