/**
 * Unit tests for Error Message Builder system
 */

import {
  ErrorMessageBuilder,
  ErrorMessageFactory,
  MessageTone,
  MessageUrgency,
  SlackErrorMessage,
  InteractiveErrorMessage
} from '../../../../src/errors/messaging/ErrorMessageBuilder';
import {
  EnhancedErrorContext,
  ErrorContextBuilder,
  ProcessingStage,
  OperationPhase
} from '../../../../src/errors/context/ErrorContext';
import { ErrorSeverity } from '../../../../src/errors/types';
import { 
  ImpactMetrics, 
  ImpactLevel, 
  UserExperienceMetric, 
  ResponseType 
} from '../../../../src/errors/impact/ErrorImpact';
import { 
  RecoveryAttempt, 
  RecoveryResult, 
  RecoveryStrategyType 
} from '../../../../src/errors/recovery/RecoveryStrategy';

describe('ErrorMessageBuilder', () => {
  let errorContext: EnhancedErrorContext;
  let impactMetrics: ImpactMetrics;

  beforeEach(() => {
    errorContext = ErrorContextBuilder.create()
      .withSeverity(ErrorSeverity.MEDIUM)
      .withOperation('test_operation', OperationPhase.TOOL_INVOCATION)
      .withExecutionState(ProcessingStage.TOOL_EXECUTION)
      .withTool('jenkins', 'trigger_job')
      .withUserIntent('deploy app', 'deployment_request', 0.8, 'conv123')
      .build();

    impactMetrics = {
      level: ImpactLevel.MODERATE,
      affectedMetrics: [UserExperienceMetric.RESPONSE_DELAY, UserExperienceMetric.FEATURE_UNAVAILABILITY],
      estimatedRecoveryTime: 8000,
      userVisibleDelay: 6000,
      confidenceLoss: 0.4,
      workflowDisruption: 0.5,
      dataIntegrityRisk: 0.2
    };
  });

  describe('buildMessage', () => {
    it('should build complete error message', () => {
      const builder = new ErrorMessageBuilder(errorContext, impactMetrics);
      const message = builder.buildMessage();

      expect(message.primary).toBeDefined();
      expect(message.primary.length).toBeGreaterThan(0);
      expect(message.emoji).toBeDefined();
      expect(message.urgency).toBeDefined();
      expect(message.actionable).toBeDefined();
      expect(message.actionable!.length).toBeGreaterThan(0);
    });

    it('should include secondary message for long delays', () => {
      impactMetrics.userVisibleDelay = 8000; // > 5 seconds
      const builder = new ErrorMessageBuilder(errorContext, impactMetrics);
      const message = builder.buildMessage();

      expect(message.secondary).toBeDefined();
      expect(message.secondary).toContain('8 seconds');
    });

    it('should include feature unavailability warning', () => {
      const builder = new ErrorMessageBuilder(errorContext, impactMetrics);
      const message = builder.buildMessage();

      expect(message.secondary).toContain('features may be temporarily unavailable');
    });

    it('should include low confidence warning', () => {
      errorContext.userIntent!.confidence = 0.6; // Below 0.7 threshold
      const builder = new ErrorMessageBuilder(errorContext, impactMetrics);
      const message = builder.buildMessage();

      expect(message.secondary).toContain('may have misunderstood');
    });
  });

  describe('stage-specific messages', () => {
    it('should create appropriate AI processing message', () => {
      errorContext.executionState.processingStage = ProcessingStage.AI_PROCESSING;
      const builder = new ErrorMessageBuilder(errorContext, impactMetrics);
      const message = builder.buildMessage();

      expect(message.primary).toContain('trouble figuring out');
      expect(message.actionable).toContain('Try rephrasing your request');
    });

    it('should create appropriate tool execution message', () => {
      errorContext.executionState.processingStage = ProcessingStage.TOOL_EXECUTION;
      const builder = new ErrorMessageBuilder(errorContext, impactMetrics);
      const message = builder.buildMessage();

      expect(message.primary).toContain('run trigger_job');
      expect(message.actionable).toContain('Wait a moment and try again');
    });

    it('should create appropriate validation message', () => {
      errorContext.executionState.processingStage = ProcessingStage.RESULT_VALIDATION;
      const builder = new ErrorMessageBuilder(errorContext, impactMetrics);
      const message = builder.buildMessage();

      expect(message.primary).toContain('unexpected results');
    });

    it('should create appropriate response generation message', () => {
      errorContext.executionState.processingStage = ProcessingStage.RESPONSE_GENERATION;
      const builder = new ErrorMessageBuilder(errorContext, impactMetrics);
      const message = builder.buildMessage();

      expect(message.primary).toContain('trouble formatting');
    });
  });

  describe('tone determination', () => {
    it('should use urgent tone for critical impact', () => {
      impactMetrics.level = ImpactLevel.CRITICAL;
      const builder = new ErrorMessageBuilder(errorContext, impactMetrics);
      
      expect(builder['tone']).toBe(MessageTone.URGENT);
    });

    it('should use apologetic tone after multiple failures', () => {
      const failedAttempts: RecoveryAttempt[] = [
        { strategyType: RecoveryStrategyType.RETRY, timestamp: new Date(), result: RecoveryResult.FAILED },
        { strategyType: RecoveryStrategyType.FALLBACK, timestamp: new Date(), result: RecoveryResult.FAILED }
      ];

      const builder = new ErrorMessageBuilder(errorContext, impactMetrics, ResponseType.TEXT, failedAttempts);
      
      expect(builder['tone']).toBe(MessageTone.APOLOGETIC);
    });

    it('should use reassuring tone for high confidence loss', () => {
      impactMetrics.confidenceLoss = 0.8;
      const builder = new ErrorMessageBuilder(errorContext, impactMetrics);
      
      expect(builder['tone']).toBe(MessageTone.REASSURING);
    });

    it('should use friendly tone as default', () => {
      const builder = new ErrorMessageBuilder(errorContext, impactMetrics);
      
      expect(builder['tone']).toBe(MessageTone.FRIENDLY);
    });
  });

  describe('emoji selection', () => {
    it('should select appropriate emoji based on impact level', () => {
      const testCases = [
        { level: ImpactLevel.CRITICAL, expectedEmoji: '🚨' },
        { level: ImpactLevel.HIGH, expectedEmoji: '⚠️' },
        { level: ImpactLevel.MODERATE, expectedEmoji: '⚡' },
        { level: ImpactLevel.LOW, expectedEmoji: '🔄' },
        { level: ImpactLevel.MINIMAL, expectedEmoji: '💭' }
      ];

      testCases.forEach(({ level, expectedEmoji }) => {
        impactMetrics.level = level;
        const builder = new ErrorMessageBuilder(errorContext, impactMetrics);
        const message = builder.buildMessage();

        expect(message.emoji).toBe(expectedEmoji);
      });
    });
  });

  describe('urgency determination', () => {
    it('should map impact levels to urgency correctly', () => {
      const testCases = [
        { level: ImpactLevel.CRITICAL, expectedUrgency: MessageUrgency.CRITICAL },
        { level: ImpactLevel.HIGH, expectedUrgency: MessageUrgency.HIGH },
        { level: ImpactLevel.MODERATE, expectedUrgency: MessageUrgency.MEDIUM },
        { level: ImpactLevel.LOW, expectedUrgency: MessageUrgency.LOW }
      ];

      testCases.forEach(({ level, expectedUrgency }) => {
        impactMetrics.level = level;
        const builder = new ErrorMessageBuilder(errorContext, impactMetrics);
        const message = builder.buildMessage();

        expect(message.urgency).toBe(expectedUrgency);
      });
    });
  });

  describe('recovery message building', () => {
    it('should show success message for successful recovery', () => {
      const successAttempt: RecoveryAttempt[] = [
        { 
          strategyType: RecoveryStrategyType.RETRY, 
          timestamp: new Date(), 
          result: RecoveryResult.SUCCESS 
        }
      ];

      const builder = new ErrorMessageBuilder(errorContext, impactMetrics, ResponseType.TEXT, successAttempt);
      const message = builder.buildMessage();

      expect(message.recovery).toBe('✅ Issue resolved successfully!');
    });

    it('should show progress message for partial success', () => {
      const partialAttempt: RecoveryAttempt[] = [
        { 
          strategyType: RecoveryStrategyType.FALLBACK, 
          timestamp: new Date(), 
          result: RecoveryResult.PARTIAL_SUCCESS 
        }
      ];

      const builder = new ErrorMessageBuilder(errorContext, impactMetrics, ResponseType.TEXT, partialAttempt);
      const message = builder.buildMessage();

      expect(message.recovery).toBe('🔄 Making progress on resolving the issue...');
    });

    it('should show escalation message for multiple failures', () => {
      const multipleFailures: RecoveryAttempt[] = [
        { strategyType: RecoveryStrategyType.RETRY, timestamp: new Date(), result: RecoveryResult.FAILED },
        { strategyType: RecoveryStrategyType.FALLBACK, timestamp: new Date(), result: RecoveryResult.FAILED },
        { strategyType: RecoveryStrategyType.CIRCUIT_BREAKER, timestamp: new Date(), result: RecoveryResult.FAILED }
      ];

      const builder = new ErrorMessageBuilder(errorContext, impactMetrics, ResponseType.TEXT, multipleFailures);
      const message = builder.buildMessage();

      expect(message.recovery).toBe('⚠️ Multiple recovery attempts have failed. Escalating to support.');
    });

    it('should show needs escalation message', () => {
      const escalationAttempt: RecoveryAttempt[] = [
        { 
          strategyType: RecoveryStrategyType.CIRCUIT_BREAKER, 
          timestamp: new Date(), 
          result: RecoveryResult.NEEDS_ESCALATION 
        }
      ];

      const builder = new ErrorMessageBuilder(errorContext, impactMetrics, ResponseType.TEXT, escalationAttempt);
      const message = builder.buildMessage();

      expect(message.recovery).toBe('⚠️ This issue requires manual intervention. Support has been notified.');
    });
  });
});

