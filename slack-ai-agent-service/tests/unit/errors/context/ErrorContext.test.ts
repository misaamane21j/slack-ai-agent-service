/**
 * Unit tests for Enhanced ErrorContext system
 */

import {
  EnhancedErrorContext,
  ErrorContextBuilder,
  ErrorContextUtils,
  OperationPhase,
  ProcessingStage
} from '../../../../src/errors/context/ErrorContext';
import { ErrorSeverity } from '../../../../src/errors/types';

describe('ErrorContextBuilder', () => {
  describe('create and build', () => {
    it('should create a valid ErrorContext with defaults', () => {
      const context = ErrorContextBuilder.create().build();

      expect(context.timestamp).toBeDefined();
      expect(context.severity).toBe(ErrorSeverity.MEDIUM);
      expect(context.correlationId).toBeDefined();
      expect(context.systemContext.environment).toBeDefined();
      expect(context.executionState.processingStage).toBe(ProcessingStage.FAILED);
    });

    it('should allow chaining of builder methods', () => {
      const context = ErrorContextBuilder.create()
        .withSeverity(ErrorSeverity.HIGH)
        .withOperation('test_operation', OperationPhase.TOOL_INVOCATION)
        .withTool('jenkins', 'trigger_job')
        .withUserIntent('deploy app', 'deployment_request', 0.9, 'conv123')
        .withExecutionState(ProcessingStage.TOOL_EXECUTION)
        .withCorrelationId('test123')
        .build();

      expect(context.severity).toBe(ErrorSeverity.HIGH);
      expect(context.operation?.name).toBe('test_operation');
      expect(context.operation?.phase).toBe(OperationPhase.TOOL_INVOCATION);
      expect(context.tool?.serverId).toBe('jenkins');
      expect(context.tool?.toolName).toBe('trigger_job');
      expect(context.userIntent?.originalMessage).toBe('deploy app');
      expect(context.executionState.processingStage).toBe(ProcessingStage.TOOL_EXECUTION);
      expect(context.correlationId).toBe('test123');
    });

    it('should generate unique correlation IDs', () => {
      const context1 = ErrorContextBuilder.create().build();
      const context2 = ErrorContextBuilder.create().build();

      expect(context1.correlationId).toBeDefined();
      expect(context2.correlationId).toBeDefined();
      expect(context1.correlationId).not.toBe(context2.correlationId);
    });

    it('should accept additional context', () => {
      const context = ErrorContextBuilder.create()
        .withAdditionalContext('customField', 'customValue')
        .withAdditionalContext('numericField', 42)
        .build();

      expect(context.additionalContext?.customField).toBe('customValue');
      expect(context.additionalContext?.numericField).toBe(42);
    });
  });

  describe('withOperation', () => {
    it('should set operation details with default start time', () => {
      const beforeBuild = new Date();
      const context = ErrorContextBuilder.create()
        .withOperation('test_op', OperationPhase.INITIALIZATION)
        .build();
      const afterBuild = new Date();

      expect(context.operation?.name).toBe('test_op');
      expect(context.operation?.phase).toBe(OperationPhase.INITIALIZATION);
      expect(context.operation?.startTime).toBeDefined();
      expect(context.operation?.startTime.getTime()).toBeGreaterThanOrEqual(beforeBuild.getTime());
      expect(context.operation?.startTime.getTime()).toBeLessThanOrEqual(afterBuild.getTime());
    });

    it('should accept custom start time', () => {
      const customTime = new Date('2023-01-01T00:00:00Z');
      const context = ErrorContextBuilder.create()
        .withOperation('test_op', OperationPhase.INITIALIZATION, customTime)
        .build();

      expect(context.operation?.startTime).toEqual(customTime);
    });
  });

  describe('withTool', () => {
    it('should set basic tool information', () => {
      const context = ErrorContextBuilder.create()
        .withTool('github', 'create_issue')
        .build();

      expect(context.tool?.serverId).toBe('github');
      expect(context.tool?.toolName).toBe('create_issue');
    });

    it('should accept additional tool metadata', () => {
      const context = ErrorContextBuilder.create()
        .withTool('jenkins', 'trigger_job', {
          version: '2.0',
          capabilities: ['build', 'deploy'],
          configuration: { timeout: 300 }
        })
        .build();

      expect(context.tool?.version).toBe('2.0');
      expect(context.tool?.capabilities).toEqual(['build', 'deploy']);
      expect(context.tool?.configuration).toEqual({ timeout: 300 });
    });
  });

  describe('withUserIntent', () => {
    it('should set user intent information', () => {
      const context = ErrorContextBuilder.create()
        .withUserIntent('build the app', 'build_request', 0.85, 'conv456')
        .build();

      expect(context.userIntent?.originalMessage).toBe('build the app');
      expect(context.userIntent?.parsedIntent).toBe('build_request');
      expect(context.userIntent?.confidence).toBe(0.85);
      expect(context.userIntent?.conversationId).toBe('conv456');
    });
  });
});

