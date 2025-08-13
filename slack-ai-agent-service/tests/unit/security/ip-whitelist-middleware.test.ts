/**
 * IP Whitelist Middleware Unit Tests
 * Comprehensive test suite for IP whitelisting middleware functionality
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { Request, Response } from 'express';
import { IPWhitelistMiddleware, IPWhitelistOptions } from '../../../src/middleware/ip-whitelist';

// Mock the logger
jest.mock('../../../src/utils/logger', () => ({
  logger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

describe('IPWhitelistMiddleware', () => {
  let middleware: IPWhitelistMiddleware;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: jest.Mock;

  const defaultConfig: IPWhitelistOptions = {
    enabled: true,
    allowedIPs: ['192.168.1.100', '10.0.0.50'],
    allowedRanges: ['192.168.1.0/24', '10.0.0.0/16'],
    defaultAction: 'block',
    rejectionMessage: 'Access denied: IP not authorized',
    trustProxy: true,
    proxyHeaders: ['x-forwarded-for', 'x-real-ip'],
    allowLocalhost: false,
    allowPrivateNetworks: false,
  };

  beforeEach(() => {
    // Reset mocks
    mockNext = jest.fn();
    
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
    };

    mockReq = {
      get: jest.fn(),
      socket: {
        remoteAddress: '192.168.1.50',
      },
      path: '/api/test',
      method: 'GET',
      originalUrl: '/api/test',
    };

    middleware = new IPWhitelistMiddleware(defaultConfig);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Middleware Initialization', () => {
    it('should initialize with default configuration', () => {
      const middleware = new IPWhitelistMiddleware(defaultConfig);
      const stats = middleware.getStatistics();
      
      expect(stats.totalRequests).toBe(0);
      expect(stats.allowedRequests).toBe(0);
      expect(stats.blockedRequests).toBe(0);
    });

    it('should load allowed IPs and ranges', () => {
      const middleware = new IPWhitelistMiddleware(defaultConfig);
      const stats = middleware.getStatistics();
      
      expect(stats.allowedConfiguration.ips).toContain('192.168.1.100');
      expect(stats.allowedConfiguration.ips).toContain('10.0.0.50');
      expect(stats.allowedConfiguration.ranges).toContain('192.168.1.0/24');
      expect(stats.allowedConfiguration.ranges).toContain('10.0.0.0/16');
    });
  });

  describe('IP Extraction', () => {
    it('should extract IP from socket when no proxy headers', () => {
      const config = { ...defaultConfig, trustProxy: false };
      const middleware = new IPWhitelistMiddleware(config);
      
      const middlewareFunc = middleware.middleware();
      middlewareFunc(mockReq as Request, mockRes as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
    });

    it('should extract IP from x-forwarded-for header when proxy trusted', () => {
      (mockReq.get as jest.Mock).mockImplementation((header: string) => {
        if (header === 'x-forwarded-for') return '203.0.113.50, 192.168.1.1';
        return undefined;
      });

      const middlewareFunc = middleware.middleware();
      middlewareFunc(mockReq as Request, mockRes as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
    });

    it('should extract IP from x-real-ip header', () => {
      (mockReq.get as jest.Mock).mockImplementation((header: string) => {
        if (header === 'x-real-ip') return '203.0.113.100';
        return undefined;
      });

      const middlewareFunc = middleware.middleware();
      middlewareFunc(mockReq as Request, mockRes as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
    });

    it('should handle IPv6-wrapped IPv4 addresses', () => {
      mockReq.socket = { remoteAddress: '::ffff:192.168.1.50' };

      const middlewareFunc = middleware.middleware();
      middlewareFunc(mockReq as Request, mockRes as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('IP Whitelisting Logic', () => {
    it('should allow whitelisted IP addresses', () => {
      // Set IP to one in the allowed list
      mockReq.socket = { remoteAddress: '192.168.1.100' };

      const middlewareFunc = middleware.middleware();
      middlewareFunc(mockReq as Request, mockRes as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalledWith(403);
    });

    it('should allow IPs in whitelisted CIDR ranges', () => {
      // Set IP to one in the CIDR range
      mockReq.socket = { remoteAddress: '192.168.1.75' };

      const middlewareFunc = middleware.middleware();
      middlewareFunc(mockReq as Request, mockRes as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalledWith(403);
    });

    it('should block non-whitelisted IPs with block action', () => {
      // Set IP to one NOT in the allowed list/ranges
      mockReq.socket = { remoteAddress: '203.0.113.50' };

      const middlewareFunc = middleware.middleware();
      middlewareFunc(mockReq as Request, mockRes as Response, mockNext);
      
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Access Denied',
          message: 'Access denied: IP not authorized',
          code: 'IP_NOT_WHITELISTED',
        })
      );
    });

    it('should log but allow non-whitelisted IPs with log action', () => {
      const config = { ...defaultConfig, defaultAction: 'log' as const };
      const middleware = new IPWhitelistMiddleware(config);
      
      mockReq.socket = { remoteAddress: '203.0.113.50' };

      const middlewareFunc = middleware.middleware();
      middlewareFunc(mockReq as Request, mockRes as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should warn but allow non-whitelisted IPs with warn action', () => {
      const config = { ...defaultConfig, defaultAction: 'warn' as const };
      const middleware = new IPWhitelistMiddleware(config);
      
      mockReq.socket = { remoteAddress: '203.0.113.50' };

      const middlewareFunc = middleware.middleware();
      middlewareFunc(mockReq as Request, mockRes as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });
  });

  describe('Skip Conditions', () => {
    it('should skip when middleware is disabled', () => {
      const config = { ...defaultConfig, enabled: false };
      const middleware = new IPWhitelistMiddleware(config);
      
      mockReq.socket = { remoteAddress: '203.0.113.50' };

      const middlewareFunc = middleware.middleware();
      middlewareFunc(mockReq as Request, mockRes as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
    });

    it('should skip for configured skip paths', () => {
      const config = { ...defaultConfig, skipPaths: ['/health', '/metrics'] };
      const middleware = new IPWhitelistMiddleware(config);
      
      mockReq.path = '/health';
      mockReq.socket = { remoteAddress: '203.0.113.50' };

      const middlewareFunc = middleware.middleware();
      middlewareFunc(mockReq as Request, mockRes as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
    });

    it('should skip for configured skip user agents', () => {
      const config = { ...defaultConfig, skipUserAgents: ['HealthChecker'] };
      const middleware = new IPWhitelistMiddleware(config);
      
      (mockReq.get as jest.Mock).mockImplementation((header: string) => {
        if (header === 'user-agent') return 'HealthChecker/1.0';
        return undefined;
      });
      
      mockReq.socket = { remoteAddress: '203.0.113.50' };

      const middlewareFunc = middleware.middleware();
      middlewareFunc(mockReq as Request, mockRes as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
    });

    it('should allow localhost when allowLocalhost is enabled', () => {
      const config = { ...defaultConfig, allowLocalhost: true };
      const middleware = new IPWhitelistMiddleware(config);
      
      mockReq.socket = { remoteAddress: '127.0.0.1' };

      const middlewareFunc = middleware.middleware();
      middlewareFunc(mockReq as Request, mockRes as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('Custom Handlers', () => {
    it('should use custom IP resolver when provided', () => {
      const customResolver = jest.fn().mockReturnValue('203.0.113.100');
      const config = { ...defaultConfig, customIPResolver: customResolver };
      const middleware = new IPWhitelistMiddleware(config);
      
      const middlewareFunc = middleware.middleware();
      middlewareFunc(mockReq as Request, mockRes as Response, mockNext);
      
      expect(customResolver).toHaveBeenCalledWith(mockReq);
    });

    it('should use custom action handler when provided', () => {
      const customHandler = jest.fn();
      const config = { ...defaultConfig, customActionHandler: customHandler };
      const middleware = new IPWhitelistMiddleware(config);
      
      mockReq.socket = { remoteAddress: '203.0.113.50' };

      const middlewareFunc = middleware.middleware();
      middlewareFunc(mockReq as Request, mockRes as Response, mockNext);
      
      expect(customHandler).toHaveBeenCalled();
    });
  });

  describe('Runtime Configuration Updates', () => {
    it('should update configuration at runtime', () => {
      const newConfig = {
        allowedIPs: ['203.0.113.100'],
        defaultAction: 'log' as const,
      };

      middleware.updateConfiguration(newConfig);

      const stats = middleware.getStatistics();
      expect(stats.allowedConfiguration.ips).toContain('203.0.113.100');
    });

    it('should add allowed IP at runtime', () => {
      const success = middleware.addAllowedIP('203.0.113.200');
      expect(success).toBe(true);

      const stats = middleware.getStatistics();
      expect(stats.allowedConfiguration.ips).toContain('203.0.113.200');
    });

    it('should add allowed range at runtime', () => {
      const success = middleware.addAllowedRange('203.0.113.0/24');
      expect(success).toBe(true);

      const stats = middleware.getStatistics();
      expect(stats.allowedConfiguration.ranges).toContain('203.0.113.0/24');
    });

    it('should remove allowed IP at runtime', () => {
      const success = middleware.removeAllowedIP('192.168.1.100');
      expect(success).toBe(true);

      const stats = middleware.getStatistics();
      expect(stats.allowedConfiguration.ips).not.toContain('192.168.1.100');
    });

    it('should reject invalid IP additions', () => {
      const success = middleware.addAllowedIP('256.1.1.1');
      expect(success).toBe(false);
    });
  });

  describe('Statistics and Health', () => {
    it('should track request statistics', () => {
      // Make a request that should be allowed
      mockReq.socket = { remoteAddress: '192.168.1.100' };

      const middlewareFunc = middleware.middleware();
      middlewareFunc(mockReq as Request, mockRes as Response, mockNext);

      const stats = middleware.getStatistics();
      expect(stats.totalRequests).toBe(1);
      expect(stats.allowedRequests).toBe(1);
      expect(stats.blockedRequests).toBe(0);
    });

    it('should track blocked request statistics', () => {
      // Make a request that should be blocked
      mockReq.socket = { remoteAddress: '203.0.113.50' };

      const middlewareFunc = middleware.middleware();
      middlewareFunc(mockReq as Request, mockRes as Response, mockNext);

      const stats = middleware.getStatistics();
      expect(stats.totalRequests).toBe(1);
      expect(stats.allowedRequests).toBe(0);
      expect(stats.blockedRequests).toBe(1);
    });

    it('should provide health status', () => {
      const health = middleware.getHealthStatus();
      
      expect(health.healthy).toBe(true);
      expect(health.enabled).toBe(true);
      expect(health.rulesCount).toBeGreaterThan(0);
      expect(health.recentActivity).toBeDefined();
    });

    it('should reset statistics', () => {
      // Generate some stats
      mockReq.socket = { remoteAddress: '192.168.1.100' };
      const middlewareFunc = middleware.middleware();
      middlewareFunc(mockReq as Request, mockRes as Response, mockNext);

      // Reset stats
      middleware.resetStatistics();

      const stats = middleware.getStatistics();
      expect(stats.totalRequests).toBe(0);
      expect(stats.allowedRequests).toBe(0);
      expect(stats.blockedRequests).toBe(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle missing IP gracefully', () => {
      mockReq.socket = {};

      const middlewareFunc = middleware.middleware();
      middlewareFunc(mockReq as Request, mockRes as Response, mockNext);
      
      // Should block when IP cannot be determined
      expect(mockRes.status).toHaveBeenCalledWith(403);
    });

    it('should handle middleware errors gracefully', () => {
      // Mock an error in IP extraction
      mockReq.socket = null as any;

      const middlewareFunc = middleware.middleware();
      
      // Should not throw, should handle gracefully
      expect(() => {
        middlewareFunc(mockReq as Request, mockRes as Response, mockNext);
      }).not.toThrow();
    });

    it('should handle invalid proxy headers gracefully', () => {
      (mockReq.get as jest.Mock).mockImplementation((header: string) => {
        if (header === 'x-forwarded-for') return 'invalid-ip-address';
        return undefined;
      });

      const middlewareFunc = middleware.middleware();
      middlewareFunc(mockReq as Request, mockRes as Response, mockNext);
      
      // Should fall back to socket IP
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle complex proxy chain', () => {
      (mockReq.get as jest.Mock).mockImplementation((header: string) => {
        if (header === 'x-forwarded-for') return '203.0.113.50, 192.168.1.1, 10.0.0.1';
        return undefined;
      });

      const middlewareFunc = middleware.middleware();
      middlewareFunc(mockReq as Request, mockRes as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
    });

    it('should prioritize proxy headers over socket IP', () => {
      mockReq.socket = { remoteAddress: '192.168.1.100' }; // Would be allowed
      (mockReq.get as jest.Mock).mockImplementation((header: string) => {
        if (header === 'x-forwarded-for') return '203.0.113.50'; // Would be blocked
        return undefined;
      });

      const middlewareFunc = middleware.middleware();
      middlewareFunc(mockReq as Request, mockRes as Response, mockNext);
      
      // Should use proxy header (203.0.113.50) and block
      expect(mockRes.status).toHaveBeenCalledWith(403);
    });

    it('should work with multiple proxy headers', () => {
      const config = { ...defaultConfig, proxyHeaders: ['x-forwarded-for', 'x-real-ip', 'x-client-ip'] };
      const middleware = new IPWhitelistMiddleware(config);

      (mockReq.get as jest.Mock).mockImplementation((header: string) => {
        if (header === 'x-client-ip') return '192.168.1.100';
        return undefined;
      });

      const middlewareFunc = middleware.middleware();
      middlewareFunc(mockReq as Request, mockRes as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
    });
  });
});