describe('buildSlackMessage', () => {
  let builder: ErrorMessageBuilder;

  beforeEach(() => {
    const errorContext = ErrorContextBuilder.create()
      .withSeverity(ErrorSeverity.MEDIUM)
      .withExecutionState(ProcessingStage.TOOL_EXECUTION)
      .build();

    const impactMetrics: ImpactMetrics = {
      level: ImpactLevel.MODERATE,
      affectedMetrics: [UserExperienceMetric.RESPONSE_DELAY],
      estimatedRecoveryTime: 5000,
      userVisibleDelay: 4000,
      confidenceLoss: 0.3,
      workflowDisruption: 0.4,
      dataIntegrityRisk: 0.1
    };

    builder = new ErrorMessageBuilder(errorContext, impactMetrics);
  });

  it('should create Slack blocks structure', () => {
    const slackMessage: SlackErrorMessage = builder.buildSlackMessage();

    expect(slackMessage.blocks).toBeDefined();
    expect(slackMessage.blocks!.length).toBeGreaterThan(0);
    
    // Should have main message block
    const mainBlock = slackMessage.blocks![0];
    expect(mainBlock.type).toBe('section');
    expect(mainBlock.text.text).toContain('*'); // Bold formatting
  });

  it('should include reactions suggestions', () => {
    const slackMessage: SlackErrorMessage = builder.buildSlackMessage();

    expect(slackMessage.reactions).toBeDefined();
    expect(slackMessage.reactions!.length).toBeGreaterThan(0);
  });

  it('should suggest thread reply for low impact errors', () => {
    const lowImpactMetrics: ImpactMetrics = {
      level: ImpactLevel.LOW,
      affectedMetrics: [UserExperienceMetric.RESPONSE_DELAY],
      estimatedRecoveryTime: 2000,
      userVisibleDelay: 1500,
      confidenceLoss: 0.1,
      workflowDisruption: 0.2,
      dataIntegrityRisk: 0.0
    };

    const lowImpactBuilder = new ErrorMessageBuilder(
      builder['errorContext'], 
      lowImpactMetrics
    );
    const slackMessage = lowImpactBuilder.buildSlackMessage();

    expect(slackMessage.threadReply).toBe(true);
  });

  it('should not suggest thread reply for high impact errors', () => {
    const highImpactMetrics: ImpactMetrics = {
      level: ImpactLevel.HIGH,
      affectedMetrics: [UserExperienceMetric.FEATURE_UNAVAILABILITY],
      estimatedRecoveryTime: 15000,
      userVisibleDelay: 12000,
      confidenceLoss: 0.7,
      workflowDisruption: 0.8,
      dataIntegrityRisk: 0.5
    };

    const highImpactBuilder = new ErrorMessageBuilder(
      builder['errorContext'], 
      highImpactMetrics
    );
    const slackMessage = highImpactBuilder.buildSlackMessage();

    expect(slackMessage.threadReply).toBe(false);
  });
});

