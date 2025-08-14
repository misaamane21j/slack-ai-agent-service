import { createClient, RedisClientType } from 'redis';
import { logger } from '../utils/logger';
import { getConfig } from '../config/environment';

/**
 * Rate limit configuration for different types of limits
 */
export interface RateLimitConfig {
  /** Maximum number of requests per window */
  maxRequests: number;
  /** Window size in seconds */
  windowSizeSeconds: number;
  /** Identifier for this rate limit (e.g., 'global', 'user:U123', 'job:build') */
  identifier: string;
  /** Optional prefix for Redis keys */
  keyPrefix?: string;
}

/**
 * Rate limit status information
 */
export interface RateLimitStatus {
  /** Whether the rate limit has been exceeded */
  isLimited: boolean;
  /** Current number of requests in the window */
  currentRequests: number;
  /** Maximum allowed requests */
  maxRequests: number;
  /** Seconds until the window resets */
  resetTimeSeconds: number;
  /** Current window start time */
  windowStart: number;
  /** Time when the rate limit will reset */
  resetTime: Date;
}

/**
 * Storage backend interface for rate limiting data
 */
export interface RateLimitStorage {
  /** Get current count for a key */
  getCount(key: string): Promise<number>;
  /** Increment count for a key, returns new count */
  incrementCount(key: string, windowSizeSeconds: number): Promise<number>;
  /** Get window start time for a key */
  getWindowStart(key: string): Promise<number | null>;
  /** Set window start time for a key */
  setWindowStart(key: string, timestamp: number, windowSizeSeconds: number): Promise<void>;
  /** Reset counters for a key */
  reset(key: string): Promise<void>;
  /** Check if storage is available */
  isAvailable(): boolean;
}

/**
 * Redis-based storage backend for rate limiting
 */
export class RedisRateLimitStorage implements RateLimitStorage {
  private redisClient: RedisClientType | null = null;
  private isConnected = false;

  constructor() {
    this.initialize();
  }

  private async initialize(): Promise<void> {
    try {
      const config = getConfig();
      this.redisClient = createClient({
        url: config.redis.url
      });

      this.redisClient.on('error', (err) => {
        logger().error('Redis rate limiter client error:', err);
        this.isConnected = false;
      });

      this.redisClient.on('connect', () => {
        logger().debug('Redis rate limiter client connected');
        this.isConnected = true;
      });

      this.redisClient.on('disconnect', () => {
        logger().warn('Redis rate limiter client disconnected');
        this.isConnected = false;
      });

      await this.redisClient.connect();
      this.isConnected = true;
      
      logger().info('✅ Redis rate limiter storage initialized');
    } catch (error) {
      logger().error('❌ Failed to initialize Redis rate limiter storage:', error);
      this.redisClient = null;
      this.isConnected = false;
    }
  }

  async getCount(key: string): Promise<number> {
    if (!this.redisClient || !this.isConnected) return 0;
    
    try {
      const count = await this.redisClient.get(`count:${key}`);
      return count ? parseInt(count, 10) : 0;
    } catch (error) {
      logger().error('Error getting count from Redis:', error);
      return 0;
    }
  }

  async incrementCount(key: string, windowSizeSeconds: number): Promise<number> {
    if (!this.redisClient || !this.isConnected) return 1;
    
    try {
      const countKey = `count:${key}`;
      const count = await this.redisClient.incr(countKey);
      
      // Set expiration on first increment
      if (count === 1) {
        await this.redisClient.expire(countKey, windowSizeSeconds);
      }
      
      return count;
    } catch (error) {
      logger().error('Error incrementing count in Redis:', error);
      return 1;
    }
  }

  async getWindowStart(key: string): Promise<number | null> {
    if (!this.redisClient || !this.isConnected) return null;
    
    try {
      const timestamp = await this.redisClient.get(`window:${key}`);
      return timestamp ? parseInt(timestamp, 10) : null;
    } catch (error) {
      logger().error('Error getting window start from Redis:', error);
      return null;
    }
  }

