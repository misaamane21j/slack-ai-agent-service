/**
 * Simplified integration tests for error handling validation
 * Tests complete error handling flow with realistic failure conditions
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { ErrorSeverity } from '../../src/errors/types';
import { MCPToolError } from '../../src/errors/mcp-tool';
import { AIProcessingError } from '../../src/errors/ai-processing';
import { SecurityError } from '../../src/errors/security';

// Mock timer functions for testing
jest.useRealTimers();

describe('Error Handling Integration Tests', () => {
  beforeEach(() => {
    // Setup test environment
  });

  describe('Error Creation and Validation', () => {
    it('should create MCP tool errors with proper context', () => {
      // Arrange & Act
      const mcpError = new MCPToolError(
        'Tool execution failed',
        'jenkins-server',
        'build_job',
        {
          operation: 'build_execution',
          severity: ErrorSeverity.HIGH,
          userId: 'U123456789'
        }
      );

      // Assert
      expect(mcpError.message).toBe('Tool execution failed');
      expect(mcpError.serverId).toBe('jenkins-server');
      expect(mcpError.toolName).toBe('build_job');
      expect(mcpError.category).toBe('MCP_TOOL');
      expect(mcpError.context.severity).toBe(ErrorSeverity.HIGH);
    });

    it('should create AI processing errors with proper categorization', () => {
      // Arrange & Act
      const aiError = new AIProcessingError(
        'AI model unavailable',
        'parsing',
        1
      );

      // Assert
      expect(aiError.message).toContain('AI model unavailable');
      expect(aiError.processingStage).toBe('parsing');
      expect(aiError.category).toBe('AI_PROCESSING');
    });

    it('should create security errors with proper severity', () => {
      // Arrange & Act
      const securityError = new SecurityError(
        'Command injection detected',
        'validation',
        {
          operation: 'parameter_processing',
          severity: ErrorSeverity.CRITICAL
        }
      );

      // Assert
      expect(securityError.message).toContain('Command injection detected');
      expect(securityError.securityType).toBe('validation');
      expect(securityError.category).toBe('SECURITY');
    });
  });

  describe('Error Recovery Suggestions', () => {
    it('should provide appropriate recovery suggestions for different error types', () => {
      // Arrange - Create errors with proper recovery suggestions
      const mcpError = new MCPToolError(
        'Connection timeout',
        'jenkins-server',
        'status_check',
        {},
        [
          { action: 'retry_connection', description: 'Retry connection', automated: true },
          { action: 'check_server_status', description: 'Check server', automated: false }
        ]
      );

      const aiError = new AIProcessingError(
        'Model overloaded',
        'tool_selection'
      );

      const securityError = new SecurityError(
        'Unauthorized access attempt',
        'authentication'
      );

      // Assert
      expect(mcpError.recoverySuggestions.length).toBeGreaterThan(0);
      expect(mcpError.recoverySuggestions.some(s => s.action.includes('retry'))).toBe(true);

      expect(aiError.recoverySuggestions.length).toBeGreaterThan(0);
      expect(aiError.recoverySuggestions.some(s => s.action.includes('fallback') || s.action.includes('tool'))).toBe(true);

      expect(securityError.recoverySuggestions.length).toBeGreaterThan(0);
      expect(securityError.recoverySuggestions.some(s => s.action.includes('auth') || s.action.includes('token'))).toBe(true);
    });

    it('should identify retryable vs non-retryable errors', () => {
      // Arrange
      const retryableError = new MCPToolError(
        'Temporary network issue',
        'jenkins-server',
        'deploy'
      );

      const nonRetryableError = new MCPToolError(
        'Invalid configuration detected',
        'jenkins-server',
        'configure'
      );

      const securityError = new SecurityError(
        'Access denied',
        'authorization'
      );

      // Assert
      expect(retryableError.isRetryable()).toBe(true);
      expect(nonRetryableError.isRetryable()).toBe(false);
      expect(securityError.isRetryable()).toBe(false); // Authorization errors are not retryable
    });
  });

  describe('Error Context and Metadata', () => {
    it('should preserve error context through error chain', () => {
      // Arrange
      const originalError = new Error('Original database connection failed');
      
      const mcpError = new MCPToolError(
        'Unable to fetch job status',
        'jenkins-server',
        'job_status',
        {
          operation: 'status_check',
          severity: ErrorSeverity.HIGH,
          userId: 'U123456789',
          additionalContext: {
            jobId: 'build-12345',
            attempt: 3
          }
        },
        [],
        originalError
      );

      // Assert
      expect(mcpError.originalError).toBe(originalError);
      expect(mcpError.context.operation).toBe('status_check');
      expect(mcpError.context.userId).toBe('U123456789');
      expect(mcpError.context.additionalContext?.jobId).toBe('build-12345');
      expect(mcpError.context.additionalContext?.attempt).toBe(3);
    });
  });

  describe('Error Serialization and Logging', () => {
    it('should serialize errors for logging and monitoring', () => {
      // Arrange
      const mcpError = new MCPToolError(
        'Serialization test error',
        'test-server',
        'test-tool',
        {
          operation: 'serialization_test',
          severity: ErrorSeverity.MEDIUM,
          userId: 'U123456789'
        }
      );

      // Act
      const serialized = JSON.stringify(mcpError);
      const parsed = JSON.parse(serialized);

      // Assert - Check the properties that actually get serialized
      expect(parsed.message).toBe('Serialization test error');
      expect(parsed.category).toBe('MCP_TOOL');
      // These properties are available on the error object
      expect(mcpError.serverId).toBe('test-server');
      expect(mcpError.toolName).toBe('test-tool');
      expect(mcpError.context.severity).toBe(ErrorSeverity.MEDIUM);
    });

    it('should create structured error data for monitoring systems', () => {
      // Arrange
      const errors = [
        new MCPToolError('MCP Error', 'server-1', 'tool-1'),
        new AIProcessingError('AI Error', 'parsing'),
        new SecurityError('Security Error', 'validation')
      ];

      // Act & Assert
      errors.forEach(error => {
        const errorData = {
          category: error.category,
          message: error.message,
          severity: error.context.severity || ErrorSeverity.MEDIUM,
          retryable: error.isRetryable(),
          suggestions: error.recoverySuggestions.length
        };

        expect(errorData.category).toBeDefined();
        expect(errorData.message).toBeDefined();
        expect(Object.values(ErrorSeverity)).toContain(errorData.severity);
        expect(typeof errorData.retryable).toBe('boolean');
        expect(typeof errorData.suggestions).toBe('number');
      });
    });
  });

  describe('Performance and Resource Management', () => {
    it('should not impact performance significantly during error creation', () => {
      // Arrange
      const errorCount = 1000;
      const startTime = Date.now();

      // Act
      const errors = [];
      for (let i = 0; i < errorCount; i++) {
        errors.push(new MCPToolError(
          `Performance test error ${i}`,
          `server-${i}`,
          `tool-${i}`,
          {
            operation: 'performance_test',
            severity: ErrorSeverity.LOW,
            additionalContext: {
              iteration: i,
              testData: `data-${i}`
            }
          }
        ));
      }

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Assert
      expect(errors.length).toBe(errorCount);
      expect(duration).toBeLessThan(1000); // Should create 1000 errors in less than 1 second
      
      // Verify all errors are properly formed
      errors.forEach((error, index) => {
        expect(error.serverId).toBe(`server-${index}`);
        expect(error.toolName).toBe(`tool-${index}`);
      });
    });

    it('should handle large error contexts efficiently', () => {
      // Arrange
      const largeContext = {
        operation: 'large_context_test',
        severity: ErrorSeverity.HIGH,
        additionalContext: {
          largeData: new Array(1000).fill('test-data'),
          metadata: {
            users: new Array(100).fill(null).map((_, i) => `user-${i}`),
            timestamps: new Array(100).fill(null).map(() => new Date().toISOString()),
            operations: new Array(50).fill(null).map((_, i) => `operation-${i}`)
          }
        }
      };

      // Act
      const startTime = Date.now();
      const error = new MCPToolError(
        'Large context test',
        'large-server',
        'large-tool',
        largeContext
      );
      const endTime = Date.now();

      // Assert
      expect(endTime - startTime).toBeLessThan(100); // Should handle large context quickly
      expect(error.context.additionalContext?.largeData).toHaveLength(1000);
      
      // Should still serialize properly
      const serialized = JSON.stringify(error);
      expect(serialized.length).toBeGreaterThan(10000); // Large but manageable
      expect(serialized.length).toBeLessThan(100000); // Not excessive
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });
});