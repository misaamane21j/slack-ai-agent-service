import { logger } from '../utils/logger';
import { RateLimitStorage, RedisRateLimitStorage, MemoryRateLimitStorage } from './rate-limiter';

/**
 * Request pattern data for analysis
 */
export interface RequestPattern {
  userId: string;
  timestamp: Date;
  action: string;
  channel?: string;
  jobType?: string;
  jobName?: string;
  userAgent?: string;
  ipAddress?: string;
}

/**
 * Activity analysis configuration
 */
export interface ActivityAnalysisConfig {
  /** Time window for rapid request detection (seconds) */
  rapidRequestWindowSeconds: number;
  /** Maximum requests in rapid window before flagging */
  rapidRequestThreshold: number;
  /** Time window for volume analysis (seconds) */
  volumeAnalysisWindowSeconds: number;
  /** Maximum requests in volume window before flagging */
  volumeThreshold: number;
  /** Minimum interval between requests for bot detection (milliseconds) */
  minHumanIntervalMs: number;
  /** Maximum allowed identical requests in sequence */
  maxIdenticalRequests: number;
  /** Suspicious score threshold for flagging */
  suspiciousScoreThreshold: number;
  /** Time window for storing historical patterns (seconds) */
  patternHistoryWindowSeconds: number;
}

/**
 * Suspicious activity analysis result
 */
export interface SuspiciousActivityResult {
  userId: string;
  suspiciousScore: number;
  isSuspicious: boolean;
  flags: string[];
  details: {
    rapidRequests: {
      detected: boolean;
      count: number;
      windowSeconds: number;
      threshold: number;
    };
    unusualVolume: {
      detected: boolean;
      count: number;
      windowSeconds: number;
      threshold: number;
    };
    botLikeBehavior: {
      detected: boolean;
      averageIntervalMs: number;
      minExpectedMs: number;
      identicalRequestCount: number;
    };
    patternAnalysis: {
      requestVariety: number;
      timingConsistency: number;
      actionPatterns: string[];
    };
  };
  timestamp: Date;
}

/**
 * User activity metrics for monitoring
 */
export interface UserActivityMetrics {
  userId: string;
  totalRequests: number;
  uniqueActions: number;
  averageIntervalMs: number;
  lastActivity: Date;
  firstActivity: Date;
  suspiciousScore: number;
  flagCount: number;
  recentFlags: string[];
  isBlocked: boolean;
  blockReason?: string;
}

/**
 * Activity monitoring and suspicious behavior detection service
 */
export class ActivityMonitor {
  private storage: RateLimitStorage;
  private fallbackStorage: MemoryRateLimitStorage;
  private config: ActivityAnalysisConfig;

  // In-memory caches for performance
  private recentPatterns = new Map<string, RequestPattern[]>();
  private userMetricsCache = new Map<string, UserActivityMetrics>();
  
  constructor(storage?: RateLimitStorage, config?: Partial<ActivityAnalysisConfig>) {
    this.fallbackStorage = new MemoryRateLimitStorage();
    this.storage = storage || new RedisRateLimitStorage();
    
    // Default configuration
    this.config = {
      rapidRequestWindowSeconds: 60, // 1 minute
      rapidRequestThreshold: 10,
      volumeAnalysisWindowSeconds: 300, // 5 minutes
      volumeThreshold: 50,
      minHumanIntervalMs: 500, // 0.5 seconds minimum between human requests
      maxIdenticalRequests: 5,
      suspiciousScoreThreshold: 70,
      patternHistoryWindowSeconds: 3600, // 1 hour
      ...config
    };
  }

  /**
   * Record a user request and analyze for suspicious patterns
   */
  async recordRequest(pattern: RequestPattern): Promise<SuspiciousActivityResult> {
    try {
      // Store pattern in Redis/memory
      await this.storePattern(pattern);
      
      // Update in-memory cache
      this.updatePatternCache(pattern);
      
      // Analyze for suspicious activity
      const analysis = await this.analyzeActivity(pattern.userId);
      
      // Update user metrics
      await this.updateUserMetrics(pattern.userId, analysis);
      
      return analysis;
    } catch (error) {
      logger().error('Error recording request pattern:', error);
      
      // Return safe default
      return {
        userId: pattern.userId,
        suspiciousScore: 0,
        isSuspicious: false,
        flags: [],
        details: {
          rapidRequests: { detected: false, count: 0, windowSeconds: 0, threshold: 0 },
          unusualVolume: { detected: false, count: 0, windowSeconds: 0, threshold: 0 },
          botLikeBehavior: { detected: false, averageIntervalMs: 0, minExpectedMs: 0, identicalRequestCount: 0 },
          patternAnalysis: { requestVariety: 0, timingConsistency: 0, actionPatterns: [] }
        },
        timestamp: new Date()
      };
    }
  }

