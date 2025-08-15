import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import {
  SecureLogger,
  SecurityEventLevel,
  SecurityEventType,
  type SecureLoggerConfig
} from '../../../src/utils/secure-logger';

// Mock dependencies
jest.mock('../../../src/config/environment', () => ({
  getConfig: () => ({
    app: {
      logLevel: 'info',
      nodeEnv: 'test'
    }
  })
}));

jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(true),
  mkdirSync: jest.fn()
}));

jest.mock('winston', () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    log: jest.fn(),
    add: jest.fn(),
    transports: []
  })),
  format: {
    combine: jest.fn(() => 'combined'),
    timestamp: jest.fn(() => 'timestamp'),
    errors: jest.fn(() => 'errors'),
    json: jest.fn(() => 'json'),
    colorize: jest.fn(() => 'colorize'),
    simple: jest.fn(() => 'simple'),
    printf: jest.fn(() => 'printf'),
    label: jest.fn(() => 'label')
  },
  transports: {
    File: jest.fn(),
    Console: jest.fn()
  }
}));

describe('SecureLogger Data Sanitization', () => {
  let secureLogger: SecureLogger;

  beforeEach(() => {
    secureLogger = new SecureLogger();
  });

  describe('string sanitization', () => {
    it('should redact sensitive tokens in strings', () => {
      const testCases = [
        {
          input: 'Token: xoxb-123-456-789-abcdefghijk',
          shouldNotContain: 'xoxb-123-456-789-abcdefghijk'
        },
        {
          input: 'App token: xapp-1-ABC123-4-xyz789',
          shouldNotContain: 'xapp-1-ABC123-4-xyz789'
        },
        {
          input: 'API Key: sk-ant-api03-abc123def456',
          shouldNotContain: 'sk-ant-api03-abc123def456'
        },
        {
          input: 'password: "mysecretpass"',
          shouldNotContain: 'mysecretpass'
        },
        {
          input: 'Contact: user@example.com',
          shouldNotContain: 'user@example.com'
        },
        {
          input: 'Card: 4111-1111-1111-1111',
          shouldNotContain: '4111-1111-1111-1111'
        },
        {
          input: 'SSN: 123-45-6789',
          shouldNotContain: '123-45-6789'
        }
      ];

      testCases.forEach(({ input, shouldNotContain }) => {
        const result = secureLogger.testSanitization(input);
        expect(result).toContain('[REDACTED');
        expect(result).not.toContain(shouldNotContain);
      });
    });

    it('should preserve safe content', () => {
      const safeInput = 'This is safe content with numbers 123 and normal text';
      const result = secureLogger.testSanitization(safeInput);
      expect(result).toBe(safeInput);
    });
  });

  describe('object sanitization', () => {
    it('should redact sensitive fields in objects', () => {
      const input = {
        username: 'john',
        password: 'secret123',
        token: 'abc123',
        api_key: 'xyz789',
        normal_field: 'safe_value'
      };

      const result = secureLogger.testSanitization(input);

      expect(result.username).toBe('john');
      expect(result.password).toBe('[REDACTED]');
      expect(result.token).toBe('[REDACTED]');
      expect(result.api_key).toBe('[REDACTED]');
      expect(result.normal_field).toBe('safe_value');
    });

    it('should handle nested objects', () => {
      const input = {
        user: {
          name: 'John',
          credentials: {
            password: 'secret',
            token: 'abc123'
          }
        },
        public_data: 'safe'
      };

      const result = secureLogger.testSanitization(input);

      expect(result.user.name).toBe('John');
      expect(result.user.credentials.password).toBe('[REDACTED]');
      expect(result.user.credentials.token).toBe('[REDACTED]');
      expect(result.public_data).toBe('safe');
    });

    it('should handle arrays', () => {
      const input = [
        { username: 'user1', password: 'pass1' },
        { username: 'user2', secret: 'secret2' }
      ];

      const result = secureLogger.testSanitization(input);

      expect(result[0].username).toBe('user1');
      expect(result[0].password).toBe('[REDACTED]');
      expect(result[1].username).toBe('user2');
      expect(result[1].secret).toBe('[REDACTED]');
    });

    it('should handle null and undefined values', () => {
      expect(secureLogger.testSanitization(null)).toBe(null);
      expect(secureLogger.testSanitization(undefined)).toBe(undefined);
    });

    it('should preserve special object types', () => {
      const date = new Date();
      const regex = /test/;
      const error = new Error('Test error');

      const input = {
        timestamp: date,
        pattern: regex,
        error: error,
        password: 'secret'
      };

      const result = secureLogger.testSanitization(input);

      expect(result.timestamp).toBe(date);
      expect(result.pattern).toBe(regex);
      expect(result.error).toBe(error);
      expect(result.password).toBe('[REDACTED]');
    });
  });

  describe('configuration', () => {
    it('should skip sanitization when disabled', () => {
      const unsanitizedLogger = new SecureLogger({ sanitizeData: false });
      
      const input = {
        password: 'secret123',
        token: 'abc456'
      };

      const result = unsanitizedLogger.testSanitization(input);

      expect(result.password).toBe('secret123');
      expect(result.token).toBe('abc456');
    });

    it('should handle custom sensitive fields', () => {
      const customLogger = new SecureLogger({
        customSensitiveFields: ['internal_id', 'private_note']
      });

      const input = {
        username: 'john',
        internal_id: 'sensitive123',
        private_note: 'confidential',
        public_info: 'safe'
      };

      const result = customLogger.testSanitization(input);

      expect(result.username).toBe('john');
      expect(result.internal_id).toBe('[REDACTED]');
      expect(result.private_note).toBe('[REDACTED]');
      expect(result.public_info).toBe('safe');
    });

    it('should create with default configuration', () => {
      const config = secureLogger.getConfig();
      
      expect(config.sanitizeData).toBe(true);
      expect(config.maxFileSize).toBe(10);
      expect(config.maxFiles).toBe(5);
      expect(config.enableSecurityLog).toBe(true);
      expect(config.logDirectory).toBe('./logs');
    });

    it('should create with custom configuration', () => {
      const customConfig: SecureLoggerConfig = {
        sanitizeData: false,
        maxFileSize: 20,
        maxFiles: 3,
        enableSecurityLog: false,
        logDirectory: '/var/log',
        customSensitiveFields: ['custom_field']
      };

      const customLogger = new SecureLogger(customConfig);
      const config = customLogger.getConfig();

      expect(config.sanitizeData).toBe(false);
      expect(config.maxFileSize).toBe(20);
      expect(config.maxFiles).toBe(3);
      expect(config.enableSecurityLog).toBe(false);
      expect(config.logDirectory).toBe('/var/log');
      expect(config.customSensitiveFields).toContain('custom_field');
    });

    it('should update configuration', () => {
      const newConfig = {
        maxFileSize: 20,
        customSensitiveFields: ['new_field']
      };

      secureLogger.updateConfig(newConfig);
      const config = secureLogger.getConfig();

      expect(config.maxFileSize).toBe(20);
      expect(config.customSensitiveFields).toContain('new_field');
    });
  });

  describe('security event types', () => {
    it('should have correct security event levels', () => {
      expect(SecurityEventLevel.INFO).toBe('info');
      expect(SecurityEventLevel.WARN).toBe('warn');
      expect(SecurityEventLevel.ERROR).toBe('error');
      expect(SecurityEventLevel.CRITICAL).toBe('critical');
    });

    it('should have correct security event types', () => {
      expect(SecurityEventType.AUTHENTICATION_FAILURE).toBe('auth_failure');
      expect(SecurityEventType.RATE_LIMIT_VIOLATION).toBe('rate_limit_violation');
      expect(SecurityEventType.SUSPICIOUS_REQUEST).toBe('suspicious_request');
      expect(SecurityEventType.INVALID_SIGNATURE).toBe('invalid_signature');
    });
  });
});