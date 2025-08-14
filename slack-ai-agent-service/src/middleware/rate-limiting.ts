import { Request, Response, NextFunction } from 'express';
import { AllMiddlewareArgs, SlackEventMiddlewareArgs } from '@slack/bolt';
import { logger } from '../utils/logger';
import { RateLimiterService, JobTriggerStatus } from '../services/rate-limiter';
import { ActivityMonitor, RequestPattern, SuspiciousActivityResult } from '../services/activity-monitor';
import { PenaltyManager, UserStatus, PenaltySeverity } from '../services/penalty-manager';

/**
 * Rate limiting middleware configuration
 */
export interface RateLimitingMiddlewareConfig {
  /** Enable rate limiting */
  enabled: boolean;
  /** Enable activity monitoring */
  enableActivityMonitoring: boolean;
  /** Enable penalty management */
  enablePenaltyManagement: boolean;
  /** Default job type for unclassified requests */
  defaultJobType: string;
  /** Auto-apply penalties for suspicious activity */
  autoApplyPenalties: boolean;
  /** Threshold for auto-applying penalties */
  autoApplyThreshold: number;
  /** Send user notifications for rate limiting */
  sendUserNotifications: boolean;
  /** Send admin alerts for violations */
  sendAdminAlerts: boolean;
}

/**
 * Rate limiting metrics for monitoring
 */
export interface RateLimitingMetrics {
  totalRequests: number;
  blockedRequests: number;
  allowedRequests: number;
  warningsIssued: number;
  penaltiesApplied: number;
  suspiciousActivityDetected: number;
  whitelistedUsers: number;
  blacklistedUsers: number;
  averageResponseTime: number;
  systemHealth: 'healthy' | 'degraded' | 'critical';
  lastReset: Date;
}

/**
 * Rate limiting event for logging and monitoring
 */
export interface RateLimitingEvent {
  type: 'allowed' | 'blocked' | 'warning' | 'penalty' | 'suspicious' | 'error';
  userId: string;
  action: string;
  jobType?: string;
  jobName?: string;
  channel?: string;
  reason?: string;
  details?: any;
  timestamp: Date;
  processingTimeMs: number;
}

/**
 * Comprehensive rate limiting middleware system
 */
export class RateLimitingMiddleware {
  private rateLimiter: RateLimiterService;
  private activityMonitor: ActivityMonitor;
  private penaltyManager: PenaltyManager;
  private config: RateLimitingMiddlewareConfig;
  private metrics: RateLimitingMetrics;
  private eventHistory: RateLimitingEvent[] = [];

  constructor(config?: Partial<RateLimitingMiddlewareConfig>) {
    this.rateLimiter = RateLimiterService.getInstance();
    this.activityMonitor = new ActivityMonitor();
    this.penaltyManager = new PenaltyManager();
    
    this.config = {
      enabled: true,
      enableActivityMonitoring: true,
      enablePenaltyManagement: true,
      defaultJobType: 'default',
      autoApplyPenalties: true,
      autoApplyThreshold: 80,
      sendUserNotifications: true,
      sendAdminAlerts: true,
      ...config
    };

    this.metrics = this.initializeMetrics();
    
    logger().info('Rate limiting middleware initialized', this.config);
  }

  /**
   * Initialize metrics tracking
   */
  private initializeMetrics(): RateLimitingMetrics {
    return {
      totalRequests: 0,
      blockedRequests: 0,
      allowedRequests: 0,
      warningsIssued: 0,
      penaltiesApplied: 0,
      suspiciousActivityDetected: 0,
      whitelistedUsers: this.penaltyManager.getWhitelist().length,
      blacklistedUsers: this.penaltyManager.getBlacklist().length,
      averageResponseTime: 0,
      systemHealth: 'healthy',
      lastReset: new Date()
    };
  }

  /**
   * Express middleware for rate limiting HTTP requests
   */
  expressMiddleware = () => {
    return async (req: Request, res: Response, next: NextFunction) => {
      if (!this.config.enabled) {
        return next();
      }

      const startTime = Date.now();
      const userId = this.extractUserIdFromRequest(req);
      const action = this.extractActionFromRequest(req);

      try {
        const result = await this.checkRateLimit(userId, action, 'http');
        
        if (!result.allowed) {
          this.logEvent({
            type: 'blocked',
            userId,
            action,
            reason: result.reason,
            details: result.details,
            timestamp: new Date(),
            processingTimeMs: Date.now() - startTime
          });

          return res.status(429).json({
            error: 'Rate limit exceeded',
            message: result.reason,
            retryAfter: result.retryAfter
          });
        }

        this.logEvent({
          type: 'allowed',
          userId,
          action,
          timestamp: new Date(),
          processingTimeMs: Date.now() - startTime
        });

        next();
      } catch (error) {
        logger().error('Rate limiting middleware error:', error);
        this.logEvent({
          type: 'error',
          userId,
          action,
          reason: 'Middleware error',
          details: { error: error instanceof Error ? error.message : 'Unknown error' },
          timestamp: new Date(),
          processingTimeMs: Date.now() - startTime
        });
        
        // Fail open - allow request to proceed
        next();
      }
    };
  };

