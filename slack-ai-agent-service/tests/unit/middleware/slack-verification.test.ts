import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { Request, Response, NextFunction } from 'express';
import { createHmac } from 'crypto';
import {
  SlackVerificationMiddleware,
  createSlackVerificationMiddleware,
  rawBodyCapture,
  SlackVerificationError,
  VerificationError,
  type SlackVerificationConfig
} from '../../../src/middleware/slack-verification';

// Mock dependencies
jest.mock('../../../src/utils/logger', () => ({
  getLogger: () => ({
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    info: jest.fn()
  })
}));

jest.mock('../../../src/config/environment', () => ({
  getConfig: jest.fn()
}));

describe('SlackVerificationMiddleware', () => {
  let middleware: SlackVerificationMiddleware;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  const mockSigningSecret = 'test_signing_secret_12345678901234567890';
  const testBody = '{"type":"event_callback","event":{"type":"app_mention","text":"test"}}';

  beforeEach(() => {
    // Set up the mock config
    const { getConfig } = require('../../../src/config/environment');
    getConfig.mockReturnValue({
      slack: {
        signingSecret: mockSigningSecret
      }
    });

    mockReq = {
      headers: {},
      method: 'POST',
      path: '/slack/events',
      ip: '127.0.0.1',
      get: jest.fn() as any,
      body: testBody
    };

    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    } as any;

    mockNext = jest.fn();

    middleware = new SlackVerificationMiddleware();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create middleware with default config', () => {
      const config = middleware.getConfig();
      expect(config.maxAge).toBe(300);
      expect(config.skipVerification).toBe(false);
    });

    it('should create middleware with custom config', () => {
      const customConfig: SlackVerificationConfig = {
        maxAge: 600,
        skipVerification: true
      };
      
      const customMiddleware = new SlackVerificationMiddleware(customConfig);
      const config = customMiddleware.getConfig();
      
      expect(config.maxAge).toBe(600);
      expect(config.skipVerification).toBe(true);
    });

    it('should throw error if signing secret not configured', () => {
      const { getConfig } = require('../../../src/config/environment');
      getConfig.mockReturnValue({
        slack: {
          signingSecret: ''
        }
      });

      expect(() => new SlackVerificationMiddleware()).toThrow('Slack signing secret not configured');
    });
  });

  describe('middleware function', () => {
    let middlewareFunction: (req: Request, res: Response, next: NextFunction) => void;

    beforeEach(() => {
      middlewareFunction = middleware.middleware();
    });

    it('should skip verification when configured', () => {
      const skipMiddleware = new SlackVerificationMiddleware({ skipVerification: true });
      const skipFunction = skipMiddleware.middleware();

      skipFunction(mockReq as Request, mockRes as any, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should verify valid request and call next', () => {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signature = generateValidSignature(timestamp, testBody, mockSigningSecret);

      mockReq.headers = {
        'x-slack-request-timestamp': timestamp,
        'x-slack-signature': signature
      };

      middlewareFunction(mockReq as Request, mockRes as any, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
      expect((mockReq as any).slackTimestamp).toBe(parseInt(timestamp, 10));
    });

    it('should reject request with missing headers', () => {
      mockReq.headers = {}; // No Slack headers

      middlewareFunction(mockReq as Request, mockRes as any, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Unauthorized',
        message: 'Request verification failed',
        code: VerificationError.MISSING_HEADERS
      });
    });

    it('should reject request with invalid timestamp', () => {
      mockReq.headers = {
        'x-slack-request-timestamp': 'invalid',
        'x-slack-signature': 'v0=signature'
      };

      middlewareFunction(mockReq as Request, mockRes as any, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Unauthorized',
        message: 'Request verification failed',
        code: VerificationError.INVALID_TIMESTAMP
      });
    });

    it('should reject old request (replay attack protection)', () => {
      const oldTimestamp = (Math.floor(Date.now() / 1000) - 400).toString(); // 400 seconds ago
      const signature = generateValidSignature(oldTimestamp, testBody, mockSigningSecret);

      mockReq.headers = {
        'x-slack-request-timestamp': oldTimestamp,
        'x-slack-signature': signature
      };

      middlewareFunction(mockReq as Request, mockRes as any, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Unauthorized',
        message: 'Request verification failed',
        code: VerificationError.REQUEST_TOO_OLD
      });
    });

    it('should reject request with invalid signature', () => {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const invalidSignature = 'v0=invalid_signature';

      mockReq.headers = {
        'x-slack-request-timestamp': timestamp,
        'x-slack-signature': invalidSignature
      };

      middlewareFunction(mockReq as Request, mockRes as any, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Unauthorized',
        message: 'Request verification failed',
        code: VerificationError.INVALID_SIGNATURE
      });
    });

    it('should handle missing body', () => {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signature = 'v0=signature';

      mockReq.headers = {
        'x-slack-request-timestamp': timestamp,
        'x-slack-signature': signature
      };
      mockReq.body = undefined;

      middlewareFunction(mockReq as Request, mockRes as any, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Unauthorized',
        message: 'Request verification failed',
        code: VerificationError.MISSING_BODY
      });
    });

    it('should handle Buffer body', () => {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const bodyBuffer = Buffer.from(testBody, 'utf8');
      const signature = generateValidSignature(timestamp, testBody, mockSigningSecret);

      mockReq.headers = {
        'x-slack-request-timestamp': timestamp,
        'x-slack-signature': signature
      };
      mockReq.body = bodyBuffer;

      middlewareFunction(mockReq as Request, mockRes as any, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should handle rawBody property', () => {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signature = generateValidSignature(timestamp, testBody, mockSigningSecret);

      mockReq.headers = {
        'x-slack-request-timestamp': timestamp,
        'x-slack-signature': signature
      };
      (mockReq as any).rawBody = testBody;
      mockReq.body = undefined;

      middlewareFunction(mockReq as Request, mockRes as any, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should handle JSON object body', () => {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const jsonBody = { type: 'event_callback', event: { type: 'app_mention', text: 'test' } };
      const bodyString = JSON.stringify(jsonBody);
      const signature = generateValidSignature(timestamp, bodyString, mockSigningSecret);

      mockReq.headers = {
        'x-slack-request-timestamp': timestamp,
        'x-slack-signature': signature
      };
      mockReq.body = jsonBody;

      middlewareFunction(mockReq as Request, mockRes as any, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });
  });

  describe('signature computation', () => {
    it('should compute correct signature for known input', () => {
      const timestamp = '1531420618';
      const body = 'token=xyzz0WbapA4vBCDEFasx0q6G&team_id=T1DC2JH3J&team_domain=testteamnow';
      
      // Use known Slack signing secret from their documentation
      const knownSecret = '8f742231b10e8888abcd99yyyzzz85a5';
      
      // Manually compute what the signature should be with the known secret
      const expectedSignature = generateValidSignature(timestamp, body, knownSecret);
      
      const testMiddleware = new SlackVerificationMiddleware();
      
      // Mock the signing secret for this test
      (testMiddleware as any).signingSecret = knownSecret;
      
      const computedSignature = (testMiddleware as any).computeSignature(timestamp, body);
      expect(computedSignature).toBe(expectedSignature);
    });
  });

  describe('timing-safe comparison', () => {
    it('should return false for different length signatures', () => {
      const short = 'v0=abc';
      const long = 'v0=abcdef';
      
      const result = (middleware as any).verifySignature(short, long);
      expect(result).toBe(false);
    });

    it('should use timing-safe comparison', () => {
      const sig1 = 'v0=1234567890abcdef1234567890abcdef12345678';
      const sig2 = 'v0=1234567890abcdef1234567890abcdef12345679'; // Different last char
      
      const result = (middleware as any).verifySignature(sig1, sig2);
      expect(result).toBe(false);
    });
  });

  describe('configuration management', () => {
    it('should update configuration', () => {
      const newConfig = { maxAge: 600, skipVerification: true };
      middleware.updateConfig(newConfig);
      
      const config = middleware.getConfig();
      expect(config.maxAge).toBe(600);
      expect(config.skipVerification).toBe(true);
    });
  });

  describe('manual verification', () => {
    it('should verify request manually', () => {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signature = generateValidSignature(timestamp, testBody, mockSigningSecret);

      const result = middleware.verifyRequestManually(timestamp, signature, testBody);
      
      expect(result.success).toBe(true);
      expect(result.timestamp).toBe(parseInt(timestamp, 10));
    });

    it('should fail manual verification with invalid signature', () => {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const invalidSignature = 'v0=invalid';

      const result = middleware.verifyRequestManually(timestamp, invalidSignature, testBody);
      
      expect(result.success).toBe(false);
      expect(result.error?.type).toBe(VerificationError.INVALID_SIGNATURE);
    });
  });

  describe('error handling', () => {
    it('should handle unexpected errors gracefully', () => {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signature = 'v0=valid';

      // Mock computeSignature to throw an error
      jest.spyOn(middleware as any, 'computeSignature').mockImplementation(() => {
        throw new Error('Unexpected error');
      });

      mockReq.headers = {
        'x-slack-request-timestamp': timestamp,
        'x-slack-signature': signature
      };

      const middlewareFunction = middleware.middleware();
      middlewareFunction(mockReq as Request, mockRes as any, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(401);
    });
  });
});

