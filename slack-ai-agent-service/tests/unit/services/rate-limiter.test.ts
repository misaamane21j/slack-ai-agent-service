import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { 
  RateLimiterService, 
  RateLimitConfig, 
  RateLimitStatus,
  JobTypeConfig,
  JobTriggerStatus,
  SlidingWindowRateLimiter,
  RedisRateLimitStorage,
  MemoryRateLimitStorage,
  RateLimitStorage
} from '../../../src/services/rate-limiter';

// Mock dependencies
jest.mock('../../../src/utils/logger');
jest.mock('../../../src/config/environment');
jest.mock('redis');

describe('MemoryRateLimitStorage', () => {
  let storage: MemoryRateLimitStorage;

  beforeEach(() => {
    storage = new MemoryRateLimitStorage();
  });

  afterEach(async () => {
    storage.cleanup();
  });

  describe('getCount', () => {
    it('should return 0 for non-existent key', async () => {
      const count = await storage.getCount('test-key');
      expect(count).toBe(0);
    });
  });

  describe('incrementCount', () => {
    it('should increment count and return new value', async () => {
      const count1 = await storage.incrementCount('test-key', 60);
      expect(count1).toBe(1);

      const count2 = await storage.incrementCount('test-key', 60);
      expect(count2).toBe(2);
    });

    it('should set window start on first increment', async () => {
      await storage.incrementCount('test-key', 60);
      const windowStart = await storage.getWindowStart('test-key');
      expect(windowStart).toBeGreaterThan(Date.now() - 1000);
    });
  });

  describe('getWindowStart and setWindowStart', () => {
    it('should store and retrieve window start time', async () => {
      const now = Date.now();
      await storage.setWindowStart('test-key', now, 60);
      
      const retrieved = await storage.getWindowStart('test-key');
      expect(retrieved).toBe(now);
    });

    it('should return null for non-existent window', async () => {
      const windowStart = await storage.getWindowStart('non-existent');
      expect(windowStart).toBeNull();
    });
  });

  describe('reset', () => {
    it('should clear count and window for key', async () => {
      await storage.incrementCount('test-key', 60);
      await storage.setWindowStart('test-key', Date.now(), 60);
      
      await storage.reset('test-key');
      
      const count = await storage.getCount('test-key');
      const windowStart = await storage.getWindowStart('test-key');
      
      expect(count).toBe(0);
      expect(windowStart).toBeNull();
    });
  });

  describe('automatic cleanup', () => {
    it('should automatically clean up expired entries', async () => {
      jest.useFakeTimers();
      
      await storage.incrementCount('test-key', 1); // 1 second window
      
      // Fast forward past expiration
      jest.advanceTimersByTime(2000);
      
      const count = await storage.getCount('test-key');
      expect(count).toBe(0);
      
      jest.useRealTimers();
    });
  });

  describe('isAvailable', () => {
    it('should always return true', () => {
      expect(storage.isAvailable()).toBe(true);
    });
  });
});

