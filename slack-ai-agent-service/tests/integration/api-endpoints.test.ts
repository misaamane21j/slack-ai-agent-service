import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import crypto from 'crypto';
import { App } from '@slack/bolt';
import { resetToValidEnvironment } from '../__mocks__/environment';
import { mockSlackEvent, mockSlackWebClient } from '../__mocks__/slack';
import { TestEnvironment } from '../utils/test-helpers';

// Mock dependencies
jest.mock('../../src/config/environment');
jest.mock('../../src/utils/logger');
jest.mock('@slack/bolt');

describe('API Endpoints Integration Tests', () => {
  let app: express.Application;
  let slackApp: any;
  let testEnv: TestEnvironment;

  beforeEach(() => {
    testEnv = new TestEnvironment();
    resetToValidEnvironment();

    // Create Express app
    app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // Mock Slack App
    slackApp = {
      receiver: {
        router: express.Router()
      },
      client: mockSlackWebClient,
      event: jest.fn(),
      error: jest.fn(),
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined)
    };

    // Clear all mocks
    jest.clearAllMocks();
  });

  afterEach(() => {
    testEnv.restoreEnvironment();
  });

  describe('Health Check Endpoints', () => {
    beforeEach(() => {
      // Add health check routes
      app.get('/health', (req, res) => {
        res.status(200).json({ 
          status: 'healthy', 
          timestamp: Date.now(),
          uptime: process.uptime()
        });
      });

      app.get('/ready', (req, res) => {
        // Check if services are ready
        const ready = true; // Mock readiness check
        if (ready) {
          res.status(200).json({ 
            status: 'ready',
            services: {
              slack: 'connected',
              ai: 'connected',
              mcp: 'connected'
            }
          });
        } else {
          res.status(503).json({ status: 'not ready' });
        }
      });
    });

    it('should return healthy status on health check', async () => {
      // Act
      const response = await request(app).get('/health');

      // Assert
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        status: 'healthy',
        timestamp: expect.any(Number),
        uptime: expect.any(Number)
      });
    });

    it('should return ready status when services are available', async () => {
      // Act
      const response = await request(app).get('/ready');

      // Assert
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        status: 'ready',
        services: {
          slack: 'connected',
          ai: 'connected',
          mcp: 'connected'
        }
      });
    });
  });

  describe('Slack Webhook Endpoints', () => {
    let slackSigningSecret: string;

    beforeEach(() => {
      slackSigningSecret = 'test_signing_secret_32_characters_long';
      
      // Add Slack webhook endpoint
      app.use('/slack/events', (req, res, next) => {
        // Mock Slack signature verification
        const signature = req.headers['x-slack-signature'] as string;
        const timestamp = req.headers['x-slack-request-timestamp'] as string;
        
        if (!signature || !timestamp) {
          return res.status(401).json({ error: 'Missing signature or timestamp' });
        }

        // Simplified signature verification for testing
        const expectedSignature = `v0=${crypto
          .createHmac('sha256', slackSigningSecret)
          .update(`v0:${timestamp}:${JSON.stringify(req.body)}`)
          .digest('hex')}`;

        if (signature !== expectedSignature) {
          return res.status(401).json({ error: 'Invalid signature' });
        }

        next();
      });

      app.post('/slack/events', (req, res) => {
        const { type, challenge, event } = req.body;

        // Handle URL verification challenge
        if (type === 'url_verification') {
          return res.status(200).json({ challenge });
        }

        // Handle event callbacks
        if (type === 'event_callback') {
          // Mock event processing
          res.status(200).json({ ok: true });
          
          // Simulate processing the event asynchronously
          process.nextTick(() => {
            // This would normally trigger the Slack app's event handlers
            console.log('Processing event:', event.type);
          });
          
          return;
        }

        res.status(400).json({ error: 'Unknown event type' });
      });
    });

    it('should handle URL verification challenge', async () => {
      // Arrange
      const challenge = 'test_challenge_12345';
      const payload = {
        type: 'url_verification',
        challenge: challenge,
        token: 'verification_token'
      };

      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signature = `v0=${crypto
        .createHmac('sha256', slackSigningSecret)
        .update(`v0:${timestamp}:${JSON.stringify(payload)}`)
        .digest('hex')}`;

      // Act
      const response = await request(app)
        .post('/slack/events')
        .set('x-slack-signature', `v0=${signature}`)
        .set('x-slack-request-timestamp', timestamp)
        .send(payload);

      // Assert
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ challenge });
    });

    it('should process app mention events', async () => {
      // Arrange
      const payload = {
        type: 'event_callback',
        event: {
          ...mockSlackEvent.event,
          type: 'app_mention',
          text: 'Hello <@U123> please help'
        },
        team_id: 'T123456789'
      };

      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signature = `v0=${crypto
        .createHmac('sha256', slackSigningSecret)
        .update(`v0:${timestamp}:${JSON.stringify(payload)}`)
        .digest('hex')}`;

      // Act
      const response = await request(app)
        .post('/slack/events')
        .set('x-slack-signature', `v0=${signature}`)
        .set('x-slack-request-timestamp', timestamp)
        .send(payload);

      // Assert
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: true });
    });

    it('should reject requests with invalid signatures', async () => {
      // Arrange
      const payload = {
        type: 'event_callback',
        event: mockSlackEvent.event
      };

      const timestamp = Math.floor(Date.now() / 1000).toString();
      const invalidSignature = 'v0=invalid_signature';

      // Act
      const response = await request(app)
        .post('/slack/events')
        .set('x-slack-signature', invalidSignature)
        .set('x-slack-request-timestamp', timestamp)
        .send(payload);

      // Assert
      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Invalid signature' });
    });

    it('should reject requests without signatures', async () => {
      // Arrange
      const payload = {
        type: 'event_callback',
        event: mockSlackEvent.event
      };

      // Act
      const response = await request(app)
        .post('/slack/events')
        .send(payload);

      // Assert
      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Missing signature or timestamp' });
    });

    it('should handle unknown event types', async () => {
      // Arrange
      const payload = {
        type: 'unknown_event_type',
        data: { some: 'data' }
      };

      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signature = `v0=${crypto
        .createHmac('sha256', slackSigningSecret)
        .update(`v0:${timestamp}:${JSON.stringify(payload)}`)
        .digest('hex')}`;

      // Act
      const response = await request(app)
        .post('/slack/events')
        .set('x-slack-signature', `v0=${signature}`)
        .set('x-slack-request-timestamp', timestamp)
        .send(payload);

      // Assert
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Unknown event type' });
    });
  });

  describe('Rate Limiting Integration', () => {
    let requestCounts: Map<string, number>;

    beforeEach(() => {
      requestCounts = new Map();

      // Add rate limiting middleware
      app.use('/api/*', (req, res, next) => {
        const clientId = req.ip;
        const count = requestCounts.get(clientId) || 0;
        
        if (count >= 10) { // 10 requests per window
          return res.status(429).json({ 
            error: 'Rate limit exceeded',
            retryAfter: 60
          });
        }
        
        requestCounts.set(clientId, count + 1);
        next();
      });

      app.get('/api/test', (req, res) => {
        res.json({ message: 'Success' });
      });
    });

    it('should allow requests within rate limit', async () => {
      // Act - Make several requests within limit
      for (let i = 0; i < 5; i++) {
        const response = await request(app).get('/api/test');
        expect(response.status).toBe(200);
      }
    });

    it('should block requests exceeding rate limit', async () => {
      // Arrange - Exceed rate limit
      for (let i = 0; i < 10; i++) {
        await request(app).get('/api/test');
      }

      // Act - One more request should be blocked
      const response = await request(app).get('/api/test');

      // Assert
      expect(response.status).toBe(429);
      expect(response.body).toMatchObject({
        error: 'Rate limit exceeded',
        retryAfter: expect.any(Number)
      });
    });
  });

  describe('Error Handling Integration', () => {
    beforeEach(() => {
      // Add routes that can trigger various errors
      app.get('/api/error/500', (req, res) => {
        throw new Error('Internal server error');
      });

      app.get('/api/error/timeout', (req, res) => {
        // Simulate timeout - never respond
        setTimeout(() => {
          res.json({ message: 'This should timeout' });
        }, 10000);
      });

      app.get('/api/error/json', (req, res) => {
        res.status(200).send('invalid json response{');
      });

      // Add error handling middleware
      app.use((error: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
        console.error('Error caught by middleware:', error.message);
        res.status(500).json({
          error: 'Internal Server Error',
          message: error.message,
          timestamp: Date.now()
        });
      });
    });

    it('should handle server errors gracefully', async () => {
      // Act
      const response = await request(app).get('/api/error/500');

      // Assert
      expect(response.status).toBe(500);
      expect(response.body).toMatchObject({
        error: 'Internal Server Error',
        message: 'Internal server error',
        timestamp: expect.any(Number)
      });
    });

    it('should handle request timeouts', async () => {
      // Act & Assert
      await expect(
        request(app)
          .get('/api/error/timeout')
          .timeout(1000)
      ).rejects.toThrow();
    }, 5000);
  });

  describe('Security Headers Integration', () => {
    beforeEach(() => {
      // Add security headers middleware
      app.use((req, res, next) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('X-XSS-Protection', '1; mode=block');
        res.setHeader('Strict-Transport-Security', 'max-age=31536000');
        next();
      });

      app.get('/api/secure', (req, res) => {
        res.json({ message: 'Secure response' });
      });
    });

    it('should include security headers in responses', async () => {
      // Act
      const response = await request(app).get('/api/secure');

      // Assert
      expect(response.status).toBe(200);
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBe('DENY');
      expect(response.headers['x-xss-protection']).toBe('1; mode=block');
      expect(response.headers['strict-transport-security']).toBe('max-age=31536000');
    });
  });

  describe('CORS Integration', () => {
    beforeEach(() => {
      // Add CORS middleware
      app.use('/api/*', (req, res, next) => {
        res.setHeader('Access-Control-Allow-Origin', 'https://allowed-domain.com');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        
        if (req.method === 'OPTIONS') {
          res.status(200).end();
          return;
        }
        
        next();
      });

      app.get('/api/cors-test', (req, res) => {
        res.json({ message: 'CORS test' });
      });
    });

    it('should handle CORS preflight requests', async () => {
      // Act
      const response = await request(app)
        .options('/api/cors-test')
        .set('Origin', 'https://allowed-domain.com');

      // Assert
      expect(response.status).toBe(200);
      expect(response.headers['access-control-allow-origin']).toBe('https://allowed-domain.com');
      expect(response.headers['access-control-allow-methods']).toBe('GET, POST, OPTIONS');
    });

    it('should include CORS headers in actual requests', async () => {
      // Act
      const response = await request(app)
        .get('/api/cors-test')
        .set('Origin', 'https://allowed-domain.com');

      // Assert
      expect(response.status).toBe(200);
      expect(response.headers['access-control-allow-origin']).toBe('https://allowed-domain.com');
    });
  });
});