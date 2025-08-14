import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { 
  ActivityMonitor,
  RequestPattern,
  SuspiciousActivityResult,
  UserActivityMetrics,
  ActivityAnalysisConfig
} from '../../../src/services/activity-monitor';
import { RateLimitStorage } from '../../../src/services/rate-limiter';

// Mock dependencies
jest.mock('../../../src/utils/logger');
jest.mock('../../../src/services/rate-limiter');

describe('ActivityMonitor', () => {
  let activityMonitor: ActivityMonitor;
  let mockStorage: jest.Mocked<RateLimitStorage>;

  beforeEach(() => {
    mockStorage = {
      getCount: jest.fn(),
      incrementCount: jest.fn(),
      getWindowStart: jest.fn(),
      setWindowStart: jest.fn(),
      reset: jest.fn(),
      isAvailable: jest.fn().mockReturnValue(true)
    };

    const config: Partial<ActivityAnalysisConfig> = {
      rapidRequestWindowSeconds: 60,
      rapidRequestThreshold: 10,
      volumeAnalysisWindowSeconds: 300,
      volumeThreshold: 50,
      minHumanIntervalMs: 500,
      maxIdenticalRequests: 5,
      suspiciousScoreThreshold: 70,
      patternHistoryWindowSeconds: 3600
    };

    activityMonitor = new ActivityMonitor(mockStorage, config);
  });

  afterEach(async () => {
    await activityMonitor.cleanup();
  });

  describe('recordRequest', () => {
    it('should record request and return analysis', async () => {
      const pattern: RequestPattern = {
        userId: 'user123',
        timestamp: new Date(),
        action: 'build',
        channel: 'channel123',
        jobType: 'build',
        jobName: 'main-build'
      };

      const result = await activityMonitor.recordRequest(pattern);

      expect(result).toHaveProperty('userId', 'user123');
      expect(result).toHaveProperty('suspiciousScore');
      expect(result).toHaveProperty('isSuspicious');
      expect(result).toHaveProperty('flags');
      expect(result).toHaveProperty('details');
      expect(result).toHaveProperty('timestamp');
    });

    it('should handle errors gracefully', async () => {
      const pattern: RequestPattern = {
        userId: 'error-user',
        timestamp: new Date(),
        action: 'error-action'
      };

      // Mock storage to throw error
      mockStorage.setWindowStart.mockRejectedValue(new Error('Storage error'));

      const result = await activityMonitor.recordRequest(pattern);

      expect(result.suspiciousScore).toBe(0);
      expect(result.isSuspicious).toBe(false);
      expect(result.flags).toEqual([]);
    });
  });

  describe('analyzeActivity', () => {
    it('should return clean analysis for new user', async () => {
      const result = await activityMonitor.analyzeActivity('new-user');

      expect(result.userId).toBe('new-user');
      expect(result.suspiciousScore).toBe(0);
      expect(result.isSuspicious).toBe(false);
      expect(result.flags).toEqual([]);
      expect(result.details.rapidRequests.detected).toBe(false);
      expect(result.details.unusualVolume.detected).toBe(false);
      expect(result.details.botLikeBehavior.detected).toBe(false);
    });

    it('should detect rapid requests pattern', async () => {
      const userId = 'rapid-user';
      const patterns: RequestPattern[] = [];
      
      // Create 15 rapid requests (above threshold of 10)
      for (let i = 0; i < 15; i++) {
        patterns.push({
          userId,
          timestamp: new Date(Date.now() - (i * 1000)), // 1 second apart
          action: 'build'
        });
      }

      // Mock getUserPatterns to return our test patterns
      (activityMonitor as any).recentPatterns.set(userId, patterns);

      const result = await activityMonitor.analyzeActivity(userId);

      expect(result.details.rapidRequests.detected).toBe(true);
      expect(result.details.rapidRequests.count).toBe(15);
      expect(result.flags.some(flag => flag.includes('Rapid requests'))).toBe(true);
      expect(result.suspiciousScore).toBeGreaterThan(0);
    });

    it('should detect unusual volume pattern', async () => {
      const userId = 'volume-user';
      const patterns: RequestPattern[] = [];
      
      // Create 60 requests (above threshold of 50)
      for (let i = 0; i < 60; i++) {
        patterns.push({
          userId,
          timestamp: new Date(Date.now() - (i * 10000)), // 10 seconds apart
          action: `action-${i % 5}` // Some variety
        });
      }

      (activityMonitor as any).recentPatterns.set(userId, patterns);

      const result = await activityMonitor.analyzeActivity(userId);

      expect(result.details.unusualVolume.detected).toBe(true);
      expect(result.details.unusualVolume.count).toBe(60);
      expect(result.flags.some(flag => flag.includes('High volume'))).toBe(true);
      expect(result.suspiciousScore).toBeGreaterThan(0);
    });

    it('should detect bot-like behavior (rapid timing)', async () => {
      const userId = 'bot-user';
      const patterns: RequestPattern[] = [];
      
      // Create requests with very consistent short intervals (bot-like)
      for (let i = 0; i < 10; i++) {
        patterns.push({
          userId,
          timestamp: new Date(Date.now() - (i * 100)), // 100ms apart (below 500ms threshold)
          action: 'build'
        });
      }

      (activityMonitor as any).recentPatterns.set(userId, patterns);

      const result = await activityMonitor.analyzeActivity(userId);

      expect(result.details.botLikeBehavior.detected).toBe(true);
      expect(result.details.botLikeBehavior.averageIntervalMs).toBeLessThan(500);
      expect(result.flags.some(flag => flag.includes('Bot-like timing'))).toBe(true);
      expect(result.suspiciousScore).toBeGreaterThan(0);
    });

    it('should detect identical consecutive requests', async () => {
      const userId = 'identical-user';
      const patterns: RequestPattern[] = [];
      
      // Create 8 identical requests (above threshold of 5)
      for (let i = 0; i < 8; i++) {
        patterns.push({
          userId,
          timestamp: new Date(Date.now() - (i * 1000)),
          action: 'build',
          jobType: 'build',
          jobName: 'same-job'
        });
      }

      (activityMonitor as any).recentPatterns.set(userId, patterns);

      const result = await activityMonitor.analyzeActivity(userId);

      expect(result.details.botLikeBehavior.identicalRequestCount).toBe(8);
      expect(result.flags.some(flag => flag.includes('Identical requests'))).toBe(true);
      expect(result.suspiciousScore).toBeGreaterThan(0);
    });

    it('should detect low variety patterns', async () => {
      const userId = 'low-variety-user';
      const patterns: RequestPattern[] = [];
      
      // Create 15 requests with only 2 unique actions
      for (let i = 0; i < 15; i++) {
        patterns.push({
          userId,
          timestamp: new Date(Date.now() - (i * 5000)),
          action: i % 2 === 0 ? 'build' : 'deploy' // Only 2 unique actions
        });
      }

      (activityMonitor as any).recentPatterns.set(userId, patterns);

      const result = await activityMonitor.analyzeActivity(userId);

      expect(result.details.patternAnalysis.requestVariety).toBe(2);
      expect(result.flags.some(flag => flag.includes('Low variety'))).toBe(true);
    });

    it('should detect highly consistent timing', async () => {
      const userId = 'consistent-user';
      const patterns: RequestPattern[] = [];
      
      // Create requests with very consistent intervals
      const baseTime = Date.now();
      for (let i = 0; i < 10; i++) {
        patterns.push({
          userId,
          timestamp: new Date(baseTime - (i * 5000)), // Exactly 5 seconds apart
          action: `action-${i}`
        });
      }

      (activityMonitor as any).recentPatterns.set(userId, patterns);

      const result = await activityMonitor.analyzeActivity(userId);

      expect(result.details.patternAnalysis.timingConsistency).toBeLessThan(0.1);
      expect(result.flags.some(flag => flag.includes('Highly consistent timing'))).toBe(true);
    });

    it('should calculate high suspicious score for multiple flags', async () => {
      const userId = 'very-suspicious-user';
      const patterns: RequestPattern[] = [];
      
      // Create patterns that trigger multiple flags
      for (let i = 0; i < 20; i++) {
        patterns.push({
          userId,
          timestamp: new Date(Date.now() - (i * 100)), // Rapid and consistent
          action: 'build', // Same action (low variety)
          jobType: 'build',
          jobName: 'same-job'
        });
      }

      (activityMonitor as any).recentPatterns.set(userId, patterns);

      const result = await activityMonitor.analyzeActivity(userId);

      expect(result.suspiciousScore).toBeGreaterThan(70); // Above threshold
      expect(result.isSuspicious).toBe(true);
      expect(result.flags.length).toBeGreaterThan(1);
    });
  });

  describe('getUserMetrics', () => {
    it('should return null for non-existent user', async () => {
      const metrics = await activityMonitor.getUserMetrics('non-existent');
      expect(metrics).toBeNull();
    });

    it('should return metrics for tracked user', async () => {
      const userId = 'tracked-user';
      
      // Record some activity first
      await activityMonitor.recordRequest({
        userId,
        timestamp: new Date(),
        action: 'build'
      });

      const metrics = await activityMonitor.getUserMetrics(userId);
      
      expect(metrics).toBeTruthy();
      expect(metrics!.userId).toBe(userId);
      expect(metrics!.totalRequests).toBeGreaterThan(0);
    });
  });

  describe('getFlaggedUsers', () => {
    it('should return empty array when no flagged users', () => {
      const flaggedUsers = activityMonitor.getFlaggedUsers();
      expect(flaggedUsers).toEqual([]);
    });

    it('should return flagged users sorted by suspicious score', async () => {
      // Create users with different suspicious scores
      const user1 = 'moderate-user';
      const user2 = 'high-user';
      
      // Simulate high suspicious activity for user2
      const highSuspiciousPatterns: RequestPattern[] = [];
      for (let i = 0; i < 25; i++) {
        highSuspiciousPatterns.push({
          userId: user2,
          timestamp: new Date(Date.now() - (i * 50)),
          action: 'build'
        });
      }
      
      (activityMonitor as any).recentPatterns.set(user2, highSuspiciousPatterns);
      await activityMonitor.recordRequest({
        userId: user2,
        timestamp: new Date(),
        action: 'build'
      });

      // Simulate moderate suspicious activity for user1
      const moderatePatterns: RequestPattern[] = [];
      for (let i = 0; i < 12; i++) {
        moderatePatterns.push({
          userId: user1,
          timestamp: new Date(Date.now() - (i * 1000)),
          action: 'build'
        });
      }
      
      (activityMonitor as any).recentPatterns.set(user1, moderatePatterns);
      await activityMonitor.recordRequest({
        userId: user1,
        timestamp: new Date(),
        action: 'build'
      });

      const flaggedUsers = activityMonitor.getFlaggedUsers();
      
      expect(flaggedUsers.length).toBeGreaterThan(0);
      // Should be sorted by suspicious score (highest first)
      if (flaggedUsers.length > 1) {
        expect(flaggedUsers[0].metrics.suspiciousScore).toBeGreaterThanOrEqual(
          flaggedUsers[1].metrics.suspiciousScore
        );
      }
    });
  });

  describe('configuration management', () => {
    it('should update configuration', () => {
      const newConfig: Partial<ActivityAnalysisConfig> = {
        rapidRequestThreshold: 20,
        suspiciousScoreThreshold: 80
      };

      activityMonitor.updateConfig(newConfig);
      const config = activityMonitor.getConfig();

      expect(config.rapidRequestThreshold).toBe(20);
      expect(config.suspiciousScoreThreshold).toBe(80);
    });

    it('should return current configuration', () => {
      const config = activityMonitor.getConfig();

      expect(config).toHaveProperty('rapidRequestWindowSeconds');
      expect(config).toHaveProperty('rapidRequestThreshold');
      expect(config).toHaveProperty('volumeAnalysisWindowSeconds');
      expect(config).toHaveProperty('volumeThreshold');
      expect(config).toHaveProperty('minHumanIntervalMs');
      expect(config).toHaveProperty('maxIdenticalRequests');
      expect(config).toHaveProperty('suspiciousScoreThreshold');
      expect(config).toHaveProperty('patternHistoryWindowSeconds');
    });
  });

  describe('clearCache', () => {
    it('should clear all cached data', async () => {
      // Add some data
      await activityMonitor.recordRequest({
        userId: 'test-user',
        timestamp: new Date(),
        action: 'build'
      });

      // Verify data exists
      const metricsBefore = await activityMonitor.getUserMetrics('test-user');
      expect(metricsBefore).toBeTruthy();

      // Clear cache
      activityMonitor.clearCache();

      // Verify data is cleared
      const metricsAfter = await activityMonitor.getUserMetrics('test-user');
      expect(metricsAfter).toBeNull();
    });
  });

  describe('memory management', () => {
    it('should limit pattern cache size', async () => {
      const userId = 'memory-test-user';
      
      // Add more patterns than the max limit (1000)
      for (let i = 0; i < 1200; i++) {
        await activityMonitor.recordRequest({
          userId,
          timestamp: new Date(Date.now() - (i * 1000)),
          action: `action-${i}`
        });
      }

      const patterns = (activityMonitor as any).recentPatterns.get(userId) || [];
      expect(patterns.length).toBeLessThanOrEqual(1000);
    });

    it('should remove old patterns outside history window', async () => {
      const userId = 'old-pattern-user';
      const oldTimestamp = new Date(Date.now() - (2 * 3600 * 1000)); // 2 hours ago (outside 1 hour window)
      
      // Manually add old pattern
      (activityMonitor as any).recentPatterns.set(userId, [{
        userId,
        timestamp: oldTimestamp,
        action: 'old-action'
      }]);

      // Add new pattern (should filter out old one)
      await activityMonitor.recordRequest({
        userId,
        timestamp: new Date(),
        action: 'new-action'
      });

      const patterns = (activityMonitor as any).recentPatterns.get(userId) || [];
      expect(patterns.length).toBe(1);
      expect(patterns[0].action).toBe('new-action');
    });
  });

  describe('error resilience', () => {
    it('should handle storage errors during pattern storage', async () => {
      mockStorage.setWindowStart.mockRejectedValue(new Error('Storage error'));

      const pattern: RequestPattern = {
        userId: 'error-user',
        timestamp: new Date(),
        action: 'error-action'
      };

      // Should not throw
      const result = await activityMonitor.recordRequest(pattern);
      expect(result).toBeDefined();
      expect(result.suspiciousScore).toBe(0);
    });

    it('should handle analysis errors gracefully', async () => {
      const userId = 'analysis-error-user';
      
      // Create invalid pattern data that might cause analysis errors
      (activityMonitor as any).recentPatterns.set(userId, [
        { userId, timestamp: null, action: null }, // Invalid data
        { userId, timestamp: new Date(), action: 'valid' }
      ]);

      // Should not throw
      const result = await activityMonitor.analyzeActivity(userId);
      expect(result).toBeDefined();
      expect(result.userId).toBe(userId);
    });
  });
});