describe('SlidingWindowRateLimiter', () => {
  let rateLimiter: SlidingWindowRateLimiter;
  let mockStorage: jest.Mocked<RateLimitStorage>;

  beforeEach(() => {
    mockStorage = {
      getCount: jest.fn(),
      incrementCount: jest.fn(),
      getWindowStart: jest.fn(),
      setWindowStart: jest.fn(),
      reset: jest.fn(),
      isAvailable: jest.fn()
    } as jest.Mocked<RateLimitStorage>;

    mockStorage.getCount.mockResolvedValue(0);
    mockStorage.incrementCount.mockResolvedValue(1);
    mockStorage.getWindowStart.mockResolvedValue(null);
    mockStorage.setWindowStart.mockResolvedValue(undefined);
    mockStorage.reset.mockResolvedValue(undefined);
    mockStorage.isAvailable.mockReturnValue(true);

    rateLimiter = new SlidingWindowRateLimiter(mockStorage);
  });

  describe('checkLimit', () => {
    const config: RateLimitConfig = {
      identifier: 'test-user',
      maxRequests: 5,
      windowSizeSeconds: 60,
      keyPrefix: 'test'
    };

    it('should allow request when under limit', async () => {
      const now = Date.now();
      mockStorage.getWindowStart.mockResolvedValue(now);
      mockStorage.incrementCount.mockResolvedValue(3);

      const result = await rateLimiter.checkLimit(config);

      expect(result.isLimited).toBe(false);
      expect(result.currentRequests).toBe(3);
      expect(result.maxRequests).toBe(5);
    });

    it('should block request when over limit', async () => {
      const now = Date.now();
      mockStorage.getWindowStart.mockResolvedValue(now);
      mockStorage.incrementCount.mockResolvedValue(6);

      const result = await rateLimiter.checkLimit(config);

      expect(result.isLimited).toBe(true);
      expect(result.currentRequests).toBe(6);
      expect(result.maxRequests).toBe(5);
    });

    it('should initialize new window when no window exists', async () => {
      mockStorage.getWindowStart.mockResolvedValue(null);
      mockStorage.incrementCount.mockResolvedValue(1);

      const result = await rateLimiter.checkLimit(config);

      expect(mockStorage.setWindowStart).toHaveBeenCalled();
      expect(mockStorage.reset).toHaveBeenCalled();
      expect(result.isLimited).toBe(false);
    });

    it('should initialize new window when window expired', async () => {
      const expiredTime = Date.now() - 120000; // 2 minutes ago
      mockStorage.getWindowStart.mockResolvedValue(expiredTime);
      mockStorage.incrementCount.mockResolvedValue(1);

      const result = await rateLimiter.checkLimit(config);

      expect(mockStorage.setWindowStart).toHaveBeenCalled();
      expect(mockStorage.reset).toHaveBeenCalled();
      expect(result.isLimited).toBe(false);
    });
  });

  describe('checkLimitOnly', () => {
    const config: RateLimitConfig = {
      identifier: 'test-user',
      maxRequests: 5,
      windowSizeSeconds: 60,
      keyPrefix: 'test'
    };

    it('should check limit without incrementing', async () => {
      const now = Date.now();
      mockStorage.getWindowStart.mockResolvedValue(now);
      mockStorage.getCount.mockResolvedValue(4);

      const result = await rateLimiter.checkLimitOnly(config);

      expect(result.isLimited).toBe(false);
      expect(result.currentRequests).toBe(4);
      expect(mockStorage.incrementCount).not.toHaveBeenCalled();
    });

    it('should return not limited for expired window', async () => {
      const expiredTime = Date.now() - 120000;
      mockStorage.getWindowStart.mockResolvedValue(expiredTime);

      const result = await rateLimiter.checkLimitOnly(config);

      expect(result.isLimited).toBe(false);
      expect(result.currentRequests).toBe(0);
    });
  });

  describe('resetLimit', () => {
    it('should reset limit for given config', async () => {
      const config: RateLimitConfig = {
        identifier: 'test-user',
        maxRequests: 5,
        windowSizeSeconds: 60,
        keyPrefix: 'test'
      };

      await rateLimiter.resetLimit(config);

      expect(mockStorage.reset).toHaveBeenCalledWith('test:test-user:60');
    });
  });

  describe('getStorageStatus', () => {
    it('should return storage availability status', () => {
      const fallbackStorage = new MemoryRateLimitStorage();
      const rateLimiter = new SlidingWindowRateLimiter(mockStorage);

      const status = rateLimiter.getStorageStatus();

      expect(status.primary).toBe(true);
      expect(status.fallback).toBe(true);
    });
  });
});

