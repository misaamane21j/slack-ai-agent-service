import winston from 'winston';
import { getConfig } from '../config/environment';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Security event levels for audit trail
 */
export enum SecurityEventLevel {
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
  CRITICAL = 'critical'
}

/**
 * Security event types for categorization
 */
export enum SecurityEventType {
  AUTHENTICATION_FAILURE = 'auth_failure',
  RATE_LIMIT_VIOLATION = 'rate_limit_violation',
  SUSPICIOUS_REQUEST = 'suspicious_request',
  ACCESS_DENIED = 'access_denied',
  INVALID_SIGNATURE = 'invalid_signature',
  REQUEST_TOO_OLD = 'request_too_old',
  MISSING_HEADERS = 'missing_headers',
  PENALTY_APPLIED = 'penalty_applied',
  WHITELIST_VIOLATION = 'whitelist_violation',
  BLACKLIST_HIT = 'blacklist_hit',
  CONFIGURATION_CHANGE = 'config_change'
}

/**
 * Security event data structure
 */
export interface SecurityEvent {
  type: SecurityEventType;
  level: SecurityEventLevel;
  message: string;
  userId?: string;
  ip?: string;
  userAgent?: string;
  path?: string;
  method?: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}

/**
 * Configuration for secure logger
 */
export interface SecureLoggerConfig {
  /** Enable data sanitization (default: true) */
  sanitizeData?: boolean;
  /** Maximum log file size in MB (default: 10) */
  maxFileSize?: number;
  /** Number of backup files to keep (default: 5) */
  maxFiles?: number;
  /** Enable security audit log (default: true) */
  enableSecurityLog?: boolean;
  /** Directory for log files (default: './logs') */
  logDirectory?: string;
  /** Additional sensitive fields to redact */
  customSensitiveFields?: string[];
}

/**
 * Patterns for detecting sensitive data
 */
const SENSITIVE_PATTERNS = {
  // Tokens and API keys
  SLACK_BOT_TOKEN: /xoxb-[0-9]+-[0-9]+-[0-9]+-[a-zA-Z0-9]+/g,
  SLACK_APP_TOKEN: /xapp-[0-9]+-[A-Z0-9]+-[0-9]+-[a-zA-Z0-9]+/g,
  ANTHROPIC_API_KEY: /sk-ant-api03-[a-zA-Z0-9_-]+/g,
  JWT_TOKEN: /eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g,
  
  // Common sensitive patterns
  PASSWORD: /(?:password|passwd|pwd)["']?\s*[:=]\s*["']?[^"'\s,}]+/gi,
  SECRET: /(?:secret|key|token)["']?\s*[:=]\s*["']?[^"'\s,}]+/gi,
  AUTHORIZATION_HEADER: /(?:authorization|bearer)["']?\s*[:=]\s*["']?[^"'\s,}]+/gi,
  
  // Personal identifiable information
  EMAIL: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  PHONE: /(?:\+?1[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}/g,
  SSN: /\b\d{3}-?\d{2}-?\d{4}\b/g,
  CREDIT_CARD: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
  
  // URLs with potential tokens
  URL_WITH_TOKEN: /(https?:\/\/[^\s]+[?&](?:token|key|secret|auth)=[^&\s]+)/gi
};

/**
 * Default sensitive field names to redact from objects
 */
const DEFAULT_SENSITIVE_FIELDS = [
  'password',
  'passwd',
  'pwd',
  'secret',
  'token',
  'key',
  'authorization',
  'bearer',
  'auth',
  'api_key',
  'apikey',
  'slack_bot_token',
  'slack_app_token',
  'anthropic_api_key',
  'signing_secret',
  'webhook_secret',
  'private_key',
  'credit_card',
  'ssn',
  'social_security',
  'date_of_birth',
  'dob'
];

/**
 * Enhanced secure logger with data sanitization and security audit trails
 */
export class SecureLogger {
  private logger!: winston.Logger;
  private securityLogger!: winston.Logger;
  private config: Required<SecureLoggerConfig>;
  private sensitiveFields: Set<string>;

  constructor(config: SecureLoggerConfig = {}) {
    this.config = {
      sanitizeData: config.sanitizeData ?? true,
      maxFileSize: config.maxFileSize ?? 10,
      maxFiles: config.maxFiles ?? 5,
      enableSecurityLog: config.enableSecurityLog ?? true,
      logDirectory: config.logDirectory ?? './logs',
      customSensitiveFields: config.customSensitiveFields ?? []
    };

    // Combine default and custom sensitive fields
    this.sensitiveFields = new Set([
      ...DEFAULT_SENSITIVE_FIELDS,
      ...this.config.customSensitiveFields
    ]);

    this.ensureLogDirectory();
    this.initializeLoggers();
  }

  /**
   * Ensure log directory exists
   */
  private ensureLogDirectory(): void {
    try {
      if (!fs.existsSync(this.config.logDirectory)) {
        fs.mkdirSync(this.config.logDirectory, { recursive: true });
      }
    } catch (error) {
      console.error('Failed to create log directory:', error);
      // Fall back to current directory
      this.config.logDirectory = './';
    }
  }