  /**
   * Analyze user activity for suspicious patterns
   */
  async analyzeActivity(userId: string): Promise<SuspiciousActivityResult> {
    const patterns = await this.getUserPatterns(userId);
    const now = new Date();
    
    // Initialize analysis result
    const result: SuspiciousActivityResult = {
      userId,
      suspiciousScore: 0,
      isSuspicious: false,
      flags: [],
      details: {
        rapidRequests: { detected: false, count: 0, windowSeconds: this.config.rapidRequestWindowSeconds, threshold: this.config.rapidRequestThreshold },
        unusualVolume: { detected: false, count: 0, windowSeconds: this.config.volumeAnalysisWindowSeconds, threshold: this.config.volumeThreshold },
        botLikeBehavior: { detected: false, averageIntervalMs: 0, minExpectedMs: this.config.minHumanIntervalMs, identicalRequestCount: 0 },
        patternAnalysis: { requestVariety: 0, timingConsistency: 0, actionPatterns: [] }
      },
      timestamp: now
    };

    if (patterns.length === 0) {
      return result;
    }

    // Analyze rapid requests
    this.analyzeRapidRequests(patterns, result);
    
    // Analyze unusual volume
    this.analyzeUnusualVolume(patterns, result);
    
    // Analyze bot-like behavior
    this.analyzeBotLikeBehavior(patterns, result);
    
    // Analyze patterns and variety
    this.analyzePatternVariety(patterns, result);
    
    // Calculate final suspicious score
    result.suspiciousScore = this.calculateSuspiciousScore(result);
    result.isSuspicious = result.suspiciousScore >= this.config.suspiciousScoreThreshold;
    
    return result;
  }

  /**
   * Analyze rapid successive requests
   */
  private analyzeRapidRequests(patterns: RequestPattern[], result: SuspiciousActivityResult): void {
    const windowMs = this.config.rapidRequestWindowSeconds * 1000;
    const cutoffTime = new Date(Date.now() - windowMs);
    
    const recentRequests = patterns.filter(p => p.timestamp >= cutoffTime);
    result.details.rapidRequests.count = recentRequests.length;
    
    if (recentRequests.length >= this.config.rapidRequestThreshold) {
      result.details.rapidRequests.detected = true;
      result.flags.push(`Rapid requests: ${recentRequests.length} in ${this.config.rapidRequestWindowSeconds}s`);
    }
  }

  /**
   * Analyze unusual request volume
   */
  private analyzeUnusualVolume(patterns: RequestPattern[], result: SuspiciousActivityResult): void {
    const windowMs = this.config.volumeAnalysisWindowSeconds * 1000;
    const cutoffTime = new Date(Date.now() - windowMs);
    
    const volumeRequests = patterns.filter(p => p.timestamp >= cutoffTime);
    result.details.unusualVolume.count = volumeRequests.length;
    
    if (volumeRequests.length >= this.config.volumeThreshold) {
      result.details.unusualVolume.detected = true;
      result.flags.push(`High volume: ${volumeRequests.length} requests in ${this.config.volumeAnalysisWindowSeconds}s`);
    }
  }