describe('buildInteractiveMessage', () => {
  let builder: ErrorMessageBuilder;

  beforeEach(() => {
    const errorContext = ErrorContextBuilder.create()
      .withSeverity(ErrorSeverity.MEDIUM)
      .withExecutionState(ProcessingStage.TOOL_EXECUTION)
      .withUserIntent('test request', 'test_intent', 0.8, 'conv123')
      .build();

    // Add fallback options
    errorContext.userIntent!.fallbackOptions = ['option1', 'option2'];

    const impactMetrics: ImpactMetrics = {
      level: ImpactLevel.MODERATE,
      affectedMetrics: [UserExperienceMetric.RESPONSE_DELAY],
      estimatedRecoveryTime: 5000,
      userVisibleDelay: 4000,
      confidenceLoss: 0.3,
      workflowDisruption: 0.4,
      dataIntegrityRisk: 0.1
    };

    builder = new ErrorMessageBuilder(errorContext, impactMetrics, ResponseType.INTERACTIVE);
  });

  it('should create interactive message with buttons', () => {
    const interactiveMessage: InteractiveErrorMessage = builder.buildInteractiveMessage();

    expect(interactiveMessage.buttons).toBeDefined();
    expect(interactiveMessage.buttons!.length).toBeGreaterThan(0);
  });

  it('should include retry button for retryable errors', () => {
    const interactiveMessage: InteractiveErrorMessage = builder.buildInteractiveMessage();

    const retryButton = interactiveMessage.buttons!.find(b => b.action === 'retry');
    expect(retryButton).toBeDefined();
    expect(retryButton!.label).toBe('Try Again');
    expect(retryButton!.style).toBe('primary');
  });

  it('should include fallback button when fallback options exist', () => {
    const interactiveMessage: InteractiveErrorMessage = builder.buildInteractiveMessage();

    const fallbackButton = interactiveMessage.buttons!.find(b => b.action === 'fallback');
    expect(fallbackButton).toBeDefined();
    expect(fallbackButton!.label).toBe('Use Alternative');
  });

  it('should include escalation button for high impact errors', () => {
    const highImpactMetrics: ImpactMetrics = {
      level: ImpactLevel.HIGH,
      affectedMetrics: [UserExperienceMetric.FEATURE_UNAVAILABILITY],
      estimatedRecoveryTime: 15000,
      userVisibleDelay: 12000,
      confidenceLoss: 0.7,
      workflowDisruption: 0.8,
      dataIntegrityRisk: 0.5
    };

    const highImpactBuilder = new ErrorMessageBuilder(
      builder['errorContext'], 
      highImpactMetrics, 
      ResponseType.INTERACTIVE
    );
    const interactiveMessage = highImpactBuilder.buildInteractiveMessage();

    const escalateButton = interactiveMessage.buttons!.find(b => b.action === 'escalate');
    expect(escalateButton).toBeDefined();
    expect(escalateButton!.label).toBe('Contact Support');
    expect(escalateButton!.style).toBe('danger');
    expect(escalateButton!.confirm).toBe(true);
  });

  it('should include quick replies', () => {
    const interactiveMessage: InteractiveErrorMessage = builder.buildInteractiveMessage();

    expect(interactiveMessage.quickReplies).toBeDefined();
    expect(interactiveMessage.quickReplies!).toContain('Try again');
    expect(interactiveMessage.quickReplies!).toContain('Cancel');
  });

  it('should include AI processing specific quick replies', () => {
    const aiProcessingContext = ErrorContextBuilder.create()
      .withExecutionState(ProcessingStage.AI_PROCESSING)
      .build();

    const aiBuilder = new ErrorMessageBuilder(aiProcessingContext, builder['impactMetrics'], ResponseType.INTERACTIVE);
    const interactiveMessage = aiBuilder.buildInteractiveMessage();

    expect(interactiveMessage.quickReplies).toContain('Can you explain differently?');
    expect(interactiveMessage.quickReplies).toContain('What options do I have?');
  });
});