  async setWindowStart(key: string, timestamp: number, windowSizeSeconds: number): Promise<void> {
    if (!this.redisClient || !this.isConnected) return;
    
    try {
      const windowKey = `window:${key}`;
      await this.redisClient.setEx(windowKey, windowSizeSeconds, timestamp.toString());
    } catch (error) {
      logger().error('Error setting window start in Redis:', error);
    }
  }

  async reset(key: string): Promise<void> {
    if (!this.redisClient || !this.isConnected) return;
    
    try {
      await Promise.all([
        this.redisClient.del(`count:${key}`),
        this.redisClient.del(`window:${key}`)
      ]);
    } catch (error) {
      logger().error('Error resetting rate limit in Redis:', error);
    }
  }

  isAvailable(): boolean {
    return this.redisClient !== null && this.isConnected;
  }

  async disconnect(): Promise<void> {
    if (this.redisClient) {
      try {
        await this.redisClient.disconnect();
      } catch (error) {
        logger().error('Error disconnecting Redis rate limiter client:', error);
      }
    }
  }
}

/**
 * In-memory storage backend for rate limiting (fallback)
 */
export class MemoryRateLimitStorage implements RateLimitStorage {
  private counts = new Map<string, number>();
  private windows = new Map<string, number>();
  private timers = new Map<string, NodeJS.Timeout>();

  async getCount(key: string): Promise<number> {
    return this.counts.get(key) || 0;
  }

  async incrementCount(key: string, windowSizeSeconds: number): Promise<number> {
    const currentCount = this.counts.get(key) || 0;
    const newCount = currentCount + 1;
    this.counts.set(key, newCount);

    // Set window start if not exists
    if (!this.windows.has(key)) {
      await this.setWindowStart(key, Date.now(), windowSizeSeconds);
    }

    return newCount;
  }

  async getWindowStart(key: string): Promise<number | null> {
    return this.windows.get(key) || null;
  }

  async setWindowStart(key: string, timestamp: number, windowSizeSeconds: number): Promise<void> {
    this.windows.set(key, timestamp);

    // Clear existing timer
    const existingTimer = this.timers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set new cleanup timer
    const timer = setTimeout(() => {
      this.reset(key);
    }, windowSizeSeconds * 1000);
    
    this.timers.set(key, timer);
  }

  async reset(key: string): Promise<void> {
    this.counts.delete(key);
    this.windows.delete(key);
    
    const timer = this.timers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(key);
    }
  }

  isAvailable(): boolean {
    return true;
  }

  cleanup(): void {
    // Clear all timers
    this.timers.forEach((timer) => {
      clearTimeout(timer);
    });
    this.timers.clear();
    this.counts.clear();
    this.windows.clear();
  }
}

/**
 * Sliding window rate limiter implementation
 */
export class SlidingWindowRateLimiter {
  private storage: RateLimitStorage;
  private fallbackStorage: MemoryRateLimitStorage;

  constructor(storage?: RateLimitStorage) {
    this.fallbackStorage = new MemoryRateLimitStorage();
    this.storage = storage || new RedisRateLimitStorage();
  }

  /**
   * Check if a request is within rate limits and increment counter
   */
  async checkLimit(config: RateLimitConfig): Promise<RateLimitStatus> {
    const now = Date.now();
    const key = this.generateKey(config);
    const activeStorage = this.getActiveStorage();

    // Get current window start
    let windowStart = await activeStorage.getWindowStart(key);
    
    // Initialize window if doesn't exist or expired
    if (!windowStart || (now - windowStart) >= (config.windowSizeSeconds * 1000)) {
      windowStart = now;
      await activeStorage.setWindowStart(key, windowStart, config.windowSizeSeconds);
      // Reset count for new window
      await activeStorage.reset(key);
    }

    // Get current count and increment
    const currentCount = await activeStorage.incrementCount(key, config.windowSizeSeconds);
    
    const secondsRemaining = Math.max(0, config.windowSizeSeconds - Math.floor((now - windowStart) / 1000));
    const resetTime = new Date(windowStart + (config.windowSizeSeconds * 1000));

    return {
      isLimited: currentCount > config.maxRequests,
      currentRequests: currentCount,
      maxRequests: config.maxRequests,
      resetTimeSeconds: secondsRemaining,
      windowStart,
      resetTime
    };
  }

