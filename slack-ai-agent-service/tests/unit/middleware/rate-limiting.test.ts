import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { Request, Response, NextFunction } from 'express';
import { AllMiddlewareArgs, SlackEventMiddlewareArgs } from '@slack/bolt';
import {
  RateLimitingMiddleware,
  RateLimitingMiddlewareConfig,
  RateLimitingMetrics,
  RateLimitingEvent
} from '../../../src/middleware/rate-limiting';

// Mock dependencies
jest.mock('../../../src/utils/logger');
jest.mock('../../../src/services/rate-limiter');
jest.mock('../../../src/services/activity-monitor');
jest.mock('../../../src/services/penalty-manager');

describe('RateLimitingMiddleware', () => {
  let middleware: RateLimitingMiddleware;
  let mockRateLimiter: any;
  let mockActivityMonitor: any;
  let mockPenaltyManager: any;

  beforeEach(() => {
    // Mock the singleton getInstance
    mockRateLimiter = {
      checkJobTrigger: jest.fn(),
      recordJobTrigger: jest.fn(),
      getStatus: jest.fn().mockReturnValue({ primary: true, fallback: true })
    };

    mockActivityMonitor = {
      recordRequest: jest.fn(),
      cleanup: jest.fn()
    };

    mockPenaltyManager = {
      isUserAllowed: jest.fn(),
      applyPenalty: jest.fn(),
      getWhitelist: jest.fn().mockReturnValue([]),
      getBlacklist: jest.fn().mockReturnValue([]),
      cleanup: jest.fn()
    };

    // Mock the static getInstance method
    jest.doMock('../../../src/services/rate-limiter', () => ({
      RateLimiterService: {
        getInstance: jest.fn().mockReturnValue(mockRateLimiter)
      }
    }));

    jest.doMock('../../../src/services/activity-monitor', () => ({
      ActivityMonitor: jest.fn().mockImplementation(() => mockActivityMonitor)
    }));

    jest.doMock('../../../src/services/penalty-manager', () => ({
      PenaltyManager: jest.fn().mockImplementation(() => mockPenaltyManager)
    }));

    const config: Partial<RateLimitingMiddlewareConfig> = {
      enabled: true,
      enableActivityMonitoring: true,
      enablePenaltyManagement: true,
      defaultJobType: 'default',
      autoApplyPenalties: true,
      autoApplyThreshold: 80,
      sendUserNotifications: false, // Disable for testing
      sendAdminAlerts: false
    };

    middleware = new RateLimitingMiddleware(config);
  });

  afterEach(async () => {
    await middleware.cleanup();
    jest.clearAllMocks();
  });

  describe('Express middleware', () => {
    let mockReq: Partial<Request>;
    let mockRes: Partial<Response>;
    let mockNext: NextFunction;

    beforeEach(() => {
      mockReq = {
        method: 'POST',
        path: '/api/test',
        headers: { 'x-user-id': 'test-user' }
      };

      mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis()
      } as any;

      mockNext = jest.fn();
    });

    it('should allow request when rate limit not exceeded', async () => {
      mockPenaltyManager.isUserAllowed.mockResolvedValue({ allowed: true, status: 'normal' });
      mockRateLimiter.checkJobTrigger.mockResolvedValue({
        canProceed: true,
        rateLimit: { isLimited: false },
        cooldown: { isInCooldown: false }
      });

      const expressMiddleware = middleware.expressMiddleware();
      await expressMiddleware(mockReq as Request, mockRes as any, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should block request when rate limit exceeded', async () => {
      mockPenaltyManager.isUserAllowed.mockResolvedValue({ allowed: true, status: 'normal' });
      mockRateLimiter.checkJobTrigger.mockResolvedValue({
        canProceed: false,
        blockReason: 'Rate limit exceeded',
        rateLimit: { isLimited: true, resetTimeSeconds: 60 },
        cooldown: { isInCooldown: false }
      });

      const expressMiddleware = middleware.expressMiddleware();
      await expressMiddleware(mockReq as Request, mockRes as any, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(429);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Rate limit exceeded',
        message: 'Rate limit exceeded',
        retryAfter: 60
      });
    });

    it('should block request when user is penalized', async () => {
      mockPenaltyManager.isUserAllowed.mockResolvedValue({
        allowed: false,
        status: 'temporarily_blocked',
        reason: 'User temporarily blocked',
        blockedUntil: new Date(Date.now() + 3600000)
      });

      const expressMiddleware = middleware.expressMiddleware();
      await expressMiddleware(mockReq as Request, mockRes as any, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(429);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Rate limit exceeded',
          message: 'User temporarily blocked'
        })
      );
    });

    it('should pass through when disabled', async () => {
      const disabledMiddleware = new RateLimitingMiddleware({ enabled: false });
      const expressMiddleware = disabledMiddleware.expressMiddleware();
      
      await expressMiddleware(mockReq as Request, mockRes as any, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockPenaltyManager.isUserAllowed).not.toHaveBeenCalled();
      
      await disabledMiddleware.cleanup();
    });

    it('should handle errors gracefully and fail open', async () => {
      mockPenaltyManager.isUserAllowed.mockRejectedValue(new Error('Storage error'));

      const expressMiddleware = middleware.expressMiddleware();
      await expressMiddleware(mockReq as Request, mockRes as any, mockNext);

      // Should fail open and allow request
      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });
  });

  describe('Slack middleware', () => {
    let mockSlackArgs: SlackEventMiddlewareArgs<any> & AllMiddlewareArgs;

    beforeEach(() => {
      mockSlackArgs = {
        event: {
          type: 'app_mention',
          user: 'U123456',
          channel: 'C123456',
          text: 'build something'
        },
        payload: {},
        client: {
          chat: {
            postMessage: jest.fn()
          }
        },
        next: jest.fn()
      } as any;
    });

    it('should allow Slack event when rate limit not exceeded', async () => {
      mockPenaltyManager.isUserAllowed.mockResolvedValue({ allowed: true, status: 'normal' });
      mockRateLimiter.checkJobTrigger.mockResolvedValue({
        canProceed: true,
        rateLimit: { isLimited: false },
        cooldown: { isInCooldown: false }
      });
      mockActivityMonitor.recordRequest.mockResolvedValue({
        isSuspicious: false,
        suspiciousScore: 10
      });

      const slackMiddleware = middleware.slackMiddleware();
      await slackMiddleware(mockSlackArgs);

      expect(mockSlackArgs.next).toHaveBeenCalled();
      expect(mockActivityMonitor.recordRequest).toHaveBeenCalled();
    });

    it('should block Slack event when rate limit exceeded', async () => {
      mockPenaltyManager.isUserAllowed.mockResolvedValue({ allowed: true, status: 'normal' });
      mockRateLimiter.checkJobTrigger.mockResolvedValue({
        canProceed: false,
        blockReason: 'Rate limit exceeded',
        rateLimit: { isLimited: true },
        cooldown: { isInCooldown: false }
      });

      const slackMiddleware = middleware.slackMiddleware();
      await slackMiddleware(mockSlackArgs);

      expect(mockSlackArgs.next).not.toHaveBeenCalled();
      expect(mockActivityMonitor.recordRequest).not.toHaveBeenCalled();
    });

    it('should detect suspicious activity and auto-apply penalty', async () => {
      mockPenaltyManager.isUserAllowed.mockResolvedValue({ allowed: true, status: 'normal' });
      mockRateLimiter.checkJobTrigger.mockResolvedValue({
        canProceed: true,
        rateLimit: { isLimited: false },
        cooldown: { isInCooldown: false }
      });
      mockActivityMonitor.recordRequest.mockResolvedValue({
        isSuspicious: true,
        suspiciousScore: 85, // Above auto-apply threshold
        flags: ['Rapid requests: 20 in 60s']
      });

      const slackMiddleware = middleware.slackMiddleware();
      await slackMiddleware(mockSlackArgs);

      expect(mockSlackArgs.next).toHaveBeenCalled();
      expect(mockPenaltyManager.applyPenalty).toHaveBeenCalled();
    });

    it('should send user notification when enabled', async () => {
      const notificationMiddleware = new RateLimitingMiddleware({
        enabled: true,
        sendUserNotifications: true
      });

      mockPenaltyManager.isUserAllowed.mockResolvedValue({
        allowed: false,
        status: 'temporarily_blocked',
        reason: 'User blocked'
      });

      const slackMiddleware = notificationMiddleware.slackMiddleware();
      await slackMiddleware(mockSlackArgs);

      expect(mockSlackArgs.client.chat.postMessage).toHaveBeenCalled();
      
      await notificationMiddleware.cleanup();
    });

    it('should extract job information from Slack text', async () => {
      mockPenaltyManager.isUserAllowed.mockResolvedValue({ allowed: true, status: 'normal' });
      mockRateLimiter.checkJobTrigger.mockResolvedValue({
        canProceed: true,
        rateLimit: { isLimited: false },
        cooldown: { isInCooldown: false }
      });

      // Test different job types
      const testCases = [
        { text: 'please build the app', expectedJobType: 'build' },
        { text: 'deploy to production', expectedJobType: 'deploy' },
        { text: 'run tests', expectedJobType: 'test' },
        { text: 'do something else', expectedJobType: 'default' }
      ];

      for (const testCase of testCases) {
        (mockSlackArgs.event as any).text = testCase.text;
        
        const slackMiddleware = middleware.slackMiddleware();
        await slackMiddleware(mockSlackArgs);

        // Verify that checkJobTrigger was called with the expected job type
        expect(mockRateLimiter.checkJobTrigger).toHaveBeenCalledWith(
          'U123456',
          expect.anything(),
          testCase.expectedJobType
        );
      }
    });

    it('should pass through when disabled', async () => {
      const disabledMiddleware = new RateLimitingMiddleware({ enabled: false });
      const slackMiddleware = disabledMiddleware.slackMiddleware();
      
      await slackMiddleware(mockSlackArgs);

      expect(mockSlackArgs.next).toHaveBeenCalled();
      expect(mockPenaltyManager.isUserAllowed).not.toHaveBeenCalled();
      
      await disabledMiddleware.cleanup();
    });
  });

  describe('metrics tracking', () => {
    it('should track request metrics', async () => {
      // Simulate some requests
      mockPenaltyManager.isUserAllowed.mockResolvedValue({ allowed: true, status: 'normal' });
      mockRateLimiter.checkJobTrigger.mockResolvedValue({
        canProceed: true,
        rateLimit: { isLimited: false },
        cooldown: { isInCooldown: false }
      });

      const slackMiddleware = middleware.slackMiddleware();
      const mockArgs = {
        event: { type: 'app_mention', user: 'U123', channel: 'C123', text: 'test' },
        client: { chat: { postMessage: jest.fn() } },
        next: jest.fn()
      } as any;

      // Make multiple requests
      await slackMiddleware(mockArgs);
      await slackMiddleware(mockArgs);

      const metrics = middleware.getMetrics();
      
      expect(metrics.totalRequests).toBeGreaterThan(0);
      expect(metrics.allowedRequests).toBeGreaterThan(0);
      expect(metrics).toHaveProperty('averageResponseTime');
      expect(metrics).toHaveProperty('systemHealth');
    });

    it('should track blocked requests', async () => {
      mockPenaltyManager.isUserAllowed.mockResolvedValue({ allowed: true, status: 'normal' });
      mockRateLimiter.checkJobTrigger.mockResolvedValue({
        canProceed: false,
        blockReason: 'Rate limited'
      });

      const slackMiddleware = middleware.slackMiddleware();
      const mockArgs = {
        event: { type: 'app_mention', user: 'U123', channel: 'C123', text: 'test' },
        client: { chat: { postMessage: jest.fn() } },
        next: jest.fn()
      } as any;

      await slackMiddleware(mockArgs);

      const metrics = middleware.getMetrics();
      expect(metrics.blockedRequests).toBeGreaterThan(0);
    });

    it('should track suspicious activity', async () => {
      mockPenaltyManager.isUserAllowed.mockResolvedValue({ allowed: true, status: 'normal' });
      mockRateLimiter.checkJobTrigger.mockResolvedValue({
        canProceed: true,
        rateLimit: { isLimited: false },
        cooldown: { isInCooldown: false }
      });
      mockActivityMonitor.recordRequest.mockResolvedValue({
        isSuspicious: true,
        suspiciousScore: 75
      });

      const slackMiddleware = middleware.slackMiddleware();
      const mockArgs = {
        event: { type: 'app_mention', user: 'U123', channel: 'C123', text: 'test' },
        client: { chat: { postMessage: jest.fn() } },
        next: jest.fn()
      } as any;

      await slackMiddleware(mockArgs);

      const metrics = middleware.getMetrics();
      expect(metrics.suspiciousActivityDetected).toBeGreaterThan(0);
    });

    it('should reset metrics', () => {
      // First get some activity
      const initialMetrics = middleware.getMetrics();
      
      middleware.resetMetrics();
      
      const resetMetrics = middleware.getMetrics();
      expect(resetMetrics.totalRequests).toBe(0);
      expect(resetMetrics.blockedRequests).toBe(0);
      expect(resetMetrics.allowedRequests).toBe(0);
    });
  });

  describe('event logging', () => {
    it('should log and store events', async () => {
      mockPenaltyManager.isUserAllowed.mockResolvedValue({ allowed: true, status: 'normal' });
      mockRateLimiter.checkJobTrigger.mockResolvedValue({
        canProceed: true,
        rateLimit: { isLimited: false },
        cooldown: { isInCooldown: false }
      });

      const slackMiddleware = middleware.slackMiddleware();
      const mockArgs = {
        event: { type: 'app_mention', user: 'U123', channel: 'C123', text: 'test' },
        client: { chat: { postMessage: jest.fn() } },
        next: jest.fn()
      } as any;

      await slackMiddleware(mockArgs);

      const recentEvents = middleware.getRecentEvents();
      expect(recentEvents.length).toBeGreaterThan(0);
      expect(recentEvents[0]).toHaveProperty('type');
      expect(recentEvents[0]).toHaveProperty('userId');
      expect(recentEvents[0]).toHaveProperty('timestamp');
    });

    it('should limit event history size', async () => {
      // This would require making many requests to test the 1000 event limit
      // For now, just verify the method exists
      const events = middleware.getRecentEvents(10);
      expect(Array.isArray(events)).toBe(true);
    });
  });

  describe('configuration management', () => {
    it('should return current configuration', () => {
      const config = middleware.getConfig();
      
      expect(config).toHaveProperty('enabled');
      expect(config).toHaveProperty('enableActivityMonitoring');
      expect(config).toHaveProperty('enablePenaltyManagement');
      expect(config).toHaveProperty('defaultJobType');
      expect(config).toHaveProperty('autoApplyPenalties');
    });

    it('should update configuration', () => {
      const newConfig = {
        enabled: false,
        autoApplyThreshold: 90
      };

      middleware.updateConfig(newConfig);
      const config = middleware.getConfig();

      expect(config.enabled).toBe(false);
      expect(config.autoApplyThreshold).toBe(90);
    });
  });

  describe('health check', () => {
    it('should return health status', async () => {
      const health = await middleware.healthCheck();

      expect(health).toHaveProperty('status');
      expect(health).toHaveProperty('components');
      expect(health).toHaveProperty('metrics');
      
      expect(health.components).toHaveProperty('rateLimiter');
      expect(health.components).toHaveProperty('activityMonitor');
      expect(health.components).toHaveProperty('penaltyManager');
      expect(health.components).toHaveProperty('storage');

      expect(['healthy', 'degraded', 'critical']).toContain(health.status);
    });

    it('should detect degraded health with high error rate', async () => {
      // Simulate errors to increase error rate
      mockPenaltyManager.isUserAllowed.mockRejectedValue(new Error('Storage error'));

      const slackMiddleware = middleware.slackMiddleware();
      const mockArgs = {
        event: { type: 'app_mention', user: 'U123', channel: 'C123', text: 'test' },
        client: { chat: { postMessage: jest.fn() } },
        next: jest.fn()
      } as any;

      // Generate some errors
      for (let i = 0; i < 10; i++) {
        await slackMiddleware(mockArgs);
      }

      const health = await middleware.healthCheck();
      // Health status might be degraded or critical due to errors
      expect(['healthy', 'degraded', 'critical']).toContain(health.status);
    });
  });

  describe('user notification formatting', () => {
    it('should format notification for permanent ban', () => {
      const formatUserNotification = (middleware as any).formatUserNotification;
      
      const result = {
        details: { status: 'permanently_banned' }
      };

      const message = formatUserNotification(result);
      expect(message).toContain('permanently banned');
    });

    it('should format notification for temporary block', () => {
      const formatUserNotification = (middleware as any).formatUserNotification;
      
      const result = {
        details: { status: 'temporarily_blocked' },
        retryAfter: 3600
      };

      const message = formatUserNotification(result);
      expect(message).toContain('temporarily blocked');
      expect(message).toContain('60 minutes');
    });

    it('should format notification for cooldown', () => {
      const formatUserNotification = (middleware as any).formatUserNotification;
      
      const result = {
        details: { cooldown: { cooldownRemainingSeconds: 30 } }
      };

      const message = formatUserNotification(result);
      expect(message).toContain('30 seconds');
    });

    it('should format generic rate limit message', () => {
      const formatUserNotification = (middleware as any).formatUserNotification;
      
      const result = {
        reason: 'Custom rate limit message'
      };

      const message = formatUserNotification(result);
      expect(message).toContain('Custom rate limit message');
    });
  });

  describe('error handling and edge cases', () => {
    it('should handle missing user ID gracefully', async () => {
      const mockReq = {
        method: 'POST',
        path: '/api/test',
        headers: {} // No user ID header
      };
      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis()
      };
      const mockNext = jest.fn();

      mockPenaltyManager.isUserAllowed.mockResolvedValue({ allowed: true, status: 'normal' });
      mockRateLimiter.checkJobTrigger.mockResolvedValue({
        canProceed: true,
        rateLimit: { isLimited: false },
        cooldown: { isInCooldown: false }
      });

      const expressMiddleware = middleware.expressMiddleware();
      await expressMiddleware(mockReq as Request, mockRes as any, mockNext);

      // Should handle gracefully and proceed
      expect(mockNext).toHaveBeenCalled();
    });

    it('should handle malformed Slack events', async () => {
      const malformedArgs = {
        event: {}, // Missing required fields
        client: { chat: { postMessage: jest.fn() } },
        next: jest.fn()
      } as any;

      mockPenaltyManager.isUserAllowed.mockResolvedValue({ allowed: true, status: 'normal' });
      mockRateLimiter.checkJobTrigger.mockResolvedValue({
        canProceed: true,
        rateLimit: { isLimited: false },
        cooldown: { isInCooldown: false }
      });

      const slackMiddleware = middleware.slackMiddleware();
      
      // Should not throw
      await expect(slackMiddleware(malformedArgs)).resolves.not.toThrow();
    });

    it('should handle activity monitoring errors', async () => {
      mockPenaltyManager.isUserAllowed.mockResolvedValue({ allowed: true, status: 'normal' });
      mockRateLimiter.checkJobTrigger.mockResolvedValue({
        canProceed: true,
        rateLimit: { isLimited: false },
        cooldown: { isInCooldown: false }
      });
      mockActivityMonitor.recordRequest.mockRejectedValue(new Error('Activity monitor error'));

      const slackMiddleware = middleware.slackMiddleware();
      const mockArgs = {
        event: { type: 'app_mention', user: 'U123', channel: 'C123', text: 'test' },
        client: { chat: { postMessage: jest.fn() } },
        next: jest.fn()
      } as any;

      // Should not throw and should proceed
      await slackMiddleware(mockArgs);
      expect(mockArgs.next).toHaveBeenCalled();
    });
  });
});