describe('createSlackVerificationMiddleware', () => {
  it('should create middleware function', () => {
    const middlewareFunction = createSlackVerificationMiddleware();
    expect(typeof middlewareFunction).toBe('function');
  });

  it('should create middleware with custom config', () => {
    const config: SlackVerificationConfig = { maxAge: 600 };
    const middlewareFunction = createSlackVerificationMiddleware(config);
    expect(typeof middlewareFunction).toBe('function');
  });
});

describe('rawBodyCapture', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockReq = {
      get: jest.fn() as any,
      on: jest.fn() as any,
    };
    mockRes = {};
    mockNext = jest.fn();
  });

  it('should capture raw body for JSON content', () => {
    (mockReq.get as jest.Mock).mockReturnValue('application/json');
    
    const bodyData = Buffer.from('{"test": "data"}');
    let dataCallback: (chunk: Buffer) => void;
    let endCallback: () => void;

    (mockReq.on as any).mockImplementation((event: string, callback: any) => {
      if (event === 'data') {
        dataCallback = callback;
      } else if (event === 'end') {
        endCallback = callback;
      }
    });

    const middleware = rawBodyCapture();
    middleware(mockReq as Request, mockRes as Response, mockNext);

    // Simulate data and end events
    dataCallback!(bodyData);
    endCallback!();

    expect((mockReq as any).rawBody).toEqual(bodyData);
    expect(mockNext).toHaveBeenCalled();
  });

  it('should capture raw body for form data', () => {
    (mockReq.get as jest.Mock).mockReturnValue('application/x-www-form-urlencoded');
    
    const bodyData = Buffer.from('token=abc&data=123');
    let dataCallback: (chunk: Buffer) => void;
    let endCallback: () => void;

    (mockReq.on as any).mockImplementation((event: string, callback: any) => {
      if (event === 'data') {
        dataCallback = callback;
      } else if (event === 'end') {
        endCallback = callback;
      }
    });

    const middleware = rawBodyCapture();
    middleware(mockReq as Request, mockRes as Response, mockNext);

    // Simulate data and end events
    dataCallback!(bodyData);
    endCallback!();

    expect((mockReq as any).rawBody).toEqual(bodyData);
    expect(mockNext).toHaveBeenCalled();
  });

  it('should skip capturing for other content types', () => {
    (mockReq.get as jest.Mock).mockReturnValue('text/plain');

    const middleware = rawBodyCapture();
    middleware(mockReq as Request, mockRes as Response, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect((mockReq as any).rawBody).toBeUndefined();
  });

  it('should handle request errors', () => {
    (mockReq.get as jest.Mock).mockReturnValue('application/json');
    
    let errorCallback: (error: Error) => void;

    (mockReq.on as any).mockImplementation((event: string, callback: any) => {
      if (event === 'error') {
        errorCallback = callback;
      }
    });

    const middleware = rawBodyCapture();
    middleware(mockReq as Request, mockRes as Response, mockNext);

    // Simulate error
    const testError = new Error('Request error');
    errorCallback!(testError);

    expect(mockNext).toHaveBeenCalledWith(testError);
  });

  it('should handle multiple data chunks', () => {
    (mockReq.get as jest.Mock).mockReturnValue('application/json');
    
    const chunk1 = Buffer.from('{"test":');
    const chunk2 = Buffer.from(' "data"}');
    let dataCallback: (chunk: Buffer) => void;
    let endCallback: () => void;

    (mockReq.on as any).mockImplementation((event: string, callback: any) => {
      if (event === 'data') {
        dataCallback = callback;
      } else if (event === 'end') {
        endCallback = callback;
      }
    });

    const middleware = rawBodyCapture();
    middleware(mockReq as Request, mockRes as Response, mockNext);

    // Simulate multiple data chunks
    dataCallback!(chunk1);
    dataCallback!(chunk2);
    endCallback!();

    const expectedBuffer = Buffer.concat([chunk1, chunk2]);
    expect((mockReq as any).rawBody).toEqual(expectedBuffer);
    expect(mockNext).toHaveBeenCalled();
  });
});

describe('SlackVerificationError', () => {
  it('should create error with type and message', () => {
    const error = new SlackVerificationError(
      VerificationError.INVALID_SIGNATURE,
      'Test error message'
    );

    expect(error.type).toBe(VerificationError.INVALID_SIGNATURE);
    expect(error.message).toBe('Test error message');
    expect(error.name).toBe('SlackVerificationError');
  });

  it('should create error with details', () => {
    const details = { extra: 'info' };
    const error = new SlackVerificationError(
      VerificationError.REQUEST_TOO_OLD,
      'Test error',
      details
    );

    expect(error.details).toEqual(details);
  });
});

// Helper function to generate valid Slack signatures for testing
function generateValidSignature(timestamp: string, body: string, secret: string): string {
  const baseString = `v0:${timestamp}:${body}`;
  const hmac = createHmac('sha256', secret);
  hmac.update(baseString, 'utf8');
  return `v0=${hmac.digest('hex')}`;
}