  /**
   * Check rate limit without incrementing counter
   */
  async checkLimitOnly(config: RateLimitConfig): Promise<RateLimitStatus> {
    const now = Date.now();
    const key = this.generateKey(config);
    const activeStorage = this.getActiveStorage();

    const windowStart = await activeStorage.getWindowStart(key);
    if (!windowStart || (now - windowStart) >= (config.windowSizeSeconds * 1000)) {
      // Window expired or doesn't exist
      return {
        isLimited: false,
        currentRequests: 0,
        maxRequests: config.maxRequests,
        resetTimeSeconds: config.windowSizeSeconds,
        windowStart: now,
        resetTime: new Date(now + (config.windowSizeSeconds * 1000))
      };
    }

    const currentCount = await activeStorage.getCount(key);
    const secondsRemaining = Math.max(0, config.windowSizeSeconds - Math.floor((now - windowStart) / 1000));
    const resetTime = new Date(windowStart + (config.windowSizeSeconds * 1000));

    return {
      isLimited: currentCount >= config.maxRequests,
      currentRequests: currentCount,
      maxRequests: config.maxRequests,
      resetTimeSeconds: secondsRemaining,
      windowStart,
      resetTime
    };
  }

  /**
   * Reset rate limit for a specific configuration
   */
  async resetLimit(config: RateLimitConfig): Promise<void> {
    const key = this.generateKey(config);
    const activeStorage = this.getActiveStorage();
    await activeStorage.reset(key);
  }

  /**
   * Generate Redis/storage key for rate limit configuration
   */
  private generateKey(config: RateLimitConfig): string {
    const prefix = config.keyPrefix || 'rate_limit';
    return `${prefix}:${config.identifier}:${config.windowSizeSeconds}`;
  }

  /**
   * Get active storage backend (Redis with fallback to memory)
   */
  private getActiveStorage(): RateLimitStorage {
    if (this.storage.isAvailable()) {
      return this.storage;
    }
    logger().debug('Using fallback memory storage for rate limiting');
    return this.fallbackStorage;
  }

  /**
   * Get storage status information
   */
  getStorageStatus(): { primary: boolean; fallback: boolean } {
    return {
      primary: this.storage.isAvailable(),
      fallback: this.fallbackStorage.isAvailable()
    };
  }

  /**
   * Get active storage backend (for use by RateLimiterService)
   */
  getActiveStorage(): RateLimitStorage {
    if (this.storage.isAvailable()) {
      return this.storage;
    }
    logger().debug('Using fallback memory storage for rate limiting');
    return this.fallbackStorage;
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    this.fallbackStorage.cleanup();
    if (this.storage instanceof RedisRateLimitStorage) {
      await this.storage.disconnect();
    }
  }
}

/**
 * Job type configurations for different rate limits
 */
export interface JobTypeConfig {
  /** Job type identifier (e.g., 'build', 'deploy', 'test') */
  jobType: string;
  /** Maximum requests per user for this job type */
  maxRequestsPerUser: number;
  /** Window size in seconds for user rate limiting */
  windowSizeSeconds: number;
  /** Cooldown period in seconds between job triggers for same user+job */
  cooldownSeconds: number;
  /** Global limit for this job type across all users */
  globalMaxRequests?: number;
  /** Global window size for this job type */
  globalWindowSeconds?: number;
}

/**
 * Cooldown status information
 */