describe('ErrorMessageFactory', () => {
  let errorContext: EnhancedErrorContext;
  let impactMetrics: ImpactMetrics;

  beforeEach(() => {
    errorContext = ErrorContextBuilder.create()
      .withSeverity(ErrorSeverity.MEDIUM)
      .withExecutionState(ProcessingStage.TOOL_EXECUTION)
      .build();

    impactMetrics = {
      level: ImpactLevel.MODERATE,
      affectedMetrics: [UserExperienceMetric.RESPONSE_DELAY],
      estimatedRecoveryTime: 5000,
      userVisibleDelay: 4000,
      confidenceLoss: 0.3,
      workflowDisruption: 0.4,
      dataIntegrityRisk: 0.1
    };
  });

  describe('forSlack', () => {
    it('should create message builder with TEXT response type', () => {
      const builder = ErrorMessageFactory.forSlack(errorContext, impactMetrics);
      
      expect(builder['responseType']).toBe(ResponseType.TEXT);
    });
  });

  describe('forInteractive', () => {
    it('should create message builder with INTERACTIVE response type', () => {
      const builder = ErrorMessageFactory.forInteractive(errorContext, impactMetrics);
      
      expect(builder['responseType']).toBe(ResponseType.INTERACTIVE);
    });
  });

  describe('autoDetect', () => {
    it('should detect INTERACTIVE type when fallback options exist', () => {
      errorContext.userIntent = {
        originalMessage: 'test',
        parsedIntent: 'test',
        confidence: 0.8,
        conversationId: 'conv123',
        fallbackOptions: ['option1', 'option2']
      };

      const builder = ErrorMessageFactory.autoDetect(errorContext, impactMetrics);
      
      expect(builder['responseType']).toBe(ResponseType.INTERACTIVE);
    });

    it('should default to TEXT type when no fallback options', () => {
      const builder = ErrorMessageFactory.autoDetect(errorContext, impactMetrics);
      
      expect(builder['responseType']).toBe(ResponseType.TEXT);
    });
  });
});