  /**
   * Analyze bot-like behavior patterns
   */
  private analyzeBotLikeBehavior(patterns: RequestPattern[], result: SuspiciousActivityResult): void {
    if (patterns.length < 2) return;

    // Sort by timestamp
    const sortedPatterns = patterns.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    
    // Calculate intervals between requests
    const intervals = [];
    for (let i = 1; i < sortedPatterns.length; i++) {
      const interval = sortedPatterns[i].timestamp.getTime() - sortedPatterns[i - 1].timestamp.getTime();
      intervals.push(interval);
    }

    // Calculate average interval
    const averageInterval = intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length;
    result.details.botLikeBehavior.averageIntervalMs = averageInterval;

    // Check for too-rapid requests (bot-like)
    if (averageInterval < this.config.minHumanIntervalMs) {
      result.details.botLikeBehavior.detected = true;
      result.flags.push(`Bot-like timing: ${Math.round(averageInterval)}ms average interval`);
    }

    // Check for identical consecutive requests
    let identicalCount = 0;
    let maxIdenticalStreak = 0;
    let currentStreak = 1;
    
    for (let i = 1; i < sortedPatterns.length; i++) {
      const current = sortedPatterns[i];
      const previous = sortedPatterns[i - 1];
      
      if (current.action === previous.action && 
          current.jobType === previous.jobType && 
          current.jobName === previous.jobName) {
        currentStreak++;
        identicalCount++;
      } else {
        maxIdenticalStreak = Math.max(maxIdenticalStreak, currentStreak);
        currentStreak = 1;
      }
    }
    
    maxIdenticalStreak = Math.max(maxIdenticalStreak, currentStreak);
    result.details.botLikeBehavior.identicalRequestCount = maxIdenticalStreak;
    
    if (maxIdenticalStreak >= this.config.maxIdenticalRequests) {
      result.details.botLikeBehavior.detected = true;
      result.flags.push(`Identical requests: ${maxIdenticalStreak} consecutive`);
    }
  }

  /**
   * Analyze pattern variety and consistency
   */
  private analyzePatternVariety(patterns: RequestPattern[], result: SuspiciousActivityResult): void {
    const uniqueActions = new Set(patterns.map(p => p.action));
    const uniqueJobTypes = new Set(patterns.map(p => p.jobType).filter(Boolean));
    const uniqueChannels = new Set(patterns.map(p => p.channel).filter(Boolean));
    
    result.details.patternAnalysis.requestVariety = uniqueActions.size;
    result.details.patternAnalysis.actionPatterns = Array.from(uniqueActions);
    
    // Low variety might indicate automated behavior
    if (patterns.length >= 10 && uniqueActions.size <= 2) {
      result.flags.push(`Low variety: ${uniqueActions.size} unique actions in ${patterns.length} requests`);
    }

    // Calculate timing consistency (standard deviation of intervals)
    if (patterns.length >= 3) {
      const sortedPatterns = patterns.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      const intervals = [];
      
      for (let i = 1; i < sortedPatterns.length; i++) {
        intervals.push(sortedPatterns[i].timestamp.getTime() - sortedPatterns[i - 1].timestamp.getTime());
      }
      
      const mean = intervals.reduce((sum, val) => sum + val, 0) / intervals.length;
      const variance = intervals.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / intervals.length;
      const stdDev = Math.sqrt(variance);
      
      // Coefficient of variation (lower values indicate more consistent timing)
      const cv = stdDev / mean;
      result.details.patternAnalysis.timingConsistency = cv;
      
      // Very consistent timing might indicate bot behavior
      if (cv < 0.1 && intervals.length >= 5) {
        result.flags.push(`Highly consistent timing: CV=${cv.toFixed(3)}`);
      }
    }
  }

  /**
   * Calculate overall suspicious score
   */
  private calculateSuspiciousScore(result: SuspiciousActivityResult): number {
    let score = 0;

    // Rapid requests scoring
    if (result.details.rapidRequests.detected) {
      const ratio = result.details.rapidRequests.count / result.details.rapidRequests.threshold;
      score += Math.min(30, ratio * 20);
    }

    // Volume scoring
    if (result.details.unusualVolume.detected) {
      const ratio = result.details.unusualVolume.count / result.details.unusualVolume.threshold;
      score += Math.min(25, ratio * 15);
    }

    // Bot behavior scoring
    if (result.details.botLikeBehavior.detected) {
      score += 25;
      
      // Additional penalty for very rapid requests
      if (result.details.botLikeBehavior.averageIntervalMs < 100) {
        score += 15;
      }
    }

    // Pattern variety scoring
    if (result.flags.some(flag => flag.includes('Low variety'))) {
      score += 10;
    }

    // Timing consistency scoring
    if (result.flags.some(flag => flag.includes('Highly consistent timing'))) {
      score += 15;
    }

    return Math.min(100, Math.round(score));
  }