export interface CooldownStatus {
  /** Whether the user is in cooldown for this job */
  isInCooldown: boolean;
  /** Seconds remaining in cooldown period */
  cooldownRemainingSeconds: number;
  /** Time when cooldown expires */
  cooldownExpiresAt?: Date;
  /** Last trigger time for this user+job combination */
  lastTriggerTime?: Date;
}

/**
 * Combined rate limit and cooldown status
 */
export interface JobTriggerStatus {
  /** Rate limit status */
  rateLimit: RateLimitStatus;
  /** Cooldown status */
  cooldown: CooldownStatus;
  /** Whether the request can proceed */
  canProceed: boolean;
  /** Reason if request cannot proceed */
  blockReason?: string;
}

/**
 * Rate limiter service factory and manager
 */
export class RateLimiterService {
  private static instance: RateLimiterService;
  private rateLimiter: SlidingWindowRateLimiter;
  private jobConfigs: Map<string, JobTypeConfig> = new Map();

  private constructor() {
    this.rateLimiter = new SlidingWindowRateLimiter();
    this.initializeDefaultJobConfigs();
  }

  /**
   * Initialize default job type configurations
   */
  private initializeDefaultJobConfigs(): void {
    // Default configurations for common Jenkins job types
    const defaultConfigs: JobTypeConfig[] = [
      {
        jobType: 'build',
        maxRequestsPerUser: 5,
        windowSizeSeconds: 300, // 5 minutes
        cooldownSeconds: 60, // 1 minute between builds
        globalMaxRequests: 20,
        globalWindowSeconds: 300
      },
      {
        jobType: 'deploy',
        maxRequestsPerUser: 2,
        windowSizeSeconds: 600, // 10 minutes
        cooldownSeconds: 300, // 5 minutes between deploys
        globalMaxRequests: 5,
        globalWindowSeconds: 600
      },
      {
        jobType: 'test',
        maxRequestsPerUser: 10,
        windowSizeSeconds: 300, // 5 minutes
        cooldownSeconds: 30, // 30 seconds between tests
        globalMaxRequests: 50,
        globalWindowSeconds: 300
      },
      {
        jobType: 'default',
        maxRequestsPerUser: 3,
        windowSizeSeconds: 300, // 5 minutes
        cooldownSeconds: 120, // 2 minutes between job triggers
        globalMaxRequests: 15,
        globalWindowSeconds: 300
      }
    ];

    for (const config of defaultConfigs) {
      this.jobConfigs.set(config.jobType, config);
    }
  }

  static getInstance(): RateLimiterService {
    if (!RateLimiterService.instance) {
      RateLimiterService.instance = new RateLimiterService();
    }
    return RateLimiterService.instance;
  }

  /**
   * Check rate limit for a user
   */
  async checkUserLimit(userId: string, maxRequests: number, windowSizeSeconds: number): Promise<RateLimitStatus> {
    const config: RateLimitConfig = {
      identifier: `user:${userId}`,
      maxRequests,
      windowSizeSeconds,
      keyPrefix: 'user_rate_limit'
    };
    return this.rateLimiter.checkLimit(config);
  }

  /**
   * Check rate limit for a job
   */
  async checkJobLimit(jobName: string, maxRequests: number, windowSizeSeconds: number): Promise<RateLimitStatus> {
    const config: RateLimitConfig = {
      identifier: `job:${jobName}`,
      maxRequests,
      windowSizeSeconds,
      keyPrefix: 'job_rate_limit'
    };
    return this.rateLimiter.checkLimit(config);
  }

  /**
   * Check combined user+job rate limit
   */
  async checkUserJobLimit(userId: string, jobName: string, maxRequests: number, windowSizeSeconds: number): Promise<RateLimitStatus> {
    const config: RateLimitConfig = {
      identifier: `user:${userId}:job:${jobName}`,
      maxRequests,
      windowSizeSeconds,
      keyPrefix: 'user_job_rate_limit'
    };
    return this.rateLimiter.checkLimit(config);
  }

