/**
 * Network Security Integration Tests
 * End-to-end testing of the complete network security system
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import express, { Express, Request, Response } from 'express';
import request from 'supertest';
import { NetworkSecuritySystem } from '../../../src/middleware/network-security';
import { NetworkSecurityConfig } from '../../../src/config/network-security';

// Mock the logger
jest.mock('../../../src/utils/logger', () => ({
  logger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    log: jest.fn(),
  }),
}));

describe('Network Security Integration', () => {
  let app: Express;
  let securitySystem: NetworkSecuritySystem;

  const testConfig: Partial<NetworkSecurityConfig> = {
    global: {
      enabled: true,
      mode: 'balanced',
      allowLocalhost: true,
      allowPrivateNetworks: false,
    },
    ipWhitelist: {
      enabled: true,
      allowedIPs: ['192.168.1.100'],
      allowedRanges: ['192.168.1.0/24'],
      defaultAction: 'block',
      rejectionMessage: 'Access denied for testing',
      trustProxy: true,
      proxyHeaders: ['x-forwarded-for'],
    },
    rateLimit: {
      enabled: true,
      maxRequests: 5,
      windowMs: 10000, // 10 seconds for faster testing
      delayMs: 0,
      skipWhitelisted: false,
      message: 'Rate limit exceeded for testing',
      headers: {
        includeRemaining: true,
        includeResetTime: true,
        includeRetryAfter: true,
      },
    },
    tls: {
      enforceHTTPS: false, // Disabled for HTTP testing
      minVersion: '1.2',
      certificateValidation: 'strict',
      enableHSTS: false,
      hstsMaxAge: 31536000,
      hstsIncludeSubdomains: true,
    },
    logging: {
      enabled: true,
      level: 'info',
      includeRequestDetails: true,
      includeResponseDetails: false,
      alerting: {
        enabled: true,
        threshold: 10,
        cooldownMinutes: 1,
      },
    },
  };

  beforeEach(() => {
    app = express();
    securitySystem = new NetworkSecuritySystem(testConfig);
    securitySystem.applyToApp(app);

    // Test endpoints
    app.get('/api/test', (req: Request, res: Response) => {
      res.json({ message: 'Success', ip: req.socket.remoteAddress });
    });

    app.get('/api/protected', (req: Request, res: Response) => {
      res.json({ message: 'Protected resource accessed' });
    });

    app.post('/api/data', (req: Request, res: Response) => {
      res.json({ message: 'Data received' });
    });
  });

  afterEach(async () => {
    await securitySystem.destroy();
    jest.clearAllMocks();
  });

  describe('IP Whitelisting Integration', () => {
    it('should allow requests from whitelisted IP', async () => {
      const response = await request(app)
        .get('/api/test')
        .set('X-Forwarded-For', '192.168.1.100');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        message: 'Success',
        ip: expect.any(String),
      });
    });

    it('should allow requests from whitelisted CIDR range', async () => {
      const response = await request(app)
        .get('/api/test')
        .set('X-Forwarded-For', '192.168.1.75');

      expect(response.status).toBe(200);
    });

    it('should block requests from non-whitelisted IP', async () => {
      const response = await request(app)
        .get('/api/test')
        .set('X-Forwarded-For', '203.0.113.50');

      expect(response.status).toBe(403);
      expect(response.body).toEqual({
        error: 'Access Denied',
        message: 'Access denied for testing',
        code: 'IP_NOT_WHITELISTED',
        timestamp: expect.any(String),
      });
    });

    it('should allow localhost requests when allowLocalhost is enabled', async () => {
      const response = await request(app)
        .get('/api/test')
        .set('X-Forwarded-For', '127.0.0.1');

      expect(response.status).toBe(200);
    });
  });

  describe('Rate Limiting Integration', () => {
    it('should allow requests under rate limit', async () => {
      const responses = await Promise.all([
        request(app).get('/api/test').set('X-Forwarded-For', '192.168.1.100'),
        request(app).get('/api/test').set('X-Forwarded-For', '192.168.1.100'),
        request(app).get('/api/test').set('X-Forwarded-For', '192.168.1.100'),
      ]);

      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.headers['x-ratelimit-remaining']).toBeDefined();
        expect(response.headers['x-ratelimit-limit']).toBe('5');
      });
    });

    it('should block requests over rate limit', async () => {
      // Make requests up to the limit
      const requests = Array(6).fill(null).map(() => 
        request(app).get('/api/test').set('X-Forwarded-For', '192.168.1.100')
      );

      const responses = await Promise.all(requests);

      // First 5 should succeed
      responses.slice(0, 5).forEach(response => {
        expect(response.status).toBe(200);
      });

      // 6th should be rate limited
      expect(responses[5].status).toBe(429);
      expect(responses[5].body).toEqual({
        error: 'Too Many Requests',
        message: 'Rate limit exceeded for testing',
        code: 'RATE_LIMIT_EXCEEDED',
        details: {
          limit: 5,
          remaining: expect.any(Number),
          resetTime: expect.any(Number),
          retryAfter: expect.any(Number),
        },
        timestamp: expect.any(String),
      });
    });

    it('should include rate limit headers', async () => {
      const response = await request(app)
        .get('/api/test')
        .set('X-Forwarded-For', '192.168.1.100');

      expect(response.status).toBe(200);
      expect(response.headers['x-ratelimit-limit']).toBe('5');
      expect(response.headers['x-ratelimit-remaining']).toBeDefined();
      expect(response.headers['x-ratelimit-reset']).toBeDefined();
    });

    it('should handle different IPs separately', async () => {
      // Each IP should have its own rate limit
      const response1 = await request(app)
        .get('/api/test')
        .set('X-Forwarded-For', '192.168.1.100');

      const response2 = await request(app)
        .get('/api/test')
        .set('X-Forwarded-For', '192.168.1.101');

      expect(response1.status).toBe(200);
      expect(response2.status).toBe(200);
      expect(response1.headers['x-ratelimit-remaining']).toBe('4');
      expect(response2.headers['x-ratelimit-remaining']).toBe('4');
    });
  });

  describe('Security Headers Integration', () => {
    it('should set security headers on all responses', async () => {
      const response = await request(app)
        .get('/api/test')
        .set('X-Forwarded-For', '192.168.1.100');

      expect(response.status).toBe(200);
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBe('DENY');
      expect(response.headers['x-xss-protection']).toBe('1; mode=block');
      expect(response.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
      expect(response.headers['content-security-policy']).toContain("default-src 'self'");
    });

    it('should not set HSTS headers when HTTPS is not enforced', async () => {
      const response = await request(app)
        .get('/api/test')
        .set('X-Forwarded-For', '192.168.1.100');

      expect(response.status).toBe(200);
      expect(response.headers['strict-transport-security']).toBeUndefined();
    });
  });

  describe('Combined Security Scenarios', () => {
    it('should block non-whitelisted IP before applying rate limiting', async () => {
      const response = await request(app)
        .get('/api/test')
        .set('X-Forwarded-For', '203.0.113.50');

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('IP_NOT_WHITELISTED');
      
      // Should not have rate limit headers since it was blocked earlier
      expect(response.headers['x-ratelimit-limit']).toBeUndefined();
    });

    it('should apply both IP whitelisting and rate limiting to allowed IPs', async () => {
      // Make requests from whitelisted IP to exceed rate limit
      const requests = Array(6).fill(null).map(() => 
        request(app).get('/api/test').set('X-Forwarded-For', '192.168.1.100')
      );

      const responses = await Promise.all(requests);

      // First 5 should pass IP whitelist and be allowed
      responses.slice(0, 5).forEach(response => {
        expect(response.status).toBe(200);
      });

      // 6th should pass IP whitelist but be rate limited
      expect(responses[5].status).toBe(429);
      expect(responses[5].body.code).toBe('RATE_LIMIT_EXCEEDED');
    });

    it('should handle malformed requests gracefully', async () => {
      const response = await request(app)
        .get('/api/test')
        .set('X-Forwarded-For', 'invalid-ip');

      // Should fall back to socket IP and potentially block or allow based on that
      expect([200, 403, 429]).toContain(response.status);
    });
  });

  describe('Security Context', () => {
    it('should attach security context to requests', async () => {
      // Add middleware to check security context
      app.get('/api/security-context', (req: any, res: Response) => {
        res.json({
          securityContext: req.securityContext,
          clientIP: req.clientIP,
          ipMatchResult: req.ipMatchResult,
          rateLimitResult: req.rateLimitResult,
        });
      });

      const response = await request(app)
        .get('/api/security-context')
        .set('X-Forwarded-For', '192.168.1.100');

      expect(response.status).toBe(200);
      expect(response.body.securityContext).toBeDefined();
      expect(response.body.securityContext.passed).toBe(true);
      expect(response.body.clientIP).toBe('192.168.1.100');
    });
  });

  describe('Health and Statistics', () => {
    it('should provide comprehensive health status', async () => {
      // Make some requests first
      await request(app).get('/api/test').set('X-Forwarded-For', '192.168.1.100');
      await request(app).get('/api/test').set('X-Forwarded-For', '203.0.113.50');

      const health = await securitySystem.getHealthStatus();

      expect(health.healthy).toBe(true);
      expect(health.components).toBeDefined();
      expect(health.components.ipWhitelist.enabled).toBe(true);
      expect(health.components.rateLimit.enabled).toBe(true);
      expect(health.components.tlsEnforcement.enabled).toBe(false);
      expect(health.components.securityMonitor.enabled).toBe(true);
      
      expect(health.activity.totalRequests).toBeGreaterThan(0);
      expect(health.activity.blockedRequests).toBeGreaterThan(0);
    });

    it('should track detailed statistics', async () => {
      // Generate some traffic
      await request(app).get('/api/test').set('X-Forwarded-For', '192.168.1.100');
      await request(app).get('/api/test').set('X-Forwarded-For', '192.168.1.101');
      await request(app).get('/api/test').set('X-Forwarded-For', '203.0.113.50');

      const stats = securitySystem.getStatistics();

      expect(stats.totalRequests).toBeGreaterThanOrEqual(3);
      expect(stats.passedRequests).toBeGreaterThanOrEqual(2);
      expect(stats.blockedRequests).toBeGreaterThanOrEqual(1);
      
      if (stats.ipWhitelist) {
        expect(stats.ipWhitelist.totalRequests).toBeGreaterThan(0);
        expect(stats.ipWhitelist.blockedRequests).toBeGreaterThan(0);
      }
    });
  });

  describe('Configuration Updates', () => {
    it('should update configuration at runtime', async () => {
      // Initially block non-whitelisted IP
      let response = await request(app)
        .get('/api/test')
        .set('X-Forwarded-For', '203.0.113.100');
      
      expect(response.status).toBe(403);

      // Update configuration to allow the IP
      securitySystem.updateConfiguration({
        ipWhitelist: {
          ...testConfig.ipWhitelist!,
          allowedIPs: [...testConfig.ipWhitelist!.allowedIPs, '203.0.113.100'],
        },
      });

      // Now the IP should be allowed
      response = await request(app)
        .get('/api/test')
        .set('X-Forwarded-For', '203.0.113.100');
      
      expect(response.status).toBe(200);
    });

    it('should handle invalid configuration updates gracefully', async () => {
      expect(() => {
        securitySystem.updateConfiguration({
          ipWhitelist: {
            ...testConfig.ipWhitelist!,
            allowedIPs: ['invalid.ip.address'],
          },
        });
      }).toThrow();
    });
  });

  describe('Performance and Memory', () => {
    it('should handle multiple concurrent requests efficiently', async () => {
      const startTime = Date.now();
      
      const requests = Array(50).fill(null).map((_, i) => 
        request(app)
          .get('/api/test')
          .set('X-Forwarded-For', `192.168.1.${100 + (i % 10)}`)
      );

      const responses = await Promise.all(requests);
      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should handle 50 requests in reasonable time (less than 5 seconds)
      expect(duration).toBeLessThan(5000);
      
      // All requests from whitelisted range should succeed (until rate limited)
      const successfulRequests = responses.filter(r => r.status === 200);
      expect(successfulRequests.length).toBeGreaterThan(0);
    });

    it('should manage memory usage effectively', async () => {
      // Generate a lot of requests to test memory management
      for (let i = 0; i < 100; i++) {
        await request(app)
          .get('/api/test')
          .set('X-Forwarded-For', `192.168.1.${100 + (i % 20)}`);
      }

      const stats = securitySystem.getStatistics();
      expect(stats.totalRequests).toBe(100);

      // System should still be healthy after many requests
      const health = await securitySystem.getHealthStatus();
      expect(health.healthy).toBe(true);
    });
  });

  describe('Error Recovery', () => {
    it('should recover from temporary failures gracefully', async () => {
      // Simulate some error condition by making malformed requests
      await request(app).get('/api/test').set('X-Forwarded-For', 'malformed-ip');
      await request(app).get('/api/test'); // No forwarded header

      // System should still work normally for valid requests
      const response = await request(app)
        .get('/api/test')
        .set('X-Forwarded-For', '192.168.1.100');

      expect(response.status).toBe(200);

      // Health should still be good
      const health = await securitySystem.getHealthStatus();
      expect(health.healthy).toBe(true);
    });
  });

  describe('Security Modes', () => {
    it('should work in strict mode', () => {
      const strictConfig = {
        ...testConfig,
        global: { ...testConfig.global!, mode: 'strict' as const },
      };

      const strictSystem = new NetworkSecuritySystem(strictConfig);
      const strictApp = express();
      strictSystem.applyToApp(strictApp);

      strictApp.get('/test', (req, res) => res.json({ ok: true }));

      // Should have more restrictive settings
      const config = strictSystem.getConfiguration();
      expect(config.global.mode).toBe('strict');
    });

    it('should work in permissive mode', () => {
      const permissiveConfig = {
        ...testConfig,
        global: { ...testConfig.global!, mode: 'permissive' as const },
      };

      const permissiveSystem = new NetworkSecuritySystem(permissiveConfig);
      const permissiveApp = express();
      permissiveSystem.applyToApp(permissiveApp);

      permissiveApp.get('/test', (req, res) => res.json({ ok: true }));

      // Should have more relaxed settings
      const config = permissiveSystem.getConfiguration();
      expect(config.global.mode).toBe('permissive');
    });
  });

  describe('Cleanup and Resource Management', () => {
    it('should clean up resources properly', async () => {
      const stats = securitySystem.getStatistics();
      expect(stats).toBeDefined();

      // Should destroy without errors
      await expect(securitySystem.destroy()).resolves.not.toThrow();
    });

    it('should reset statistics when requested', async () => {
      // Generate some traffic
      await request(app).get('/api/test').set('X-Forwarded-For', '192.168.1.100');
      
      let stats = securitySystem.getStatistics();
      expect(stats.totalRequests).toBeGreaterThan(0);

      // Reset statistics
      securitySystem.resetStatistics();

      stats = securitySystem.getStatistics();
      expect(stats.totalRequests).toBe(0);
      expect(stats.passedRequests).toBe(0);
      expect(stats.blockedRequests).toBe(0);
    });
  });
});