describe('tool action descriptions', () => {
  it('should provide human-friendly tool descriptions', () => {
    const errorContext = ErrorContextBuilder.create()
      .withTool('jenkins', 'trigger_jenkins_job')
      .withExecutionState(ProcessingStage.TOOL_EXECUTION)
      .build();

    const impactMetrics: ImpactMetrics = {
      level: ImpactLevel.MODERATE,
      affectedMetrics: [UserExperienceMetric.RESPONSE_DELAY],
      estimatedRecoveryTime: 5000,
      userVisibleDelay: 4000,
      confidenceLoss: 0.3,
      workflowDisruption: 0.4,
      dataIntegrityRisk: 0.1
    };

    const builder = new ErrorMessageBuilder(errorContext, impactMetrics);
    const message = builder.buildMessage();

    expect(message.primary).toContain('trigger the build');
  });

  it('should fallback to generic description for unknown tools', () => {
    const errorContext = ErrorContextBuilder.create()
      .withTool('custom', 'unknown_tool')
      .withExecutionState(ProcessingStage.TOOL_EXECUTION)
      .build();

    const impactMetrics: ImpactMetrics = {
      level: ImpactLevel.MODERATE,
      affectedMetrics: [UserExperienceMetric.RESPONSE_DELAY],
      estimatedRecoveryTime: 5000,
      userVisibleDelay: 4000,
      confidenceLoss: 0.3,
      workflowDisruption: 0.4,
      dataIntegrityRisk: 0.1
    };

    const builder = new ErrorMessageBuilder(errorContext, impactMetrics);
    const message = builder.buildMessage();

    expect(message.primary).toContain('run unknown_tool');
  });
});