  /**
   * Check global rate limit
   */
  async checkGlobalLimit(maxRequests: number, windowSizeSeconds: number): Promise<RateLimitStatus> {
    const config: RateLimitConfig = {
      identifier: 'global',
      maxRequests,
      windowSizeSeconds,
      keyPrefix: 'global_rate_limit'
    };
    return this.rateLimiter.checkLimit(config);
  }

  /**
   * Reset rate limit for a user
   */
  async resetUserLimit(userId: string, windowSizeSeconds: number): Promise<void> {
    const config: RateLimitConfig = {
      identifier: `user:${userId}`,
      maxRequests: 0, // Not used for reset
      windowSizeSeconds,
      keyPrefix: 'user_rate_limit'
    };
    await this.rateLimiter.resetLimit(config);
  }

  /**
   * Get rate limiter status
   */
  getStatus(): { primary: boolean; fallback: boolean } {
    return this.rateLimiter.getStorageStatus();
  }

  /**
   * Check cooldown status for a user+job combination
   */
  async checkCooldown(userId: string, jobName: string, jobType?: string): Promise<CooldownStatus> {
    const config = this.getJobConfig(jobType);
    const cooldownKey = `cooldown:${userId}:${jobName}`;
    const storage = this.rateLimiter.getActiveStorage();
    
    const lastTriggerTimestamp = await storage.getWindowStart(cooldownKey);
    if (!lastTriggerTimestamp) {
      return {
        isInCooldown: false,
        cooldownRemainingSeconds: 0
      };
    }

    const now = Date.now();
    const lastTriggerTime = new Date(lastTriggerTimestamp);
    const cooldownExpiresAt = new Date(lastTriggerTimestamp + (config.cooldownSeconds * 1000));
    const remainingMs = cooldownExpiresAt.getTime() - now;

    if (remainingMs <= 0) {
      return {
        isInCooldown: false,
        cooldownRemainingSeconds: 0,
        lastTriggerTime
      };
    }

    return {
      isInCooldown: true,
      cooldownRemainingSeconds: Math.ceil(remainingMs / 1000),
      cooldownExpiresAt,
      lastTriggerTime
    };
  }

  /**
   * Set cooldown for a user+job combination
   */
  async setCooldown(userId: string, jobName: string, jobType?: string): Promise<void> {
    const config = this.getJobConfig(jobType);
    const cooldownKey = `cooldown:${userId}:${jobName}`;
    const storage = this.rateLimiter.getActiveStorage();
    
    await storage.setWindowStart(cooldownKey, Date.now(), config.cooldownSeconds);
  }

  /**
   * Check if a job trigger is allowed (combines rate limiting and cooldown)
   */
  async checkJobTrigger(userId: string, jobName: string, jobType?: string): Promise<JobTriggerStatus> {
    const config = this.getJobConfig(jobType);
    
    // Check user rate limit for this job type
    const userRateLimit = await this.checkUserLimit(userId, config.maxRequestsPerUser, config.windowSizeSeconds);
    
    // Check global rate limit for this job type (if configured)
    let globalRateLimit: RateLimitStatus | undefined;
    if (config.globalMaxRequests && config.globalWindowSeconds) {
      globalRateLimit = await this.checkJobLimit(config.jobType, config.globalMaxRequests, config.globalWindowSeconds);
    }

    // Check cooldown for this specific user+job combination
    const cooldownStatus = await this.checkCooldown(userId, jobName, jobType);

    // Determine if request can proceed
    let canProceed = true;
    let blockReason: string | undefined;

    if (userRateLimit.isLimited) {
      canProceed = false;
      blockReason = `User rate limit exceeded for ${config.jobType} jobs (${userRateLimit.currentRequests}/${userRateLimit.maxRequests})`;
    } else if (globalRateLimit?.isLimited) {
      canProceed = false;
      blockReason = `Global rate limit exceeded for ${config.jobType} jobs (${globalRateLimit.currentRequests}/${globalRateLimit.maxRequests})`;
    } else if (cooldownStatus.isInCooldown) {
      canProceed = false;
      blockReason = `Cooldown period active for job "${jobName}" (${cooldownStatus.cooldownRemainingSeconds}s remaining)`;
    }

    return {
      rateLimit: userRateLimit,
      cooldown: cooldownStatus,
      canProceed,
      blockReason
    };
  }