  /**
   * Store request pattern in persistent storage
   */
  private async storePattern(pattern: RequestPattern): Promise<void> {
    const activeStorage = this.getActiveStorage();
    const key = `activity:${pattern.userId}:${pattern.timestamp.getTime()}`;
    const data = JSON.stringify(pattern);
    
    try {
      // Store with expiration based on history window
      await activeStorage.setWindowStart(key, Date.now(), this.config.patternHistoryWindowSeconds);
      
      // For Redis, we'd store the actual data differently
      // This is a simplified approach using the existing interface
      if (this.storage.isAvailable()) {
        // In a real implementation, we'd extend the storage interface for this
        logger().debug(`Stored activity pattern for user ${pattern.userId}`);
      }
    } catch (error) {
      logger().error('Error storing activity pattern:', error);
    }
  }

  /**
   * Update in-memory pattern cache
   */
  private updatePatternCache(pattern: RequestPattern): void {
    const userId = pattern.userId;
    const userPatterns = this.recentPatterns.get(userId) || [];
    
    // Add new pattern
    userPatterns.push(pattern);
    
    // Remove old patterns outside the history window
    const cutoffTime = new Date(Date.now() - (this.config.patternHistoryWindowSeconds * 1000));
    const filteredPatterns = userPatterns.filter(p => p.timestamp >= cutoffTime);
    
    // Keep only the most recent patterns to avoid memory issues
    const maxPatterns = 1000;
    if (filteredPatterns.length > maxPatterns) {
      filteredPatterns.splice(0, filteredPatterns.length - maxPatterns);
    }
    
    this.recentPatterns.set(userId, filteredPatterns);
  }

  /**
   * Get user patterns from cache or storage
   */
  private async getUserPatterns(userId: string): Promise<RequestPattern[]> {
    // First try in-memory cache
    const cachedPatterns = this.recentPatterns.get(userId);
    if (cachedPatterns && cachedPatterns.length > 0) {
      return cachedPatterns;
    }

    // In a full implementation, we'd retrieve from Redis here
    // For now, return empty array if no cache
    return [];
  }

  /**
   * Update user metrics based on analysis
   */
  private async updateUserMetrics(userId: string, analysis: SuspiciousActivityResult): Promise<void> {
    let metrics = this.userMetricsCache.get(userId);
    
    if (!metrics) {
      metrics = {
        userId,
        totalRequests: 0,
        uniqueActions: 0,
        averageIntervalMs: 0,
        lastActivity: new Date(),
        firstActivity: new Date(),
        suspiciousScore: 0,
        flagCount: 0,
        recentFlags: [],
        isBlocked: false
      };
    }

    // Update metrics
    metrics.totalRequests++;
    metrics.lastActivity = analysis.timestamp;
    metrics.suspiciousScore = analysis.suspiciousScore;
    
    if (analysis.flags.length > 0) {
      metrics.flagCount++;
      metrics.recentFlags.push(...analysis.flags);
      
      // Keep only recent flags (last 10)
      if (metrics.recentFlags.length > 10) {
        metrics.recentFlags = metrics.recentFlags.slice(-10);
      }
    }

    this.userMetricsCache.set(userId, metrics);
  }

  /**
   * Get user activity metrics
   */
  async getUserMetrics(userId: string): Promise<UserActivityMetrics | null> {
    return this.userMetricsCache.get(userId) || null;
  }

  /**
   * Get all flagged users
   */
  getFlaggedUsers(): Array<{ userId: string; metrics: UserActivityMetrics }> {
    const flaggedUsers = [];
    
    for (const [userId, metrics] of this.userMetricsCache) {
      if (metrics.suspiciousScore >= this.config.suspiciousScoreThreshold || metrics.flagCount > 0) {
        flaggedUsers.push({ userId, metrics });
      }
    }
    
    return flaggedUsers.sort((a, b) => b.metrics.suspiciousScore - a.metrics.suspiciousScore);
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<ActivityAnalysisConfig>): void {
    this.config = { ...this.config, ...newConfig };
    logger().info('Activity monitor configuration updated', this.config);
  }

  /**
   * Get current configuration
   */
  getConfig(): ActivityAnalysisConfig {
    return { ...this.config };
  }

  /**
   * Clear cache and reset metrics
   */
  clearCache(): void {
    this.recentPatterns.clear();
    this.userMetricsCache.clear();
    logger().info('Activity monitor cache cleared');
  }

  /**
   * Get active storage backend
   */
  private getActiveStorage(): RateLimitStorage {
    if (this.storage.isAvailable()) {
      return this.storage;
    }
    return this.fallbackStorage;
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    this.clearCache();
    this.fallbackStorage.cleanup();
    
    if (this.storage instanceof RedisRateLimitStorage) {
      await this.storage.disconnect();
    }
  }
}