describe('RateLimiterService', () => {
  let service: RateLimiterService;

  beforeEach(() => {
    // Reset singleton
    (RateLimiterService as any).instance = undefined;
    service = RateLimiterService.getInstance();
  });

  afterEach(async () => {
    await service.cleanup();
  });

  describe('singleton pattern', () => {
    it('should return same instance', () => {
      const service1 = RateLimiterService.getInstance();
      const service2 = RateLimiterService.getInstance();
      expect(service1).toBe(service2);
    });
  });

  describe('job configurations', () => {
    it('should have default job configurations', () => {
      const configs = service.getJobConfigs();
      
      expect(configs.has('build')).toBe(true);
      expect(configs.has('deploy')).toBe(true);
      expect(configs.has('test')).toBe(true);
      expect(configs.has('default')).toBe(true);
    });

    it('should allow updating job configuration', () => {
      const newConfig: JobTypeConfig = {
        jobType: 'custom',
        maxRequestsPerUser: 10,
        windowSizeSeconds: 300,
        cooldownSeconds: 120
      };

      service.setJobConfig(newConfig);
      const configs = service.getJobConfigs();
      
      expect(configs.get('custom')).toEqual(newConfig);
    });
  });

  describe('checkUserLimit', () => {
    it('should check user rate limit', async () => {
      const result = await service.checkUserLimit('user123', 5, 60);
      
      expect(result).toHaveProperty('isLimited');
      expect(result).toHaveProperty('currentRequests');
      expect(result).toHaveProperty('maxRequests');
      expect(result.maxRequests).toBe(5);
    });
  });

  describe('checkJobLimit', () => {
    it('should check job rate limit', async () => {
      const result = await service.checkJobLimit('test-job', 10, 300);
      
      expect(result).toHaveProperty('isLimited');
      expect(result).toHaveProperty('currentRequests');
      expect(result).toHaveProperty('maxRequests');
      expect(result.maxRequests).toBe(10);
    });
  });

  describe('checkUserJobLimit', () => {
    it('should check combined user+job rate limit', async () => {
      const result = await service.checkUserJobLimit('user123', 'build-job', 3, 300);
      
      expect(result).toHaveProperty('isLimited');
      expect(result).toHaveProperty('currentRequests');
      expect(result).toHaveProperty('maxRequests');
      expect(result.maxRequests).toBe(3);
    });
  });

  describe('checkGlobalLimit', () => {
    it('should check global rate limit', async () => {
      const result = await service.checkGlobalLimit(100, 60);
      
      expect(result).toHaveProperty('isLimited');
      expect(result).toHaveProperty('currentRequests');
      expect(result).toHaveProperty('maxRequests');
      expect(result.maxRequests).toBe(100);
    });
  });

  describe('checkJobTrigger', () => {
    it('should check job trigger with default job type', async () => {
      const result = await service.checkJobTrigger('user123', 'test-job');
      
      expect(result).toHaveProperty('rateLimit');
      expect(result).toHaveProperty('cooldown');
      expect(result).toHaveProperty('canProceed');
      expect(typeof result.canProceed).toBe('boolean');
    });

    it('should check job trigger with specific job type', async () => {
      const result = await service.checkJobTrigger('user123', 'build-job', 'build');
      
      expect(result).toHaveProperty('rateLimit');
      expect(result).toHaveProperty('cooldown');
      expect(result).toHaveProperty('canProceed');
    });

    it('should block when rate limit exceeded', async () => {
      // Trigger multiple requests to exceed limit
      const userId = 'heavy-user';
      const jobName = 'build-job';
      
      // First few should succeed
      for (let i = 0; i < 3; i++) {
        const result = await service.checkJobTrigger(userId, jobName, 'build');
        if (result.canProceed) {
          await service.recordJobTrigger(userId, jobName, 'build');
        }
      }
      
      // Eventually should be blocked (depends on build job config)
      let blocked = false;
      for (let i = 0; i < 10; i++) {
        const result = await service.checkJobTrigger(userId, jobName, 'build');
        if (!result.canProceed) {
          blocked = true;
          expect(result.blockReason).toBeTruthy();
          break;
        }
        if (result.canProceed) {
          await service.recordJobTrigger(userId, jobName, 'build');
        }
      }
      
      // Should eventually be blocked
      expect(blocked).toBe(true);
    });
  });

  describe('recordJobTrigger', () => {
    it('should record successful job trigger', async () => {
      await expect(service.recordJobTrigger('user123', 'test-job', 'test')).resolves.not.toThrow();
    });
  });

  describe('cooldown management', () => {
    it('should check cooldown status', async () => {
      const result = await service.checkCooldown('user123', 'test-job', 'test');
      
      expect(result).toHaveProperty('isInCooldown');
      expect(result).toHaveProperty('cooldownRemainingSeconds');
      expect(typeof result.isInCooldown).toBe('boolean');
      expect(typeof result.cooldownRemainingSeconds).toBe('number');
    });

    it('should set cooldown after job trigger', async () => {
      const userId = 'cooldown-user';
      const jobName = 'cooldown-job';
      
      // Set cooldown
      await service.setCooldown(userId, jobName, 'test');
      
      // Check cooldown status
      const result = await service.checkCooldown(userId, jobName, 'test');
      expect(result.isInCooldown).toBe(true);
      expect(result.cooldownRemainingSeconds).toBeGreaterThan(0);
    });

    it('should reset cooldown', async () => {
      const userId = 'reset-user';
      const jobName = 'reset-job';
      
      // Set cooldown
      await service.setCooldown(userId, jobName, 'test');
      
      // Reset cooldown
      await service.resetCooldown(userId, jobName);
      
      // Check cooldown status
      const result = await service.checkCooldown(userId, jobName, 'test');
      expect(result.isInCooldown).toBe(false);
    });
  });

  describe('getUserStatus', () => {
    it('should return user status across job types', async () => {
      const result = await service.getUserStatus('user123');
      
      expect(result).toHaveProperty('jobTypes');
      expect(result).toHaveProperty('globalLimits');
      expect(Array.isArray(result.jobTypes)).toBe(true);
      expect(Array.isArray(result.globalLimits)).toBe(true);
    });
  });

  describe('resetUserLimit', () => {
    it('should reset user limit', async () => {
      await expect(service.resetUserLimit('user123', 60)).resolves.not.toThrow();
    });
  });

  describe('getStatus', () => {
    it('should return storage status', () => {
      const status = service.getStatus();
      expect(status).toHaveProperty('primary');
      expect(status).toHaveProperty('fallback');
      expect(typeof status.primary).toBe('boolean');
      expect(typeof status.fallback).toBe('boolean');
    });
  });
});

