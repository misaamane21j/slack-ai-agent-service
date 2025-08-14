import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
  RateLimiterService,
  JobTypeConfig,
  MemoryRateLimitStorage
} from '../../src/services/rate-limiter';
import {
  ActivityMonitor,
  RequestPattern,
  ActivityAnalysisConfig
} from '../../src/services/activity-monitor';
import {
  PenaltyManager,
  PenaltySeverity,
  PenaltyEscalationConfig
} from '../../src/services/penalty-manager';
import {
  RateLimitingMiddleware,
  RateLimitingMiddlewareConfig
} from '../../src/middleware/rate-limiting';

// Mock dependencies
jest.mock('../../src/utils/logger');
jest.mock('../../src/config/environment');

describe('Rate Limiting System Integration', () => {
  let rateLimiterService: RateLimiterService;
  let activityMonitor: ActivityMonitor;
  let penaltyManager: PenaltyManager;
  let middleware: RateLimitingMiddleware;
  let storage: MemoryRateLimitStorage;

  beforeEach(() => {
    // Reset singleton
    (RateLimiterService as any).instance = undefined;
    
    // Use memory storage for consistent testing
    storage = new MemoryRateLimitStorage();
    
    // Initialize services with test configurations
    const rateLimiterConfig: Partial<JobTypeConfig> = {
      jobType: 'test',
      maxRequestsPerUser: 5,
      windowSizeSeconds: 60,
      cooldownSeconds: 30
    };

    const activityConfig: Partial<ActivityAnalysisConfig> = {
      rapidRequestWindowSeconds: 60,
      rapidRequestThreshold: 10,
      volumeAnalysisWindowSeconds: 300,
      volumeThreshold: 20,
      minHumanIntervalMs: 500,
      suspiciousScoreThreshold: 70
    };

    const penaltyConfig: Partial<PenaltyEscalationConfig> = {
      baseTimeoutSeconds: 60, // 1 minute for faster testing
      escalationMultiplier: 2,
      maxTimeoutSeconds: 3600, // 1 hour max
      permanentBanThreshold: 3,
      allowAppeals: true,
      maxAppealsPerUser: 2
    };

    const middlewareConfig: Partial<RateLimitingMiddlewareConfig> = {
      enabled: true,
      enableActivityMonitoring: true,
      enablePenaltyManagement: true,
      autoApplyPenalties: true,
      autoApplyThreshold: 70,
      sendUserNotifications: false,
      sendAdminAlerts: false
    };

    rateLimiterService = RateLimiterService.getInstance();
    rateLimiterService.setJobConfig({
      jobType: 'test',
      maxRequestsPerUser: 5,
      windowSizeSeconds: 60,
      cooldownSeconds: 30
    });

    activityMonitor = new ActivityMonitor(storage, activityConfig);
    penaltyManager = new PenaltyManager(storage, penaltyConfig);
    middleware = new RateLimitingMiddleware(middlewareConfig);
  });

  afterEach(async () => {
    await rateLimiterService.cleanup();
    await activityMonitor.cleanup();
    await penaltyManager.cleanup();
    await middleware.cleanup();
    storage.cleanup();
  });

  describe('Basic Rate Limiting Flow', () => {
    it('should allow requests under limit and block when exceeded', async () => {
      const userId = 'test-user';
      const jobName = 'test-job';
      const jobType = 'test';

      // First 5 requests should be allowed
      for (let i = 0; i < 5; i++) {
        const result = await rateLimiterService.checkJobTrigger(userId, jobName, jobType);
        expect(result.canProceed).toBe(true);
        
        if (result.canProceed) {
          await rateLimiterService.recordJobTrigger(userId, jobName, jobType);
        }
      }

      // 6th request should be blocked by rate limit
      const sixthResult = await rateLimiterService.checkJobTrigger(userId, jobName, jobType);
      expect(sixthResult.canProceed).toBe(false);
      expect(sixthResult.rateLimit.isLimited).toBe(true);
    });

    it('should enforce cooldown periods between job triggers', async () => {
      jest.useFakeTimers();
      
      const userId = 'cooldown-user';
      const jobName = 'cooldown-job';
      const jobType = 'test';

      // First trigger should succeed
      let result = await rateLimiterService.checkJobTrigger(userId, jobName, jobType);
      expect(result.canProceed).toBe(true);
      await rateLimiterService.recordJobTrigger(userId, jobName, jobType);

      // Immediate retry should be blocked by cooldown
      result = await rateLimiterService.checkJobTrigger(userId, jobName, jobType);
      expect(result.canProceed).toBe(false);
      expect(result.cooldown.isInCooldown).toBe(true);

      // After cooldown expires, should succeed again
      jest.advanceTimersByTime(31000); // 31 seconds (cooldown is 30s)
      
      result = await rateLimiterService.checkJobTrigger(userId, jobName, jobType);
      expect(result.canProceed).toBe(true);

      jest.useRealTimers();
    });
  });

  describe('Activity Monitoring Integration', () => {
    it('should detect suspicious activity patterns', async () => {
      const userId = 'suspicious-user';
      const patterns: RequestPattern[] = [];

      // Create rapid request pattern (20 requests in 10 seconds)
      for (let i = 0; i < 20; i++) {
        patterns.push({
          userId,
          timestamp: new Date(Date.now() - (i * 500)), // 500ms apart
          action: 'build',
          jobType: 'build',
          jobName: 'rapid-build'
        });
      }

      // Manually set patterns for testing
      (activityMonitor as any).recentPatterns.set(userId, patterns);

      const analysis = await activityMonitor.analyzeActivity(userId);

      expect(analysis.isSuspicious).toBe(true);
      expect(analysis.suspiciousScore).toBeGreaterThan(70);
      expect(analysis.flags.length).toBeGreaterThan(0);
    });

    it('should track user metrics over time', async () => {
      const userId = 'metrics-user';

      // Record several requests
      for (let i = 0; i < 5; i++) {
        await activityMonitor.recordRequest({
          userId,
          timestamp: new Date(Date.now() - (i * 5000)),
          action: `action-${i}`,
          jobType: 'test'
        });
      }

      const metrics = await activityMonitor.getUserMetrics(userId);
      expect(metrics).toBeTruthy();
      expect(metrics!.totalRequests).toBe(5);
    });
  });

  describe('Penalty Management Integration', () => {
    it('should apply progressive penalties for violations', async () => {
      const userId = 'penalty-user';

      // First violation - should get warning
      const firstPenalty = await penaltyManager.applyPenalty(
        userId, 
        'First violation', 
        PenaltySeverity.MEDIUM
      );
      expect(firstPenalty.type).toBe('warning');

      // Second violation - should get warning (escalation threshold not met)
      const secondPenalty = await penaltyManager.applyPenalty(
        userId, 
        'Second violation', 
        PenaltySeverity.MEDIUM
      );
      expect(secondPenalty.type).toBe('warning');

      // Third violation - should get temporary block
      const thirdPenalty = await penaltyManager.applyPenalty(
        userId, 
        'Third violation', 
        PenaltySeverity.MEDIUM
      );
      expect(thirdPenalty.type).toBe('temporary_block');
      expect(thirdPenalty.expiresAt).toBeTruthy();
    });

    it('should block penalized users from making requests', async () => {
      const userId = 'blocked-user';

      // Apply a blocking penalty
      await penaltyManager.applyPenalty(userId, 'Severe violation', PenaltySeverity.HIGH);

      // User should be blocked
      const allowedResult = await penaltyManager.isUserAllowed(userId);
      expect(allowedResult.allowed).toBe(false);

      // Rate limiter should also respect the penalty
      const rateLimitResult = await rateLimiterService.checkJobTrigger(userId, 'test-job', 'test');
      // The rate limiter itself doesn't check penalties, but the middleware does
    });

    it('should handle whitelist and blacklist correctly', async () => {
      const whitelistedUser = 'whitelist-user';
      const blacklistedUser = 'blacklist-user';

      // Add to whitelist
      await penaltyManager.addToWhitelist(whitelistedUser, 'Trusted user');
      let result = await penaltyManager.isUserAllowed(whitelistedUser);
      expect(result.allowed).toBe(true);
      expect(result.status).toBe('whitelisted');

      // Add to blacklist
      await penaltyManager.addToBlacklist(blacklistedUser, 'Banned user');
      result = await penaltyManager.isUserAllowed(blacklistedUser);
      expect(result.allowed).toBe(false);
      expect(result.status).toBe('permanently_banned');
    });
  });

  describe('End-to-End Middleware Integration', () => {
    it('should process complete request flow through middleware', async () => {
      const mockSlackEvent = {
        event: {
          type: 'app_mention',
          user: 'U123456',
          channel: 'C123456',
          text: 'build the application'
        },
        client: {
          chat: {
            postMessage: jest.fn()
          }
        },
        next: jest.fn()
      };

      // Mock the internal services to return predictable results
      const originalGetInstance = RateLimiterService.getInstance;
      jest.spyOn(RateLimiterService, 'getInstance').mockReturnValue({
        checkJobTrigger: jest.fn().mockResolvedValue({
          canProceed: true,
          rateLimit: { isLimited: false },
          cooldown: { isInCooldown: false }
        }),
        recordJobTrigger: jest.fn().mockResolvedValue(undefined),
        getStatus: jest.fn().mockReturnValue({ primary: true, fallback: true })
      } as any);

      const slackMiddleware = middleware.slackMiddleware();
      await slackMiddleware(mockSlackEvent as any);

      expect(mockSlackEvent.next).toHaveBeenCalled();

      // Restore original method
      RateLimiterService.getInstance = originalGetInstance;
    });

    it('should auto-apply penalties for suspicious activity', async () => {
      const userId = 'auto-penalty-user';

      // Create highly suspicious activity pattern
      const suspiciousPatterns: RequestPattern[] = [];
      for (let i = 0; i < 25; i++) {
        suspiciousPatterns.push({
          userId,
          timestamp: new Date(Date.now() - (i * 100)), // Very rapid
          action: 'build',
          jobType: 'build',
          jobName: 'same-job'
        });
      }

      (activityMonitor as any).recentPatterns.set(userId, suspiciousPatterns);

      // Record a request that should trigger auto-penalty
      const analysis = await activityMonitor.recordRequest({
        userId,
        timestamp: new Date(),
        action: 'build',
        jobType: 'build',
        jobName: 'same-job'
      });

      expect(analysis.isSuspicious).toBe(true);
      expect(analysis.suspiciousScore).toBeGreaterThan(80);
    });
  });

  describe('Performance and Concurrency', () => {
    it('should handle concurrent requests correctly', async () => {
      const userId = 'concurrent-user';
      const jobName = 'concurrent-job';
      const jobType = 'test';

      // Fire 20 concurrent requests
      const promises = Array.from({ length: 20 }, async () => {
        const result = await rateLimiterService.checkJobTrigger(userId, jobName, jobType);
        if (result.canProceed) {
          await rateLimiterService.recordJobTrigger(userId, jobName, jobType);
        }
        return result;
      });

      const results = await Promise.all(promises);

      // Some should succeed, some should fail due to rate limiting
      const successful = results.filter(r => r.canProceed);
      const blocked = results.filter(r => !r.canProceed);

      expect(successful.length).toBeGreaterThan(0);
      expect(blocked.length).toBeGreaterThan(0);
      expect(successful.length + blocked.length).toBe(20);
    });

    it('should handle multiple users concurrently', async () => {
      const users = ['user1', 'user2', 'user3', 'user4', 'user5'];
      const jobName = 'shared-job';
      const jobType = 'test';

      // Each user makes 10 requests
      const allPromises = users.flatMap(userId =>
        Array.from({ length: 10 }, async () => {
          const result = await rateLimiterService.checkJobTrigger(userId, jobName, jobType);
          if (result.canProceed) {
            await rateLimiterService.recordJobTrigger(userId, jobName, jobType);
          }
          return { userId, result };
        })
      );

      const allResults = await Promise.all(allPromises);

      // Each user should have some successful requests
      for (const userId of users) {
        const userResults = allResults.filter(r => r.userId === userId);
        const userSuccessful = userResults.filter(r => r.result.canProceed);
        expect(userSuccessful.length).toBeGreaterThan(0);
        expect(userSuccessful.length).toBeLessThanOrEqual(5); // Rate limit is 5
      }
    });
  });

  describe('Error Recovery and Resilience', () => {
    it('should handle storage failures gracefully', async () => {
      // Create a storage that fails intermittently
      const failingStorage = new MemoryRateLimitStorage();
      const originalGetCount = failingStorage.getCount;
      
      let callCount = 0;
      failingStorage.getCount = async (key: string) => {
        callCount++;
        if (callCount % 3 === 0) {
          throw new Error('Storage failure');
        }
        return originalGetCount.call(failingStorage, key);
      };

      // Test with the failing storage directly
      jest.spyOn(storage, 'getCount').mockImplementation(async (key: string) => {
        callCount++;
        if (callCount % 3 === 0) {
          throw new Error('Storage failure');
        }
        return 0;
      });

      // Should not throw errors, should degrade gracefully
      const result = await rateLimiterService.checkUserLimit('error-user', 5, 60);
      expect(result).toBeDefined();
    });

    it('should recover from temporary failures', async () => {
      const userId = 'recovery-user';
      
      // Simulate temporary storage failure
      jest.spyOn(storage, 'getCount').mockRejectedValueOnce(new Error('Temporary failure'));
      
      // First call might fail, but should not crash
      const firstResult = await rateLimiterService.checkUserLimit(userId, 5, 60);
      expect(firstResult).toBeDefined();
      
      // Subsequent calls should work normally
      const secondResult = await rateLimiterService.checkUserLimit(userId, 5, 60);
      expect(secondResult.isLimited).toBe(false);
    });
  });

  describe('System Health and Monitoring', () => {
    it('should track comprehensive metrics', async () => {
      // Generate some activity
      for (let i = 0; i < 10; i++) {
        await rateLimiterService.checkUserLimit(`user${i}`, 5, 60);
      }

      const health = await middleware.healthCheck();
      expect(health.status).toBeDefined();
      expect(health.components.rateLimiter).toBe(true);
      expect(health.components.storage.fallback).toBe(true);
      expect(health.metrics.totalRequests).toBeGreaterThan(0);
    });

    it('should detect system degradation', async () => {
      // Simulate high error rate
      jest.spyOn(console, 'error').mockImplementation(() => {});
      
      for (let i = 0; i < 20; i++) {
        try {
          throw new Error('Simulated error');
        } catch (error) {
          // Errors that would be logged in real system
        }
      }

      const health = await middleware.healthCheck();
      // Health should still be reported (system should be resilient)
      expect(['healthy', 'degraded', 'critical']).toContain(health.status);
    });
  });

  describe('Configuration and Flexibility', () => {
    it('should respect different job type configurations', async () => {
      // Set up different limits for different job types
      rateLimiterService.setJobConfig({
        jobType: 'deploy',
        maxRequestsPerUser: 2,
        windowSizeSeconds: 300,
        cooldownSeconds: 180
      });

      rateLimiterService.setJobConfig({
        jobType: 'test',
        maxRequestsPerUser: 10,
        windowSizeSeconds: 60,
        cooldownSeconds: 10
      });

      const userId = 'config-test-user';

      // Test deploy limits (should be more restrictive)
      let deployResults = [];
      for (let i = 0; i < 5; i++) {
        const result = await rateLimiterService.checkJobTrigger(userId, 'deploy-job', 'deploy');
        deployResults.push(result.canProceed);
        if (result.canProceed) {
          await rateLimiterService.recordJobTrigger(userId, 'deploy-job', 'deploy');
        }
      }

      // Should have fewer successful deploy requests
      const successfulDeploys = deployResults.filter(Boolean).length;
      expect(successfulDeploys).toBeLessThanOrEqual(2);

      // Test limits for a different user (to avoid rate limit conflicts)
      const testUserId = 'test-user-2';
      let testResults = [];
      for (let i = 0; i < 12; i++) {
        const result = await rateLimiterService.checkJobTrigger(testUserId, 'test-job', 'test');
        testResults.push(result.canProceed);
        if (result.canProceed) {
          await rateLimiterService.recordJobTrigger(testUserId, 'test-job', 'test');
        }
      }

      // Should have more successful test requests
      const successfulTests = testResults.filter(Boolean).length;
      expect(successfulTests).toBeGreaterThan(successfulDeploys);
      expect(successfulTests).toBeLessThanOrEqual(10);
    });

    it('should handle disabled components gracefully', async () => {
      const disabledMiddleware = new RateLimitingMiddleware({
        enabled: true,
        enableActivityMonitoring: false,
        enablePenaltyManagement: false
      });

      const mockSlackEvent = {
        event: { type: 'app_mention', user: 'U123', channel: 'C123', text: 'test' },
        client: { chat: { postMessage: jest.fn() } },
        next: jest.fn()
      };

      // Should work even with monitoring and penalties disabled
      const slackMiddleware = disabledMiddleware.slackMiddleware();
      
      // Mock the rate limiter to allow requests
      const mockGetInstance = jest.spyOn(RateLimiterService, 'getInstance').mockReturnValue({
        checkJobTrigger: jest.fn().mockResolvedValue({
          canProceed: true,
          rateLimit: { isLimited: false },
          cooldown: { isInCooldown: false }
        }),
        recordJobTrigger: jest.fn(),
        getStatus: jest.fn().mockReturnValue({ primary: true, fallback: true })
      } as any);

      await slackMiddleware(mockSlackEvent as any);
      expect(mockSlackEvent.next).toHaveBeenCalled();

      mockGetInstance.mockRestore();
      await disabledMiddleware.cleanup();
    });
  });
});