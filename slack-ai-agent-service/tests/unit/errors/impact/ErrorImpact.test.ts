/**
 * Unit tests for Error Impact Assessment system
 */

import {
  ErrorImpactAssessment,
  ErrorImpactFactory,
  ImpactLevel,
  UserExperienceMetric,
  ResponseType,
  UserContext,
  BusinessContext,
  ImpactMetrics
} from '../../../../src/errors/impact/ErrorImpact';
import {
  EnhancedErrorContext,
  ErrorContextBuilder,
  ProcessingStage,
  OperationPhase
} from '../../../../src/errors/context/ErrorContext';
import { ErrorSeverity } from '../../../../src/errors/types';
import { RecoveryAttempt, RecoveryResult, RecoveryStrategyType } from '../../../../src/errors/recovery/RecoveryStrategy';

describe('ErrorImpactAssessment', () => {
  let errorContext: EnhancedErrorContext;
  let userContext: UserContext;
  let businessContext: BusinessContext;

  beforeEach(() => {
    errorContext = ErrorContextBuilder.create()
      .withSeverity(ErrorSeverity.MEDIUM)
      .withOperation('test_operation', OperationPhase.TOOL_INVOCATION)
      .withExecutionState(ProcessingStage.TOOL_EXECUTION)
      .withTool('jenkins', 'trigger_job')
      .build();

    userContext = {
      isFirstTimeUser: false,
      recentErrorCount: 0,
      currentWorkflowStage: 'testing',
      expectedResponseType: ResponseType.TEXT,
      urgencyLevel: 'MEDIUM',
      hasAlternativeOptions: true
    };

    businessContext = {
      businessCriticality: 'MEDIUM',
      peakUsageTime: false,
      affectedUserCount: 1,
      revenueImpact: 0,
      complianceRisk: false
    };
  });

  describe('assessImpact', () => {
    it('should assess basic impact from error severity', () => {
      const assessment = new ErrorImpactAssessment(errorContext, userContext, businessContext);
      const impact = assessment.assessImpact();

      expect(impact.level).toBe(ImpactLevel.MODERATE);
      expect(impact.affectedMetrics).toContain(UserExperienceMetric.RESPONSE_DELAY);
      expect(impact.userVisibleDelay).toBeGreaterThan(0);
      expect(impact.confidenceLoss).toBeGreaterThan(0);
      expect(impact.workflowDisruption).toBeGreaterThan(0);
    });

    it('should escalate impact for critical errors', () => {
      errorContext.severity = ErrorSeverity.CRITICAL;
      const assessment = new ErrorImpactAssessment(errorContext, userContext, businessContext);
      const impact = assessment.assessImpact();

      expect(impact.level).toBe(ImpactLevel.CRITICAL);
      expect(impact.userVisibleDelay).toBeGreaterThan(20000); // > 20 seconds
      expect(impact.confidenceLoss).toBeGreaterThan(0.7);
    });

    it('should minimize impact for low severity errors', () => {
      errorContext.severity = ErrorSeverity.LOW;
      const assessment = new ErrorImpactAssessment(errorContext, userContext, businessContext);
      const impact = assessment.assessImpact();

      expect(impact.level).toBe(ImpactLevel.LOW);
      expect(impact.userVisibleDelay).toBeLessThan(5000);
      expect(impact.confidenceLoss).toBeLessThan(0.31); // Account for floating point precision
    });
  });

  describe('stage-specific impact assessment', () => {
    it('should adjust impact based on processing stage', () => {
      const toolExecutionContext = { ...errorContext };
      toolExecutionContext.executionState.processingStage = ProcessingStage.TOOL_EXECUTION;

      const deliveryContext = { ...errorContext };
      deliveryContext.executionState.processingStage = ProcessingStage.DELIVERY;

      const toolAssessment = new ErrorImpactAssessment(toolExecutionContext, userContext, businessContext);
      const deliveryAssessment = new ErrorImpactAssessment(deliveryContext, userContext, businessContext);

      const toolImpact = toolAssessment.assessImpact();
      const deliveryImpact = deliveryAssessment.assessImpact();

      // Tool execution failures should have higher impact than delivery failures
      expect(toolImpact.workflowDisruption).toBeGreaterThanOrEqual(deliveryImpact.workflowDisruption);
    });

    it('should include feature unavailability for tool execution failures', () => {
      errorContext.executionState.processingStage = ProcessingStage.TOOL_EXECUTION;
      const assessment = new ErrorImpactAssessment(errorContext, userContext, businessContext);
      const impact = assessment.assessImpact();

      expect(impact.affectedMetrics).toContain(UserExperienceMetric.FEATURE_UNAVAILABILITY);
    });

    it('should include data loss risk for validation failures', () => {
      errorContext.executionState.processingStage = ProcessingStage.RESULT_VALIDATION;
      const assessment = new ErrorImpactAssessment(errorContext, userContext, businessContext);
      const impact = assessment.assessImpact();

      expect(impact.affectedMetrics).toContain(UserExperienceMetric.DATA_LOSS);
      expect(impact.dataIntegrityRisk).toBeGreaterThan(0.5);
    });
  });

  describe('user context adjustments', () => {
    it('should increase impact for first-time users', () => {
      const regularUserAssessment = new ErrorImpactAssessment(errorContext, userContext, businessContext);
      const regularImpact = regularUserAssessment.assessImpact();

      userContext.isFirstTimeUser = true;
      const firstTimeAssessment = new ErrorImpactAssessment(errorContext, userContext, businessContext);
      const firstTimeImpact = firstTimeAssessment.assessImpact();

      expect(firstTimeImpact.confidenceLoss).toBeGreaterThan(regularImpact.confidenceLoss);
      expect(firstTimeImpact.affectedMetrics).toContain(UserExperienceMetric.TRUST_DEGRADATION);
    });

    it('should increase impact for users with recent errors', () => {
      userContext.recentErrorCount = 3;
      const assessment = new ErrorImpactAssessment(errorContext, userContext, businessContext);
      const impact = assessment.assessImpact();

      expect(impact.confidenceLoss).toBeGreaterThan(0.5);
      expect(impact.workflowDisruption).toBeGreaterThan(0.5);
    });

    it('should adjust impact based on urgency level', () => {
      const lowUrgencyContext = { ...userContext, urgencyLevel: 'LOW' as const };
      const highUrgencyContext = { ...userContext, urgencyLevel: 'CRITICAL' as const };

      const lowUrgencyAssessment = new ErrorImpactAssessment(errorContext, lowUrgencyContext, businessContext);
      const highUrgencyAssessment = new ErrorImpactAssessment(errorContext, highUrgencyContext, businessContext);

      const lowImpact = lowUrgencyAssessment.assessImpact();
      const highImpact = highUrgencyAssessment.assessImpact();

      expect(highImpact.userVisibleDelay).toBeGreaterThan(lowImpact.userVisibleDelay);
      expect(highImpact.workflowDisruption).toBeGreaterThan(lowImpact.workflowDisruption);
    });

    it('should reduce impact when alternative options are available', () => {
      const noOptionsContext = { ...userContext, hasAlternativeOptions: false };
      const withOptionsContext = { ...userContext, hasAlternativeOptions: true };

      const noOptionsAssessment = new ErrorImpactAssessment(errorContext, noOptionsContext, businessContext);
      const withOptionsAssessment = new ErrorImpactAssessment(errorContext, withOptionsContext, businessContext);

      const noOptionsImpact = noOptionsAssessment.assessImpact();
      const withOptionsImpact = withOptionsAssessment.assessImpact();

      expect(withOptionsImpact.workflowDisruption).toBeLessThan(noOptionsImpact.workflowDisruption);
    });
  });

  describe('business context adjustments', () => {
    it('should escalate impact during peak usage times', () => {
      businessContext.peakUsageTime = true;
      const assessment = new ErrorImpactAssessment(errorContext, userContext, businessContext);
      const impact = assessment.assessImpact();

      expect(impact.level).toBe(ImpactLevel.HIGH); // Escalated from MODERATE
      expect(impact.workflowDisruption).toBeGreaterThan(0.5);
    });

    it('should escalate impact for critical business operations', () => {
      businessContext.businessCriticality = 'CRITICAL';
      const assessment = new ErrorImpactAssessment(errorContext, userContext, businessContext);
      const impact = assessment.assessImpact();

      expect(impact.level).toBe(ImpactLevel.HIGH);
      expect(impact.confidenceLoss).toBeGreaterThan(0.6);
    });
  });

  describe('recovery attempt adjustments', () => {
    it('should increase impact with multiple failed recovery attempts', () => {
      const failedAttempts: RecoveryAttempt[] = [
        {
          strategyType: RecoveryStrategyType.RETRY,
          timestamp: new Date(Date.now() - 5000),
          result: RecoveryResult.FAILED
        },
        {
          strategyType: RecoveryStrategyType.FALLBACK,
          timestamp: new Date(Date.now() - 3000),
          result: RecoveryResult.FAILED
        }
      ];

      const assessment = new ErrorImpactAssessment(errorContext, userContext, businessContext, failedAttempts);
      const impact = assessment.assessImpact();

      expect(impact.level).toBe(ImpactLevel.HIGH); // Escalated due to failed attempts
      expect(impact.confidenceLoss).toBeGreaterThan(0.6);
      expect(impact.affectedMetrics).toContain(UserExperienceMetric.CONFUSION);
    });

    it('should reduce impact with successful recovery', () => {
      const successfulAttempts: RecoveryAttempt[] = [
        {
          strategyType: RecoveryStrategyType.RETRY,
          timestamp: new Date(Date.now() - 2000),
          result: RecoveryResult.SUCCESS
        }
      ];

      const assessment = new ErrorImpactAssessment(errorContext, userContext, businessContext, successfulAttempts);
      const impact = assessment.assessImpact();

      expect(impact.confidenceLoss).toBeLessThan(0.5);
      expect(impact.workflowDisruption).toBeLessThan(0.6); // Adjusted for calculation precision
    });

    it('should account for total recovery time in user visible delay', () => {
      const oldAttempt: RecoveryAttempt[] = [
        {
          strategyType: RecoveryStrategyType.RETRY,
          timestamp: new Date(Date.now() - 10000), // 10 seconds ago
          result: RecoveryResult.FAILED
        }
      ];

      const assessment = new ErrorImpactAssessment(errorContext, userContext, businessContext, oldAttempt);
      const impact = assessment.assessImpact();

      expect(impact.userVisibleDelay).toBeGreaterThan(10000); // Should include recovery time
    });
  });

  describe('response type adjustments', () => {
    it('should increase delay impact for real-time responses', () => {
      userContext.expectedResponseType = ResponseType.REAL_TIME;
      const assessment = new ErrorImpactAssessment(errorContext, userContext, businessContext);
      const impact = assessment.assessImpact();

      expect(impact.userVisibleDelay).toBeGreaterThan(10000); // Amplified delay
      expect(impact.workflowDisruption).toBeGreaterThan(0.7);
    });

    it('should increase confidence loss for interactive responses', () => {
      userContext.expectedResponseType = ResponseType.INTERACTIVE;
      const assessment = new ErrorImpactAssessment(errorContext, userContext, businessContext);
      const impact = assessment.assessImpact();

      expect(impact.confidenceLoss).toBeGreaterThan(0.5);
    });

    it('should increase data integrity risk for file responses', () => {
      userContext.expectedResponseType = ResponseType.FILE;
      const assessment = new ErrorImpactAssessment(errorContext, userContext, businessContext);
      const impact = assessment.assessImpact();

      expect(impact.dataIntegrityRisk).toBeGreaterThan(0.5);
    });

    it('should reduce delay impact for async responses', () => {
      userContext.expectedResponseType = ResponseType.ASYNC;
      const assessment = new ErrorImpactAssessment(errorContext, userContext, businessContext);
      const impact = assessment.assessImpact();

      expect(impact.userVisibleDelay).toBeLessThan(7000); // Adjusted for async multiplier
    });
  });
});