  /**
   * Slack bot middleware for rate limiting Slack events
   */
  slackMiddleware = () => {
    return async ({ event, payload, client, next }: SlackEventMiddlewareArgs<any> & AllMiddlewareArgs) => {
      if (!this.config.enabled) {
        return next();
      }

      const startTime = Date.now();
      const userId = this.extractUserIdFromSlackEvent(event);
      const action = this.extractActionFromSlackEvent(event);
      const channel = this.extractChannelFromSlackEvent(event);
      const jobInfo = this.extractJobInfoFromSlackEvent(event);

      try {
        const result = await this.checkRateLimit(userId, action, jobInfo.jobType, jobInfo.jobName, channel);
        
        if (!result.allowed) {
          this.logEvent({
            type: 'blocked',
            userId,
            action,
            jobType: jobInfo.jobType,
            jobName: jobInfo.jobName,
            channel,
            reason: result.reason,
            details: result.details,
            timestamp: new Date(),
            processingTimeMs: Date.now() - startTime
          });

          // Send user notification if enabled
          if (this.config.sendUserNotifications) {
            await this.sendUserNotification(client, userId, channel, result);
          }

          // Do not call next() - block the request
          return;
        }

        // Record successful request for activity monitoring
        if (this.config.enableActivityMonitoring) {
          await this.recordActivity(userId, action, jobInfo.jobType, jobInfo.jobName, channel);
        }

        this.logEvent({
          type: 'allowed',
          userId,
          action,
          jobType: jobInfo.jobType,
          jobName: jobInfo.jobName,
          channel,
          timestamp: new Date(),
          processingTimeMs: Date.now() - startTime
        });

        next();
      } catch (error) {
        logger().error('Slack rate limiting middleware error:', error);
        this.logEvent({
          type: 'error',
          userId,
          action,
          reason: 'Middleware error',
          details: { error: error instanceof Error ? error.message : 'Unknown error' },
          timestamp: new Date(),
          processingTimeMs: Date.now() - startTime
        });
        
        // Fail open - allow request to proceed
        next();
      }
    };
  };

  /**
   * Check rate limit for a user action
   */
  private async checkRateLimit(
    userId: string, 
    action: string, 
    jobType?: string, 
    jobName?: string, 
    channel?: string
  ): Promise<{
    allowed: boolean;
    reason?: string;
    retryAfter?: number;
    details?: any;
  }> {
    const startTime = Date.now();
    this.metrics.totalRequests++;

    try {
      // First check penalty status
      if (this.config.enablePenaltyManagement) {
        const penaltyStatus = await this.penaltyManager.isUserAllowed(userId);
        if (!penaltyStatus.allowed) {
          this.metrics.blockedRequests++;
          return {
            allowed: false,
            reason: penaltyStatus.reason,
            retryAfter: penaltyStatus.blockedUntil ? 
              Math.ceil((penaltyStatus.blockedUntil.getTime() - Date.now()) / 1000) : undefined,
            details: { status: penaltyStatus.status }
          };
        }
      }

      // Check rate limits
      const effectiveJobType = jobType || this.config.defaultJobType;
      const effectiveJobName = jobName || action;
      
      const rateLimitResult = await this.rateLimiter.checkJobTrigger(userId, effectiveJobName, effectiveJobType);
      
      if (!rateLimitResult.canProceed) {
        this.metrics.blockedRequests++;
        return {
          allowed: false,
          reason: rateLimitResult.blockReason,
          retryAfter: rateLimitResult.cooldown.cooldownRemainingSeconds || rateLimitResult.rateLimit.resetTimeSeconds,
          details: { 
            rateLimit: rateLimitResult.rateLimit,
            cooldown: rateLimitResult.cooldown
          }
        };
      }

      // Record successful job trigger
      await this.rateLimiter.recordJobTrigger(userId, effectiveJobName, effectiveJobType);

      this.metrics.allowedRequests++;
      this.updateAverageResponseTime(Date.now() - startTime);
      
      return { allowed: true };

    } catch (error) {
      logger().error('Error checking rate limit:', error);
      this.metrics.allowedRequests++; // Fail open
      return { allowed: true };
    }
  }