  /**
   * Initialize Winston loggers
   */
  private initializeLoggers(): void {
    const envConfig = getConfig();
    
    const baseFormat = winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.json()
    );

    // Main application logger
    this.logger = winston.createLogger({
      level: envConfig.app.logLevel,
      format: baseFormat,
      defaultMeta: { 
        service: 'slack-ai-agent-service',
        environment: envConfig.app.nodeEnv
      },
      transports: [
        new winston.transports.File({
          filename: path.join(this.config.logDirectory, 'error.log'),
          level: 'error',
          maxsize: this.config.maxFileSize * 1024 * 1024,
          maxFiles: this.config.maxFiles,
          tailable: true
        }),
        new winston.transports.File({
          filename: path.join(this.config.logDirectory, 'combined.log'),
          maxsize: this.config.maxFileSize * 1024 * 1024,
          maxFiles: this.config.maxFiles,
          tailable: true
        })
      ]
    });

    // Security audit logger
    if (this.config.enableSecurityLog) {
      this.securityLogger = winston.createLogger({
        level: 'info',
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.json(),
          winston.format.label({ label: 'SECURITY' })
        ),
        defaultMeta: { 
          service: 'slack-ai-agent-service-security',
          environment: envConfig.app.nodeEnv
        },
        transports: [
          new winston.transports.File({
            filename: path.join(this.config.logDirectory, 'security.log'),
            maxsize: this.config.maxFileSize * 1024 * 1024,
            maxFiles: this.config.maxFiles,
            tailable: true
          })
        ]
      });
    }

    // Add console transport for development
    if (envConfig.app.nodeEnv !== 'production') {
      const consoleFormat = winston.format.combine(
        winston.format.colorize(),
        winston.format.simple(),
        winston.format.printf((info) => {
          // Sanitize console output too
          const sanitized = this.sanitizeData(info);
          return `${info.timestamp} [${info.level}]: ${sanitized.message}`;
        })
      );

      this.logger.add(new winston.transports.Console({
        format: consoleFormat
      }));

      if (this.securityLogger) {
        this.securityLogger.add(new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.printf((info) => {
              return `🔒 ${info.timestamp} [SECURITY-${info.level.toUpperCase()}]: ${info.message}`;
            })
          )
        }));
      }
    }
  }

  /**
   * Sanitize data to remove sensitive information
   */
  private sanitizeData(data: any): any {
    if (!this.config.sanitizeData) {
      return data;
    }

    // Handle different data types
    if (typeof data === 'string') {
      return this.sanitizeString(data);
    }

    if (data === null || data === undefined) {
      return data;
    }

    if (typeof data === 'object') {
      return this.sanitizeObject(data);
    }

    return data;
  }

  /**
   * Sanitize string content using regex patterns
   */
  private sanitizeString(text: string): string {
    let sanitized = text;

    // Apply regex patterns to redact sensitive data
    for (const [name, pattern] of Object.entries(SENSITIVE_PATTERNS)) {
      sanitized = sanitized.replace(pattern, (match) => {
        const prefix = match.substring(0, Math.min(4, match.length));
        return `${prefix}[REDACTED-${name}]`;
      });
    }

    return sanitized;
  }

  /**
   * Sanitize object by redacting sensitive fields
   */
  private sanitizeObject(obj: any): any {
    if (Array.isArray(obj)) {
      return obj.map(item => this.sanitizeData(item));
    }

    if (obj instanceof Date || obj instanceof RegExp || obj instanceof Error) {
      return obj;
    }

    const sanitized: any = {};

    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase();
      
      // Check if key matches sensitive field patterns
      const isSensitive = this.sensitiveFields.has(lowerKey) ||
                         Array.from(this.sensitiveFields).some(field => 
                           lowerKey.includes(field) || field.includes(lowerKey)
                         );

      if (isSensitive) {
        sanitized[key] = '[REDACTED]';
      } else {
        sanitized[key] = this.sanitizeData(value);
      }
    }

    return sanitized;
  }

  /**
   * Log information message
   */
  public info(message: string, meta?: any): void {
    const sanitizedMeta = this.sanitizeData(meta);
    this.logger.info(message, sanitizedMeta);
  }

  /**
   * Log warning message
   */
  public warn(message: string, meta?: any): void {
    const sanitizedMeta = this.sanitizeData(meta);
    this.logger.warn(message, sanitizedMeta);
  }

  /**
   * Log error message
   */
  public error(message: string, meta?: any): void {
    const sanitizedMeta = this.sanitizeData(meta);
    this.logger.error(message, sanitizedMeta);
  }

  /**
   * Log debug message
   */
  public debug(message: string, meta?: any): void {
    const sanitizedMeta = this.sanitizeData(meta);
    this.logger.debug(message, sanitizedMeta);
  }

  /**
   * Log security event
   */
  public logSecurityEvent(event: Omit<SecurityEvent, 'timestamp'>): void {
    if (!this.config.enableSecurityLog || !this.securityLogger) {
      return;
    }

    const securityEvent: SecurityEvent = {
      ...event,
      timestamp: new Date()
    };

    const sanitizedEvent = this.sanitizeData(securityEvent);
    
    // Log to security logger
    this.securityLogger.log(event.level, sanitizedEvent.message, {
      securityEvent: sanitizedEvent,
      eventType: event.type,
      userId: event.userId,
      ip: event.ip,
      path: event.path,
      method: event.method,
      metadata: sanitizedEvent.metadata
    });

    // Also log critical security events to main logger
    if (event.level === SecurityEventLevel.CRITICAL || event.level === SecurityEventLevel.ERROR) {
      this.logger.error(`SECURITY EVENT: ${event.message}`, {
        securityEvent: sanitizedEvent
      });
    }
  }

  /**
   * Log authentication failure
   */
  public logAuthFailure(userId: string | undefined, ip: string, reason: string, metadata?: any): void {
    this.logSecurityEvent({
      type: SecurityEventType.AUTHENTICATION_FAILURE,
      level: SecurityEventLevel.WARN,
      message: `Authentication failure: ${reason}`,
      userId,
      ip,
      metadata
    });
  }

  /**
   * Log rate limit violation
   */
  public logRateLimitViolation(userId: string, ip: string, path: string, metadata?: any): void {
    this.logSecurityEvent({
      type: SecurityEventType.RATE_LIMIT_VIOLATION,
      level: SecurityEventLevel.WARN,
      message: `Rate limit exceeded`,
      userId,
      ip,
      path,
      metadata
    });
  }

  /**
   * Log suspicious request
   */
  public logSuspiciousRequest(userId: string | undefined, ip: string, reason: string, metadata?: any): void {
    this.logSecurityEvent({
      type: SecurityEventType.SUSPICIOUS_REQUEST,
      level: SecurityEventLevel.WARN,
      message: `Suspicious request detected: ${reason}`,
      userId,
      ip,
      metadata
    });
  }

  /**
   * Log penalty application
   */
  public logPenaltyApplied(userId: string, penaltyType: string, reason: string, metadata?: any): void {
    this.logSecurityEvent({
      type: SecurityEventType.PENALTY_APPLIED,
      level: SecurityEventLevel.INFO,
      message: `Penalty applied: ${penaltyType} for ${reason}`,
      userId,
      metadata
    });
  }

  /**
   * Log configuration changes
   */
  public logConfigurationChange(component: string, change: string, metadata?: any): void {
    this.logSecurityEvent({
      type: SecurityEventType.CONFIGURATION_CHANGE,
      level: SecurityEventLevel.INFO,
      message: `Configuration changed: ${component} - ${change}`,
      metadata
    });
  }

  /**
   * Get logger configuration
   */
  public getConfig(): Required<SecureLoggerConfig> {
    return { ...this.config };
  }

  /**
   * Update logger configuration
   */
  public updateConfig(newConfig: Partial<SecureLoggerConfig>): void {
    Object.assign(this.config, newConfig);
    
    // Recreate sensitive fields set if custom fields changed
    if (newConfig.customSensitiveFields) {
      this.sensitiveFields = new Set([
        ...DEFAULT_SENSITIVE_FIELDS,
        ...this.config.customSensitiveFields
      ]);
    }

    this.logConfigurationChange('SecureLogger', 'Configuration updated', newConfig);
  }

  /**
   * Test data sanitization (for debugging)
   */
  public testSanitization(data: any): any {
    return this.sanitizeData(data);
  }

  /**
   * Clean up resources
   */
  public async cleanup(): Promise<void> {
    return new Promise((resolve) => {
      let pendingClose = 0;

      const onClose = () => {
        pendingClose--;
        if (pendingClose === 0) {
          resolve();
        }
      };

      // Close main logger
      if (this.logger) {
        this.logger.transports.forEach(transport => {
          if ((transport as any).close) {
            pendingClose++;
            (transport as any).close(onClose);
          }
        });
      }

      // Close security logger
      if (this.securityLogger) {
        this.securityLogger.transports.forEach(transport => {
          if ((transport as any).close) {
            pendingClose++;
            (transport as any).close(onClose);
          }
        });
      }

      // If no transports to close, resolve immediately
      if (pendingClose === 0) {
        resolve();
      }
    });
  }
}

// Singleton instance
let _secureLogger: SecureLogger | null = null;

/**
 * Get singleton secure logger instance
 */
export function getSecureLogger(config?: SecureLoggerConfig): SecureLogger {
  if (!_secureLogger) {
    _secureLogger = new SecureLogger(config);
  }
  return _secureLogger;
}

/**
 * Factory function to create new secure logger instance
 */
export function createSecureLogger(config?: SecureLoggerConfig): SecureLogger {
  return new SecureLogger(config);
}

// Export types and enums for external use