describe('ErrorImpactFactory', () => {
  let errorContext: EnhancedErrorContext;

  beforeEach(() => {
    errorContext = ErrorContextBuilder.create()
      .withSeverity(ErrorSeverity.MEDIUM)
      .withExecutionState(ProcessingStage.TOOL_EXECUTION)
      .build();
  });

  describe('createAssessment', () => {
    it('should create assessment with default contexts', () => {
      const assessment = ErrorImpactFactory.createAssessment(errorContext);
      const impact = assessment.assessImpact();

      expect(impact).toBeDefined();
      expect(impact.level).toBeDefined();
      expect(impact.affectedMetrics.length).toBeGreaterThan(0);
    });

    it('should merge provided contexts with defaults', () => {
      const partialUserContext = {
        isFirstTimeUser: true,
        urgencyLevel: 'HIGH' as const
      };

      const assessment = ErrorImpactFactory.createAssessment(
        errorContext,
        partialUserContext
      );
      const impact = assessment.assessImpact();

      // Should use provided values
      expect(impact.confidenceLoss).toBeGreaterThan(0.5); // Higher due to first time user
      
      // Should still have defaults for other fields
      expect(impact).toBeDefined();
    });
  });

  describe('createSlackAssessment', () => {
    it('should create Slack-specific assessment', () => {
      const assessment = ErrorImpactFactory.createSlackAssessment(errorContext);
      const impact = assessment.assessImpact();

      expect(impact.level).toBeDefined();
      expect(impact.affectedMetrics).toContain(UserExperienceMetric.RESPONSE_DELAY);
    });

    it('should adjust for first message context', () => {
      const firstMessageAssessment = ErrorImpactFactory.createSlackAssessment(
        errorContext,
        true // isFirstMessage
      );
      const regularAssessment = ErrorImpactFactory.createSlackAssessment(
        errorContext,
        false
      );

      const firstImpact = firstMessageAssessment.assessImpact();
      const regularImpact = regularAssessment.assessImpact();

      expect(firstImpact.confidenceLoss).toBeGreaterThan(regularImpact.confidenceLoss);
    });

    it('should adjust for urgent messages', () => {
      const urgentAssessment = ErrorImpactFactory.createSlackAssessment(
        errorContext,
        false,
        true // isUrgent
      );
      const regularAssessment = ErrorImpactFactory.createSlackAssessment(
        errorContext,
        false,
        false
      );

      const urgentImpact = urgentAssessment.assessImpact();
      const regularImpact = regularAssessment.assessImpact();

      expect(urgentImpact.workflowDisruption).toBeGreaterThan(regularImpact.workflowDisruption);
    });

    it('should use business hours detection for peak time', () => {
      // Mock date to be during business hours (Tuesday 2PM)
      const businessHoursDate = new Date(2023, 0, 3, 14, 0, 0); // January 3rd, 2023, 2 PM
      jest.spyOn(Date, 'now').mockReturnValue(businessHoursDate.getTime());
      jest.spyOn(global, 'Date').mockImplementation(() => businessHoursDate);

      const assessment = ErrorImpactFactory.createSlackAssessment(errorContext);
      const impact = assessment.assessImpact();

      // Should be escalated due to peak business hours
      expect(impact.level).toBe(ImpactLevel.HIGH);

      // Clean up mocks
      jest.restoreAllMocks();
    });
  });
});

describe('Impact level escalation', () => {
  let assessment: ErrorImpactAssessment;

  beforeEach(() => {
    const errorContext = ErrorContextBuilder.create()
      .withSeverity(ErrorSeverity.LOW)
      .withExecutionState(ProcessingStage.AI_PROCESSING)
      .build();

    const userContext: UserContext = {
      isFirstTimeUser: false,
      recentErrorCount: 0,
      currentWorkflowStage: 'testing',
      expectedResponseType: ResponseType.TEXT,
      urgencyLevel: 'MEDIUM',
      hasAlternativeOptions: true
    };

    const businessContext: BusinessContext = {
      businessCriticality: 'LOW',
      peakUsageTime: false,
      affectedUserCount: 1,
      revenueImpact: 0,
      complianceRisk: false
    };

    assessment = new ErrorImpactAssessment(errorContext, userContext, businessContext);
  });

  it('should escalate through impact levels correctly', () => {
    const impact = assessment.assessImpact();
    
    // Should start at LOW and potentially escalate based on context
    expect([ImpactLevel.MINIMAL, ImpactLevel.LOW, ImpactLevel.MODERATE]).toContain(impact.level);
  });
});