  /**
   * Record user activity for monitoring
   */
  private async recordActivity(
    userId: string, 
    action: string, 
    jobType?: string, 
    jobName?: string, 
    channel?: string
  ): Promise<void> {
    try {
      const pattern: RequestPattern = {
        userId,
        timestamp: new Date(),
        action,
        channel,
        jobType,
        jobName
      };

      const analysis = await this.activityMonitor.recordRequest(pattern);
      
      if (analysis.isSuspicious) {
        this.metrics.suspiciousActivityDetected++;
        
        this.logEvent({
          type: 'suspicious',
          userId,
          action,
          jobType,
          jobName,
          channel,
          reason: `Suspicious activity detected (score: ${analysis.suspiciousScore})`,
          details: analysis,
          timestamp: new Date(),
          processingTimeMs: 0
        });

        // Auto-apply penalty if enabled and threshold exceeded
        if (this.config.autoApplyPenalties && analysis.suspiciousScore >= this.config.autoApplyThreshold) {
          await this.autoApplyPenalty(userId, analysis);
        }

        // Send admin alert if enabled
        if (this.config.sendAdminAlerts) {
          await this.sendAdminAlert(userId, analysis);
        }
      }
    } catch (error) {
      logger().error('Error recording activity:', error);
    }
  }

  /**
   * Auto-apply penalty for suspicious activity
   */
  private async autoApplyPenalty(userId: string, analysis: SuspiciousActivityResult): Promise<void> {
    try {
      let severity: PenaltySeverity;
      
      if (analysis.suspiciousScore >= 95) {
        severity = PenaltySeverity.CRITICAL;
      } else if (analysis.suspiciousScore >= 85) {
        severity = PenaltySeverity.HIGH;
      } else {
        severity = PenaltySeverity.MEDIUM;
      }

      const reason = `Automatic penalty for suspicious activity (score: ${analysis.suspiciousScore}, flags: ${analysis.flags.join(', ')})`;
      
      const penalty = await this.penaltyManager.applyPenalty(userId, reason, severity, {
        suspiciousActivity: analysis,
        autoApplied: true
      });

      this.metrics.penaltiesApplied++;
      
      this.logEvent({
        type: 'penalty',
        userId,
        action: 'auto_penalty',
        reason,
        details: { penalty, analysis },
        timestamp: new Date(),
        processingTimeMs: 0
      });

    } catch (error) {
      logger().error('Error auto-applying penalty:', error);
    }
  }

