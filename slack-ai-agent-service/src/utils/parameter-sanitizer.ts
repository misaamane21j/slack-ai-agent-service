import Joi from 'joi';
import { logger } from './logger';

/**
 * Configuration for parameter sanitization and validation
 */
interface SanitizationConfig {
  allowedParameters: Set<string>;
  maxParameterLength: number;
  maxParameterCount: number;
  allowedValuePatterns: Record<string, RegExp>;
}

/**
 * Result of parameter sanitization
 */
export interface SanitizationResult {
  sanitized: Record<string, string>;
  warnings: string[];
  rejected: Record<string, string>;
}

/**
 * Security-focused parameter sanitizer for Jenkins job parameters
 */
export class ParameterSanitizer {
  private readonly config: SanitizationConfig;

  constructor() {
    this.config = {
      // Whitelist of allowed parameter names
      allowedParameters: new Set([
        'branch',
        'environment',
        'version',
        'app_name',
        'build_type',
        'deploy_target',
        'config_file',
        'tag',
        'release_notes',
        'timeout',
        'retry_count',
        'notification_channel'
      ]),
      maxParameterLength: 256,
      maxParameterCount: 20,
      // Allowed patterns for specific parameter types
      allowedValuePatterns: {
        branch: /^[a-zA-Z0-9_\-\/\.]{1,100}$/,
        environment: /^(development|staging|production|test)$/,
        version: /^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9_\-\.]+)?$/,
        app_name: /^[a-zA-Z0-9_\-]{1,50}$/,
        build_type: /^(debug|release|test)$/,
        deploy_target: /^[a-zA-Z0-9_\-\.]{1,50}$/,
        config_file: /^[a-zA-Z0-9_\-\.\/]{1,100}$/,
        tag: /^[a-zA-Z0-9_\-\.]{1,50}$/,
        timeout: /^[0-9]{1,4}$/,
        retry_count: /^[0-9]$/,
        notification_channel: /^[a-zA-Z0-9_\-#]{1,50}$/
      }
    };
  }

  /**
   * Sanitize and validate Jenkins job parameters
   */
  sanitizeParameters(parameters: Record<string, any>): SanitizationResult {
    const result: SanitizationResult = {
      sanitized: {},
      warnings: [],
      rejected: {}
    };

    // Check parameter count
    const paramCount = Object.keys(parameters).length;
    if (paramCount > this.config.maxParameterCount) {
      result.warnings.push(`Too many parameters (${paramCount}), limiting to ${this.config.maxParameterCount}`);
      logger().warn('Parameter count exceeded limit', { 
        count: paramCount, 
        limit: this.config.maxParameterCount 
      });
    }

    // Process each parameter
    const entries = Object.entries(parameters).slice(0, this.config.maxParameterCount);
    
    for (const [key, value] of entries) {
      try {
        const sanitizedParam = this.sanitizeParameter(key, value);
        
        if (sanitizedParam.accepted) {
          result.sanitized[sanitizedParam.key] = sanitizedParam.value;
        } else {
          result.rejected[key] = String(value);
          result.warnings.push(`Parameter '${key}' rejected: ${sanitizedParam.reason}`);
        }
      } catch (error) {
        result.rejected[key] = String(value);
        result.warnings.push(`Parameter '${key}' sanitization failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        logger().warn('Parameter sanitization error', { key, value, error });
      }
    }

    // Log sanitization summary
    logger().info('Parameter sanitization completed', {
      original_count: paramCount,
      sanitized_count: Object.keys(result.sanitized).length,
      rejected_count: Object.keys(result.rejected).length,
      warnings_count: result.warnings.length
    });

    return result;
  }

  /**
   * Sanitize individual parameter
   */
  private sanitizeParameter(key: string, value: any): {
    accepted: boolean;
    key: string;
    value: string;
    reason?: string;
  } {
    // Sanitize key name
    const sanitizedKey = this.sanitizeParameterName(key);
    if (!sanitizedKey) {
      return {
        accepted: false,
        key: '',
        value: '',
        reason: 'Invalid parameter name format'
      };
    }

    // Check if parameter is whitelisted
    if (!this.config.allowedParameters.has(sanitizedKey)) {
      return {
        accepted: false,
        key: sanitizedKey,
        value: '',
        reason: 'Parameter not in whitelist'
      };
    }

    // Sanitize value
    const sanitizedValue = this.sanitizeParameterValue(sanitizedKey, value);
    if (!sanitizedValue) {
      return {
        accepted: false,
        key: sanitizedKey,
        value: '',
        reason: 'Invalid parameter value format'
      };
    }

    return {
      accepted: true,
      key: sanitizedKey,
      value: sanitizedValue
    };
  }

  /**
   * Sanitize parameter name
   */
  private sanitizeParameterName(name: string): string | null {
    if (typeof name !== 'string') {
      return null;
    }

    // Remove dangerous characters and normalize
    const sanitized = name
      .trim()
      .toLowerCase()
      .replace(/[^a-zA-Z0-9_\-]/g, '');

    // Validate length and format
    if (sanitized.length === 0 || sanitized.length > 50) {
      return null;
    }

    // Must start with letter or underscore
    if (!/^[a-zA-Z_]/.test(sanitized)) {
      return null;
    }

    return sanitized;
  }

  /**
   * Sanitize parameter value
   */
  private sanitizeParameterValue(paramName: string, value: any): string | null {
    // Convert to string and trim
    let stringValue: string;
    
    if (value === null || value === undefined) {
      return '';
    }
    
    if (typeof value === 'object') {
      // Reject objects/arrays for security
      return null;
    }
    
    stringValue = String(value).trim();

    // Check length
    if (stringValue.length > this.config.maxParameterLength) {
      return null;
    }

    // Apply parameter-specific pattern validation
    const pattern = this.config.allowedValuePatterns[paramName];
    if (pattern && !pattern.test(stringValue)) {
      return null;
    }

    // General sanitization - remove potentially dangerous characters
    const sanitized = stringValue
      .replace(/[\x00-\x1f\x7f-\x9f]/g, '') // Remove control characters
      .replace(/[;<>&|`$]/g, '') // Remove shell metacharacters
      .replace(/\.\.\//g, '') // Remove path traversal attempts
      .replace(/\r\n|\n|\r/g, ' ') // Replace newlines with spaces
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();

    // Final validation - must not be empty after sanitization
    if (sanitized.length === 0 && stringValue.length > 0) {
      return null; // Original had content but was all dangerous chars
    }

    return sanitized;
  }

  /**
   * Validate that sanitized parameters are safe for Jenkins
   */
  validateForJenkins(parameters: Record<string, string>): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    // Check for required parameters based on common Jenkins patterns
    if (Object.keys(parameters).length === 0) {
      errors.push('No valid parameters remaining after sanitization');
    }

    // Validate specific parameter combinations
    if (parameters.environment && parameters.branch) {
      if (parameters.environment === 'production' && parameters.branch !== 'main' && parameters.branch !== 'master') {
        errors.push('Production deployments must use main/master branch');
      }
    }

    // Check for suspicious patterns that survived sanitization
    for (const [key, value] of Object.entries(parameters)) {
      if (value.includes('$(') || value.includes('${') || value.includes('`')) {
        errors.push(`Parameter '${key}' contains potentially dangerous expressions`);
      }
      
      if (value.match(/\b(curl|wget|nc|netcat|bash|sh|cmd|powershell)\b/i)) {
        errors.push(`Parameter '${key}' contains potentially dangerous commands`);
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Get list of allowed parameter names
   */
  getAllowedParameters(): string[] {
    return Array.from(this.config.allowedParameters).sort();
  }
}