describe('ErrorContextUtils', () => {
  describe('createChild', () => {
    it('should create child context inheriting from parent', () => {
      const parentContext: EnhancedErrorContext = ErrorContextBuilder.create()
        .withSeverity(ErrorSeverity.HIGH)
        .withUserIntent('test message', 'test_intent', 0.8, 'conv123')
        .withSystemContext('production')
        .withCorrelationId('parent123')
        .build();

      const childContext = ErrorContextUtils.createChild(
        parentContext,
        'child_operation',
        OperationPhase.TOOL_INVOCATION
      );

      expect(childContext.severity).toBe(ErrorSeverity.HIGH);
      expect(childContext.operation?.name).toBe('child_operation');
      expect(childContext.operation?.phase).toBe(OperationPhase.TOOL_INVOCATION);
      expect(childContext.userIntent?.conversationId).toBe('conv123');
      expect(childContext.systemContext.environment).toBe('production');
      expect(childContext.parentErrorId).toBe('parent123');
      expect(childContext.correlationId).not.toBe('parent123');
    });
  });

  describe('isRetryable', () => {
    it('should return true for retryable phases with retry attempts available', () => {
      const context: EnhancedErrorContext = ErrorContextBuilder.create()
        .withOperation('test_op', OperationPhase.TOOL_INVOCATION)
        .build();
      
      context.operation!.retryAttempt = 1;
      context.operation!.maxRetries = 3;

      expect(ErrorContextUtils.isRetryable(context)).toBe(true);
    });

    it('should return false for non-retryable phases', () => {
      const context: EnhancedErrorContext = ErrorContextBuilder.create()
        .withOperation('test_op', OperationPhase.CLEANUP)
        .build();

      expect(ErrorContextUtils.isRetryable(context)).toBe(false);
    });

    it('should return false when max retries exceeded', () => {
      const context: EnhancedErrorContext = ErrorContextBuilder.create()
        .withOperation('test_op', OperationPhase.TOOL_INVOCATION)
        .build();
      
      context.operation!.retryAttempt = 3;
      context.operation!.maxRetries = 3;

      expect(ErrorContextUtils.isRetryable(context)).toBe(false);
    });

    it('should return false when operation is missing', () => {
      const context: EnhancedErrorContext = ErrorContextBuilder.create().build();
      
      expect(ErrorContextUtils.isRetryable(context)).toBe(false);
    });
  });

  describe('updateTiming', () => {
    it('should calculate duration from operation start time', () => {
      const startTime = new Date(Date.now() - 5000); // 5 seconds ago
      const context: EnhancedErrorContext = ErrorContextBuilder.create()
        .withOperation('test_op', OperationPhase.TOOL_INVOCATION, startTime)
        .build();

      const updatedContext = ErrorContextUtils.updateTiming(context);

      expect(updatedContext.operation?.duration).toBeDefined();
      expect(updatedContext.operation?.duration).toBeGreaterThan(4000);
      expect(updatedContext.operation?.duration).toBeLessThan(6000);
    });

    it('should use provided start time if operation start time is missing', () => {
      const context: EnhancedErrorContext = ErrorContextBuilder.create()
        .withOperation('test_op', OperationPhase.TOOL_INVOCATION)
        .build();
      
      context.operation!.startTime = undefined as any;
      
      const customStart = new Date(Date.now() - 3000);
      const updatedContext = ErrorContextUtils.updateTiming(context, customStart);

      expect(updatedContext.operation?.duration).toBeGreaterThan(2000);
      expect(updatedContext.operation?.duration).toBeLessThan(4000);
    });
  });

  describe('addCompletedStep', () => {
    it('should add step to completed steps list', () => {
      const context: EnhancedErrorContext = ErrorContextBuilder.create()
        .withExecutionState(ProcessingStage.TOOL_EXECUTION)
        .build();

      const updatedContext = ErrorContextUtils.addCompletedStep(context, 'validation');

      expect(updatedContext.executionState.completedSteps).toContain('validation');
    });

    it('should preserve existing completed steps', () => {
      const context: EnhancedErrorContext = ErrorContextBuilder.create()
        .withExecutionState(ProcessingStage.TOOL_EXECUTION)
        .build();
      
      context.executionState.completedSteps = ['initialization', 'discovery'];

      const updatedContext = ErrorContextUtils.addCompletedStep(context, 'validation');

      expect(updatedContext.executionState.completedSteps).toEqual([
        'initialization', 
        'discovery', 
        'validation'
      ]);
    });
  });

  describe('markStepFailed', () => {
    it('should mark step as failed and require rollback', () => {
      const context: EnhancedErrorContext = ErrorContextBuilder.create()
        .withExecutionState(ProcessingStage.TOOL_EXECUTION)
        .build();

      const updatedContext = ErrorContextUtils.markStepFailed(context, 'tool_invocation');

      expect(updatedContext.executionState.failedStep).toBe('tool_invocation');
      expect(updatedContext.executionState.rollbackRequired).toBe(true);
    });
  });
});

describe('OperationPhase enum', () => {
  it('should contain all expected phases', () => {
    const expectedPhases = [
      'INITIALIZATION',
      'VALIDATION', 
      'TOOL_DISCOVERY',
      'TOOL_SELECTION',
      'TOOL_INVOCATION',
      'RESULT_PROCESSING',
      'RESPONSE_FORMATTING',
      'CLEANUP'
    ];

    expectedPhases.forEach(phase => {
      expect(Object.values(OperationPhase)).toContain(phase);
    });
  });
});

describe('ProcessingStage enum', () => {
  it('should contain all expected stages', () => {
    const expectedStages = [
      'REQUEST_RECEIVED',
      'CONTEXT_GATHERING',
      'AI_PROCESSING',
      'TOOL_EXECUTION',
      'RESULT_VALIDATION',
      'RESPONSE_GENERATION',
      'DELIVERY',
      'COMPLETED',
      'FAILED'
    ];

    expectedStages.forEach(stage => {
      expect(Object.values(ProcessingStage)).toContain(stage);
    });
  });
});