  /**
   * Record a successful job trigger (increment counters and set cooldown)
   */
  async recordJobTrigger(userId: string, jobName: string, jobType?: string): Promise<void> {
    const config = this.getJobConfig(jobType);
    
    // Increment user rate limit counter
    await this.checkUserLimit(userId, config.maxRequestsPerUser, config.windowSizeSeconds);
    
    // Increment global rate limit counter (if configured)
    if (config.globalMaxRequests && config.globalWindowSeconds) {
      await this.checkJobLimit(config.jobType, config.globalMaxRequests, config.globalWindowSeconds);
    }

    // Set cooldown period
    await this.setCooldown(userId, jobName, jobType);
  }

  /**
   * Get job configuration by type
   */
  private getJobConfig(jobType?: string): JobTypeConfig {
    const configKey = jobType || 'default';
    const config = this.jobConfigs.get(configKey);
    
    if (!config) {
      logger().warn(`No configuration found for job type: ${configKey}, using default`);
      return this.jobConfigs.get('default')!;
    }
    
    return config;
  }

  /**
   * Update job configuration
   */
  setJobConfig(config: JobTypeConfig): void {
    this.jobConfigs.set(config.jobType, config);
    logger().info(`Updated job configuration for type: ${config.jobType}`, config);
  }

  /**
   * Get all job configurations
   */
  getJobConfigs(): Map<string, JobTypeConfig> {
    return new Map(this.jobConfigs);
  }

  /**
   * Reset cooldown for a specific user+job combination
   */
  async resetCooldown(userId: string, jobName: string): Promise<void> {
    const cooldownKey = `cooldown:${userId}:${jobName}`;
    const config: RateLimitConfig = {
      identifier: cooldownKey,
      maxRequests: 0, // Not used for reset
      windowSizeSeconds: 1, // Not used for reset
      keyPrefix: 'cooldown'
    };
    await this.rateLimiter.resetLimit(config);
  }

  /**
   * Get detailed status for a user across all job types
   */
  async getUserStatus(userId: string): Promise<{
    jobTypes: Array<{
      jobType: string;
      rateLimit: RateLimitStatus;
      config: JobTypeConfig;
    }>;
    globalLimits: Array<{
      jobType: string;
      rateLimit: RateLimitStatus;
    }>;
  }> {
    const jobTypes = [];
    const globalLimits = [];

    for (const [jobType, config] of this.jobConfigs) {
      if (jobType === 'default') continue;

      // Get user rate limit for this job type
      const userRateLimit = await this.rateLimiter.checkLimitOnly({
        identifier: `user:${userId}`,
        maxRequests: config.maxRequestsPerUser,
        windowSizeSeconds: config.windowSizeSeconds,
        keyPrefix: 'user_rate_limit'
      });

      jobTypes.push({
        jobType,
        rateLimit: userRateLimit,
        config
      });

      // Get global rate limit for this job type (if configured)
      if (config.globalMaxRequests && config.globalWindowSeconds) {
        const globalRateLimit = await this.rateLimiter.checkLimitOnly({
          identifier: `job:${config.jobType}`,
          maxRequests: config.globalMaxRequests,
          windowSizeSeconds: config.globalWindowSeconds,
          keyPrefix: 'job_rate_limit'
        });

        globalLimits.push({
          jobType,
          rateLimit: globalRateLimit
        });
      }
    }

    return { jobTypes, globalLimits };
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    await this.rateLimiter.cleanup();
  }
}