describe('Rate Limiting Integration', () => {
  let service: RateLimiterService;

  beforeEach(() => {
    (RateLimiterService as any).instance = undefined;
    service = RateLimiterService.getInstance();
  });

  afterEach(async () => {
    await service.cleanup();
  });

  describe('rate limit enforcement', () => {
    it('should enforce rate limits across multiple users', async () => {
      const jobName = 'shared-job';
      const jobType = 'test';
      
      // Test multiple users hitting the same job
      const users = ['user1', 'user2', 'user3'];
      const results = [];
      
      for (const user of users) {
        for (let i = 0; i < 15; i++) { // Try to exceed test job limit (10)
          const result = await service.checkJobTrigger(user, jobName, jobType);
          results.push({ user, attempt: i, canProceed: result.canProceed });
          
          if (result.canProceed) {
            await service.recordJobTrigger(user, jobName, jobType);
          }
        }
      }
      
      // Should have some blocked requests
      const blockedRequests = results.filter(r => !r.canProceed);
      expect(blockedRequests.length).toBeGreaterThan(0);
    });

    it('should handle concurrent requests', async () => {
      const userId = 'concurrent-user';
      const jobName = 'concurrent-job';
      const jobType = 'test';
      
      // Fire multiple concurrent requests
      const promises = Array.from({ length: 20 }, () =>
        service.checkJobTrigger(userId, jobName, jobType)
      );
      
      const results = await Promise.all(promises);
      
      // Should have mix of allowed and blocked
      const allowedCount = results.filter(r => r.canProceed).length;
      const blockedCount = results.filter(r => !r.canProceed).length;
      
      expect(allowedCount + blockedCount).toBe(20);
      expect(allowedCount).toBeGreaterThan(0);
      expect(blockedCount).toBeGreaterThan(0);
    });
  });

  describe('cooldown enforcement', () => {
    it('should enforce cooldown periods', async () => {
      jest.useFakeTimers();
      
      const userId = 'cooldown-test-user';
      const jobName = 'cooldown-test-job';
      const jobType = 'deploy'; // Has 5-minute cooldown
      
      // First trigger should succeed
      let result = await service.checkJobTrigger(userId, jobName, jobType);
      expect(result.canProceed).toBe(true);
      
      await service.recordJobTrigger(userId, jobName, jobType);
      
      // Immediate retry should be blocked by cooldown
      result = await service.checkJobTrigger(userId, jobName, jobType);
      expect(result.canProceed).toBe(false);
      expect(result.cooldown.isInCooldown).toBe(true);
      
      // After cooldown expires, should succeed again
      jest.advanceTimersByTime(300 * 1000 + 1000); // 5 minutes + 1 second
      
      result = await service.checkJobTrigger(userId, jobName, jobType);
      expect(result.canProceed).toBe(true);
      
      jest.useRealTimers();
    });
  });

  describe('error handling', () => {
    it('should handle storage errors gracefully', async () => {
      // This test would need a mock that throws errors
      // For now, just ensure the service doesn't throw
      await expect(service.checkUserLimit('error-user', 5, 60)).resolves.toBeDefined();
    });
  });
});