  /**
   * Send user notification for rate limiting
   */
  private async sendUserNotification(client: any, userId: string, channel: string, result: any): Promise<void> {
    try {
      const message = this.formatUserNotification(result);
      
      await client.chat.postMessage({
        channel: userId, // DM the user
        text: message,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: message
            }
          }
        ]
      });
    } catch (error) {
      logger().error('Error sending user notification:', error);
    }
  }

  /**
   * Format user notification message
   */
  private formatUserNotification(result: any): string {
    if (result.details?.status === UserStatus.PERMANENTLY_BANNED) {
      return '🚫 Your account has been permanently banned due to repeated violations.';
    }
    
    if (result.details?.status === UserStatus.TEMPORARILY_BLOCKED) {
      const retryText = result.retryAfter ? ` Please try again in ${Math.ceil(result.retryAfter / 60)} minutes.` : '';
      return `⏳ You've been temporarily blocked due to rate limiting.${retryText}`;
    }
    
    if (result.details?.cooldown) {
      return `🕐 Please wait ${result.details.cooldown.cooldownRemainingSeconds} seconds before triggering this job again.`;
    }
    
    return `⚠️ Rate limit exceeded. ${result.reason || 'Please slow down your requests.'}`;
  }

  /**
   * Send admin alert for suspicious activity
   */
  private async sendAdminAlert(userId: string, analysis: SuspiciousActivityResult): Promise<void> {
    try {
      // This would typically send to an admin channel or alerting system
      logger().warn('ADMIN ALERT: Suspicious activity detected', {
        userId,
        suspiciousScore: analysis.suspiciousScore,
        flags: analysis.flags,
        details: analysis.details
      });
    } catch (error) {
      logger().error('Error sending admin alert:', error);
    }
  }

  /**
   * Extract user ID from various sources
   */
  private extractUserIdFromRequest(req: Request): string {
    return req.headers['x-user-id'] as string || 'unknown';
  }

  private extractUserIdFromSlackEvent(event: any): string {
    return event.user || event.user_id || 'unknown';
  }

  /**
   * Extract action from various sources
   */
  private extractActionFromRequest(req: Request): string {
    return `${req.method} ${req.path}`;
  }

  private extractActionFromSlackEvent(event: any): string {
    if (event.type === 'app_mention') return 'mention';
    if (event.type === 'message') return 'message';
    return event.type || 'unknown';
  }

  /**
   * Extract channel from Slack event
   */
  private extractChannelFromSlackEvent(event: any): string | undefined {
    return event.channel;
  }

  /**
   * Extract job information from Slack event
   */
  private extractJobInfoFromSlackEvent(event: any): { jobType?: string; jobName?: string } {
    const text = event.text || '';
    
    // Simple pattern matching for job triggers
    if (text.includes('build')) {
      return { jobType: 'build', jobName: 'build' };
    }
    if (text.includes('deploy')) {
      return { jobType: 'deploy', jobName: 'deploy' };
    }
    if (text.includes('test')) {
      return { jobType: 'test', jobName: 'test' };
    }
    
    return { jobType: this.config.defaultJobType, jobName: 'default' };
  }

  /**
   * Log rate limiting event
   */
  private logEvent(event: RateLimitingEvent): void {
    this.eventHistory.push(event);
    
    // Keep only recent events (last 1000)
    if (this.eventHistory.length > 1000) {
      this.eventHistory = this.eventHistory.slice(-1000);
    }

    // Log based on event type
    switch (event.type) {
      case 'blocked':
        logger().warn(`Rate limit blocked: User ${event.userId}, Action: ${event.action}, Reason: ${event.reason}`);
        break;
      case 'suspicious':
        logger().warn(`Suspicious activity: User ${event.userId}, Action: ${event.action}, Reason: ${event.reason}`);
        break;
      case 'penalty':
        logger().info(`Penalty applied: User ${event.userId}, Reason: ${event.reason}`);
        break;
      case 'error':
        logger().error(`Rate limiting error: User ${event.userId}, Action: ${event.action}, Reason: ${event.reason}`);
        break;
      default:
        logger().debug(`Rate limiting event: ${event.type} for user ${event.userId}`);
    }
  }

  /**
   * Update average response time metric
   */
  private updateAverageResponseTime(responseTime: number): void {
    const count = this.metrics.allowedRequests + this.metrics.blockedRequests;
    this.metrics.averageResponseTime = ((this.metrics.averageResponseTime * (count - 1)) + responseTime) / count;
  }

  /**
   * Get current metrics
   */
  getMetrics(): RateLimitingMetrics {
    // Update dynamic metrics
    this.metrics.whitelistedUsers = this.penaltyManager.getWhitelist().length;
    this.metrics.blacklistedUsers = this.penaltyManager.getBlacklist().length;
    
    // Determine system health
    const errorRate = this.eventHistory.filter(e => e.type === 'error').length / Math.max(this.eventHistory.length, 1);
    const blockRate = this.metrics.blockedRequests / Math.max(this.metrics.totalRequests, 1);
    
    if (errorRate > 0.1 || blockRate > 0.5) {
      this.metrics.systemHealth = 'critical';
    } else if (errorRate > 0.05 || blockRate > 0.2) {
      this.metrics.systemHealth = 'degraded';
    } else {
      this.metrics.systemHealth = 'healthy';
    }
    
    return { ...this.metrics };
  }

  /**
   * Get recent events
   */
  getRecentEvents(limit: number = 100): RateLimitingEvent[] {
    return this.eventHistory.slice(-limit);
  }

  /**
   * Reset metrics
   */
  resetMetrics(): void {
    this.metrics = this.initializeMetrics();
    this.eventHistory = [];
    logger().info('Rate limiting metrics reset');
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<RateLimitingMiddlewareConfig>): void {
    this.config = { ...this.config, ...newConfig };
    logger().info('Rate limiting middleware configuration updated', this.config);
  }

  /**
   * Get current configuration
   */
  getConfig(): RateLimitingMiddlewareConfig {
    return { ...this.config };
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'critical';
    components: {
      rateLimiter: boolean;
      activityMonitor: boolean;
      penaltyManager: boolean;
      storage: { primary: boolean; fallback: boolean };
    };
    metrics: RateLimitingMetrics;
  }> {
    const storageStatus = this.rateLimiter.getStatus();
    
    return {
      status: this.metrics.systemHealth,
      components: {
        rateLimiter: true, // Always available
        activityMonitor: this.config.enableActivityMonitoring,
        penaltyManager: this.config.enablePenaltyManagement,
        storage: storageStatus
      },
      metrics: this.getMetrics()
    };
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    await this.activityMonitor.cleanup();
    await this.penaltyManager.cleanup();
    this.eventHistory = [];
    logger().info('Rate limiting middleware cleaned up');
  }
}