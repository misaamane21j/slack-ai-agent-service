import { Request, Response, NextFunction } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { getConfig } from '../config/environment';
import { getLogger } from '../utils/logger';

const logger = getLogger();

/**
 * Configuration for Slack request verification middleware
 */
export interface SlackVerificationConfig {
  /** Maximum age of request in seconds (default: 300 = 5 minutes) */
  maxAge?: number;
  /** Whether to skip verification (for testing) */
  skipVerification?: boolean;
}

/**
 * Error types for Slack verification failures
 */
export enum VerificationError {
  MISSING_HEADERS = 'MISSING_HEADERS',
  INVALID_TIMESTAMP = 'INVALID_TIMESTAMP',
  REQUEST_TOO_OLD = 'REQUEST_TOO_OLD',
  INVALID_SIGNATURE = 'INVALID_SIGNATURE',
  MISSING_BODY = 'MISSING_BODY'
}

/**
 * Custom error class for verification failures
 */
export class SlackVerificationError extends Error {
  constructor(
    public readonly type: VerificationError,
    message: string,
    public readonly details?: any
  ) {
    super(message);
    this.name = 'SlackVerificationError';
  }
}

/**
 * Interface for verification result
 */
interface VerificationResult {
  success: boolean;
  error?: SlackVerificationError;
  timestamp?: number;
}

/**
 * Slack request signature verification middleware
 * Implements Slack's request signing verification using HMAC-SHA256
 * 
 * @see https://api.slack.com/authentication/verifying-requests-from-slack
 */
export class SlackVerificationMiddleware {
  private readonly signingSecret: string;
  private readonly config: Required<SlackVerificationConfig>;

  constructor(config: SlackVerificationConfig = {}) {
    const envConfig = getConfig();
    this.signingSecret = envConfig.slack.signingSecret;
    this.config = {
      maxAge: config.maxAge ?? 300, // 5 minutes default
      skipVerification: config.skipVerification ?? false
    };

    if (!this.signingSecret) {
      throw new Error('Slack signing secret not configured');
    }
  }

  /**
   * Create Express middleware function
   */
  public middleware() {
    return (req: Request, res: Response, next: NextFunction): void => {
      if (this.config.skipVerification) {
        logger.warn('Slack verification skipped - not recommended for production');
        return next();
      }

      try {
        const result = this.verifyRequest(req);
        if (result.success) {
          // Add timestamp to request for downstream use
          if (result.timestamp) {
            (req as any).slackTimestamp = result.timestamp;
          }
          logger.debug('Slack request verification successful');
          next();
        } else {
          this.handleVerificationFailure(req, res, result.error!);
        }
      } catch (error) {
        logger.error('Unexpected error during Slack verification', { error });
        this.handleVerificationFailure(
          req,
          res,
          new SlackVerificationError(
            VerificationError.INVALID_SIGNATURE,
            'Verification failed',
            error
          )
        );
      }
    };
  }

  /**
   * Verify a Slack request signature
   */
  private verifyRequest(req: Request): VerificationResult {
    // Extract headers
    const timestamp = req.headers['x-slack-request-timestamp'] as string;
    const signature = req.headers['x-slack-signature'] as string;

    // Validate headers presence
    if (!timestamp || !signature) {
      return {
        success: false,
        error: new SlackVerificationError(
          VerificationError.MISSING_HEADERS,
          'Missing required Slack headers (x-slack-request-timestamp or x-slack-signature)'
        )
      };
    }

    // Parse and validate timestamp
    const timestampNum = parseInt(timestamp, 10);
    if (isNaN(timestampNum)) {
      return {
        success: false,
        error: new SlackVerificationError(
          VerificationError.INVALID_TIMESTAMP,
          'Invalid timestamp format'
        )
      };
    }

    // Check request age (prevent replay attacks)
    const currentTime = Math.floor(Date.now() / 1000);
    const requestAge = currentTime - timestampNum;
    
    if (requestAge > this.config.maxAge) {
      return {
        success: false,
        error: new SlackVerificationError(
          VerificationError.REQUEST_TOO_OLD,
          `Request too old: ${requestAge}s > ${this.config.maxAge}s`,
          { requestAge, maxAge: this.config.maxAge }
        )
      };
    }

    // Get raw body
    const body = this.getRawBody(req);
    if (body === null) {
      return {
        success: false,
        error: new SlackVerificationError(
          VerificationError.MISSING_BODY,
          'Request body is required for verification'
        )
      };
    }

    // Compute expected signature
    const expectedSignature = this.computeSignature(timestamp, body);

    // Compare signatures using timing-safe comparison
    if (!this.verifySignature(signature, expectedSignature)) {
      return {
        success: false,
        error: new SlackVerificationError(
          VerificationError.INVALID_SIGNATURE,
          'Signature mismatch'
        )
      };
    }

    return {
      success: true,
      timestamp: timestampNum
    };
  }

