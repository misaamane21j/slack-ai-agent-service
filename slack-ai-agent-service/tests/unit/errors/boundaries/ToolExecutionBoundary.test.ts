/**
 * Unit tests for Tool Execution Boundary
 */

import {
  ToolExecutionBoundary,
  ToolExecutionConfig,
  ToolExecutionResult,
  ToolMetadata
} from '../../../../src/errors/boundaries/ToolExecutionBoundary';
import { BoundaryState } from '../../../../src/errors/boundaries/ErrorBoundary';
import {
  EnhancedErrorContext,
  ErrorContextBuilder,
  ProcessingStage,
  OperationPhase
} from '../../../../src/errors/context/ErrorContext';
import { ErrorSeverity } from '../../../../src/errors/types';

// Mock timer functions for testing
jest.useFakeTimers();

describe('ToolExecutionBoundary', () => {
  let boundary: ToolExecutionBoundary;
  let errorContext: EnhancedErrorContext;
  let toolMetadata: ToolMetadata;

  beforeEach(() => {
    boundary = new ToolExecutionBoundary({
      maxErrorsBeforeDegradation: 2,
      maxErrorsBeforeIsolation: 3,
      toolTimeoutMs: 1000,
      enableToolFallback: true,
      blacklistAfterFailures: 3
    });

    errorContext = ErrorContextBuilder.create()
      .withSeverity(ErrorSeverity.MEDIUM)
      .withOperation('tool_execution', OperationPhase.TOOL_INVOCATION)
      .withExecutionState(ProcessingStage.TOOL_EXECUTION)
      .withTool('jenkins', 'trigger_job')
      .build();

    toolMetadata = {
      name: 'jenkins',
      action: 'trigger_job',
      version: '1.0.0',
      capabilities: ['build', 'deploy'],
      fallbacks: ['backup_jenkins', 'notification']
    };
  });

  describe('executeToolOperation', () => {
    it('should execute tool operation successfully', async () => {
      const operation = jest.fn().mockResolvedValue({ status: 'success', jobId: '123' });
      
      const result = await boundary.executeToolOperation(
        'jenkins',
        'trigger_job',
        operation,
        errorContext,
        toolMetadata
      );

      expect(result.success).toBe(true);
      expect(result.toolName).toBe('jenkins');
      expect(result.actionName).toBe('trigger_job');
      expect(result.executionTime).toBeGreaterThan(0);
      expect(result.toolBlacklisted).toBe(false);
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should handle tool operation failure', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('Jenkins API error'));
      
      const result = await boundary.executeToolOperation(
        'jenkins',
        'trigger_job',
        operation,
        errorContext,
        toolMetadata
      );

      expect(result.success).toBe(false);
      expect(result.error?.message).toBe('Jenkins API error');
      expect(result.toolBlacklisted).toBe(false); // Not blacklisted after one failure
    });

    it('should blacklist tool after repeated failures', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('Persistent failure'));
      
      // Execute multiple times to trigger blacklisting
      for (let i = 0; i < 3; i++) {
        await boundary.executeToolOperation(
          'jenkins',
          'trigger_job',
          operation,
          errorContext,
          toolMetadata
        );
      }

      // Check if tool is blacklisted
      const blacklistedTools = boundary.getBlacklistedTools();
      expect(blacklistedTools).toContain('jenkins:trigger_job');

      // Next execution should handle blacklisted tool
      const result = await boundary.executeToolOperation(
        'jenkins',
        'trigger_job',
        operation,
        errorContext,
        toolMetadata
      );

      expect(result.toolBlacklisted).toBe(true);
      expect(result.alternativeToolUsed).toBe('backup_jenkins');
    });

    it('should use fallback tool when primary fails and fallbacks available', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('Primary tool failed'));
      
      const result = await boundary.executeToolOperation(
        'jenkins',
        'trigger_job',
        operation,
        errorContext,
        toolMetadata
      );

      expect(result.fallbackUsed).toBe(true);
      expect(result.alternativeToolUsed).toBe('backup_jenkins');
    });

    it('should handle tool timeout', async () => {
      const slowOperation = () => new Promise(resolve => 
        setTimeout(() => resolve('slow_result'), 5000)
      );
      
      const resultPromise = boundary.executeToolOperation(
        'jenkins',
        'trigger_job',
        slowOperation,
        errorContext,
        toolMetadata
      );
      
      // Advance timers to trigger timeout
      await jest.runAllTimersAsync();
      
      const result = await resultPromise;
      
      expect(result.success).toBe(false);
      expect(result.error?.message).toBe('Operation timeout');
    });

    it('should reset failure count on successful execution', async () => {
      const failingOperation = jest.fn().mockRejectedValue(new Error('Failure'));
      const successOperation = jest.fn().mockResolvedValue('success');
      
      // First fail once
      await boundary.executeToolOperation(
        'jenkins',
        'trigger_job',
        failingOperation,
        errorContext,
        toolMetadata
      );
      
      let stats = boundary.getToolFailureStats();
      expect(stats.get('jenkins:trigger_job')).toBe(1);
      
      // Then succeed
      await boundary.executeToolOperation(
        'jenkins',
        'trigger_job',
        successOperation,
        errorContext,
        toolMetadata
      );
      
      stats = boundary.getToolFailureStats();
      expect(stats.get('jenkins:trigger_job')).toBe(0);
    });

    it('should track tool execution statistics', async () => {
      const operation = jest.fn().mockResolvedValue('success');
      
      // Execute multiple times
      for (let i = 0; i < 3; i++) {
        await boundary.executeToolOperation(
          'jenkins',
          'trigger_job',
          operation,
          errorContext,
          toolMetadata
        );
      }

      const stats = boundary.getToolExecutionStats();
      const jenkinsStats = stats.get('jenkins:trigger_job');
      
      expect(jenkinsStats).toBeDefined();
      expect(jenkinsStats!.executionCount).toBe(3);
      expect(jenkinsStats!.averageTime).toBeGreaterThan(0);
    });
  });

  describe('tool blacklisting', () => {
    it('should handle blacklisted tool with no fallbacks', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('Error'));
      const noFallbackMetadata: ToolMetadata = {
        name: 'custom_tool',
        action: 'custom_action',
        version: '1.0.0',
        capabilities: ['custom'],
        fallbacks: []
      };
      
      // Trigger blacklisting
      for (let i = 0; i < 3; i++) {
        await boundary.executeToolOperation(
          'custom_tool',
          'custom_action',
          operation,
          errorContext,
          noFallbackMetadata
        );
      }

      // Next execution should fail due to no fallbacks
      const result = await boundary.executeToolOperation(
        'custom_tool',
        'custom_action',
        operation,
        errorContext,
        noFallbackMetadata
      );

      expect(result.success).toBe(false);
      expect(result.toolBlacklisted).toBe(true);
      expect(result.alternativeToolUsed).toBeUndefined();
      expect(result.error?.message).toContain('blacklisted and no alternatives available');
    });

    it('should remove tool from blacklist', () => {
      // First blacklist a tool
      boundary['blacklistTool']('test:tool');
      expect(boundary.getBlacklistedTools()).toContain('test:tool');
      
      // Then remove it
      boundary.removeFromBlacklist('test:tool');
      expect(boundary.getBlacklistedTools()).not.toContain('test:tool');
    });

    it('should handle excessive tool failures', async () => {
      const config: Partial<ToolExecutionConfig> = {
        maxToolFailuresPerSession: 2
      };
      
      const restrictiveBoundary = new ToolExecutionBoundary(config);
      const operation = jest.fn().mockRejectedValue(new Error('Error'));
      
      // Exceed max failures per session
      await restrictiveBoundary.executeToolOperation('tool', 'action', operation, errorContext);
      await restrictiveBoundary.executeToolOperation('tool', 'action', operation, errorContext);
      
      // Next execution should handle excessive failures
      const result = await restrictiveBoundary.executeToolOperation(
        'tool',
        'action',
        operation,
        errorContext,
        toolMetadata
      );

      expect(result.toolBlacklisted).toBe(true);
    });
  });

  describe('context preservation', () => {
    it('should preserve context for tool execution', () => {
      const shouldPreserve = boundary['shouldPreserveContext'](errorContext);
      expect(shouldPreserve).toBe(true);
    });

    it('should preserve context when tool is defined', () => {
      const contextWithTool = ErrorContextBuilder.create()
        .withTool('jenkins', 'build')
        .build();
      
      const shouldPreserve = boundary['shouldPreserveContext'](contextWithTool);
      expect(shouldPreserve).toBe(true);
    });

    it('should create preserved context with tool information', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('Error'));
      
      const result = await boundary.executeToolOperation(
        'jenkins',
        'trigger_job',
        operation,
        errorContext,
        toolMetadata
      );

      expect(result.preservedStateId).toBeDefined();
    });
  });

  describe('fallback operations', () => {
    it('should create fallback operation when fallbacks are available', () => {
      const operation = () => Promise.resolve('result');
      const fallback = boundary['getFallbackOperation'](operation, errorContext, toolMetadata);
      
      expect(fallback).toBeDefined();
    });

    it('should not create fallback when fallbacks disabled', () => {
      const noFallbackBoundary = new ToolExecutionBoundary({
        enableToolFallback: false
      });
      
      const operation = () => Promise.resolve('result');
      const fallback = noFallbackBoundary['getFallbackOperation'](operation, errorContext, toolMetadata);
      
      expect(fallback).toBeUndefined();
    });

    it('should not create fallback when no fallback tools available', () => {
      const noFallbackMetadata: ToolMetadata = {
        ...toolMetadata,
        fallbacks: []
      };
      
      const operation = () => Promise.resolve('result');
      const fallback = boundary['getFallbackOperation'](operation, errorContext, noFallbackMetadata);
      
      expect(fallback).toBeUndefined();
    });
  });

  describe('statistics and management', () => {
    it('should provide tool failure statistics', () => {
      const stats = boundary.getToolFailureStats();
      expect(stats).toBeInstanceOf(Map);
    });

    it('should provide tool execution statistics', () => {
      const stats = boundary.getToolExecutionStats();
      expect(stats).toBeInstanceOf(Map);
    });

    it('should clear tool statistics', async () => {
      const operation = jest.fn().mockResolvedValue('success');
      
      // Generate some stats
      await boundary.executeToolOperation(
        'jenkins',
        'trigger_job',
        operation,
        errorContext,
        toolMetadata
      );
      
      expect(boundary.getToolExecutionStats().size).toBeGreaterThan(0);
      
      boundary.clearToolStats();
      
      expect(boundary.getToolExecutionStats().size).toBe(0);
      expect(boundary.getToolFailureStats().size).toBe(0);
      expect(boundary.getBlacklistedTools()).toHaveLength(0);
    });
  });

  describe('boundary integration', () => {
    it('should integrate with boundary state management', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('Error'));
      
      // Trigger boundary degradation
      await boundary.executeToolOperation('tool', 'action', operation, errorContext);
      await boundary.executeToolOperation('tool', 'action', operation, errorContext);
      
      expect(boundary.getState()).toBe(BoundaryState.DEGRADED);
    });

    it('should respect boundary isolation', async () => {
      boundary.isolate(5000);
      
      const operation = jest.fn().mockResolvedValue('success');
      
      const result = await boundary.executeToolOperation(
        'jenkins',
        'trigger_job',
        operation,
        errorContext,
        toolMetadata
      );

      // Should use fallback during isolation
      expect(result.fallbackUsed).toBe(true);
      expect(operation).not.toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should handle tools with special characters in names', async () => {
      const operation = jest.fn().mockResolvedValue('success');
      
      const result = await boundary.executeToolOperation(
        'my-special-tool@v2',
        'action_with_underscores',
        operation,
        errorContext
      );

      expect(result.success).toBe(true);
      expect(result.toolName).toBe('my-special-tool@v2');
      expect(result.actionName).toBe('action_with_underscores');
    });

    it('should handle very long tool names', async () => {
      const longName = 'a'.repeat(1000);
      const operation = jest.fn().mockResolvedValue('success');
      
      const result = await boundary.executeToolOperation(
        longName,
        'action',
        operation,
        errorContext
      );

      expect(result.success).toBe(true);
      expect(result.toolName).toBe(longName);
    });

    it('should handle undefined tool metadata gracefully', async () => {
      const operation = jest.fn().mockResolvedValue('success');
      
      const result = await boundary.executeToolOperation(
        'jenkins',
        'trigger_job',
        operation,
        errorContext,
        undefined
      );

      expect(result.success).toBe(true);
      expect(result.alternativeToolUsed).toBeUndefined();
    });
  });
});

afterEach(() => {
  jest.clearAllTimers();
  jest.restoreAllMocks();
});