  /**
   * Compute HMAC-SHA256 signature for Slack request
   */
  private computeSignature(timestamp: string, body: string): string {
    const baseString = `v0:${timestamp}:${body}`;
    const hmac = createHmac('sha256', this.signingSecret);
    hmac.update(baseString, 'utf8');
    return `v0=${hmac.digest('hex')}`;
  }

  /**
   * Verify signature using timing-safe comparison
   */
  private verifySignature(received: string, expected: string): boolean {
    if (received.length !== expected.length) {
      return false;
    }

    try {
      const receivedBuffer = Buffer.from(received, 'utf8');
      const expectedBuffer = Buffer.from(expected, 'utf8');
      return timingSafeEqual(receivedBuffer, expectedBuffer);
    } catch (error) {
      logger.error('Error during signature comparison', { error });
      return false;
    }
  }

  /**
   * Extract raw body from request
   * Supports both string and Buffer body types
   */
  private getRawBody(req: Request): string | null {
    // Check for raw body (Express raw middleware)
    if ((req as any).rawBody) {
      const rawBody = (req as any).rawBody;
      return Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
    }

    // Check for body (Express json/urlencoded middleware)
    if (req.body !== undefined) {
      if (typeof req.body === 'string') {
        return req.body;
      }
      if (Buffer.isBuffer(req.body)) {
        return req.body.toString('utf8');
      }
      // For parsed JSON/form data, stringify it
      return JSON.stringify(req.body);
    }

    return null;
  }

  /**
   * Handle verification failure
   */
  private handleVerificationFailure(
    req: Request,
    res: Response,
    error: SlackVerificationError
  ): void {
    // Log security event
    logger.warn('Slack request verification failed', {
      error: error.type,
      message: error.message,
      details: error.details,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      path: req.path,
      method: req.method
    });

    // Return appropriate error response
    const statusCode = this.getStatusCodeForError(error.type);
    res.status(statusCode).json({
      error: 'Unauthorized',
      message: 'Request verification failed',
      code: error.type
    });
  }

  /**
   * Get appropriate HTTP status code for verification error
   */
  private getStatusCodeForError(errorType: VerificationError): number {
    switch (errorType) {
      case VerificationError.MISSING_HEADERS:
        return 400; // Bad Request
      case VerificationError.INVALID_TIMESTAMP:
        return 400; // Bad Request
      case VerificationError.REQUEST_TOO_OLD:
        return 401; // Unauthorized (replay attack)
      case VerificationError.INVALID_SIGNATURE:
        return 401; // Unauthorized
      case VerificationError.MISSING_BODY:
        return 400; // Bad Request
      default:
        return 401; // Unauthorized
    }
  }

  /**
   * Get middleware configuration
   */
  public getConfig(): Required<SlackVerificationConfig> {
    return { ...this.config };
  }

  /**
   * Update middleware configuration
   */
  public updateConfig(newConfig: Partial<SlackVerificationConfig>): void {
    Object.assign(this.config, newConfig);
  }

  /**
   * Verify a request manually (for testing or custom flows)
   */
  public verifyRequestManually(
    timestamp: string,
    signature: string,
    body: string
  ): VerificationResult {
    const mockReq = {
      headers: {
        'x-slack-request-timestamp': timestamp,
        'x-slack-signature': signature
      },
      body
    } as any as Request;

    return this.verifyRequest(mockReq);
  }
}

/**
 * Factory function to create Slack verification middleware
 */
export function createSlackVerificationMiddleware(
  config?: SlackVerificationConfig
): (req: Request, res: Response, next: NextFunction) => void {
  const middleware = new SlackVerificationMiddleware(config);
  return middleware.middleware();
}

/**
 * Express middleware to capture raw body for signature verification
 * Must be used before body parsing middleware
 */
export function rawBodyCapture() {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.get('content-type')?.includes('application/json') || 
        req.get('content-type')?.includes('application/x-www-form-urlencoded')) {
      
      const chunks: Buffer[] = [];
      
      req.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });
      
      req.on('end', () => {
        (req as any).rawBody = Buffer.concat(chunks);
        next();
      });
      
      req.on('error', (error) => {
        logger.error('Error capturing raw body', { error });
        next(error);
      });
    } else {
      next();
    }
  };
}

// Export types and enums for external use