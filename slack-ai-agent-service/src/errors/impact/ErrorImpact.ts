/**
 * ErrorImpact assessment system for evaluating the user experience effects of errors
 */

import { EnhancedErrorContext, ProcessingStage, OperationPhase } from '../context/ErrorContext';
import { ErrorSeverity } from '../types';
import { RecoveryResult, RecoveryAttempt } from '../recovery/RecoveryStrategy';

export enum ImpactLevel {
  MINIMAL = 'MINIMAL',           // User barely notices
  LOW = 'LOW',                   // Minor inconvenience
  MODERATE = 'MODERATE',         // Noticeable disruption
  HIGH = 'HIGH',                 // Significant frustration
  CRITICAL = 'CRITICAL'          // Complete failure of user intent
}

export enum UserExperienceMetric {
  RESPONSE_DELAY = 'RESPONSE_DELAY',
  FEATURE_UNAVAILABILITY = 'FEATURE_UNAVAILABILITY',
  DATA_LOSS = 'DATA_LOSS',
  CONFUSION = 'CONFUSION',
  WORKFLOW_INTERRUPTION = 'WORKFLOW_INTERRUPTION',
  TRUST_DEGRADATION = 'TRUST_DEGRADATION'
}

export enum ResponseType {
  TEXT = 'TEXT',                 // Simple text response
  INTERACTIVE = 'INTERACTIVE',   // Buttons, forms, etc.
  FILE = 'FILE',                 // File uploads/downloads
  REAL_TIME = 'REAL_TIME',       // Live updates, streaming
  ASYNC = 'ASYNC'                // Background processing
}

export interface ImpactMetrics {
  level: ImpactLevel;
  affectedMetrics: UserExperienceMetric[];
  estimatedRecoveryTime: number;
  userVisibleDelay: number;
  confidenceLoss: number;        // 0-1 scale
  workflowDisruption: number;    // 0-1 scale
  dataIntegrityRisk: number;     // 0-1 scale
}

export interface UserContext {
  isFirstTimeUser: boolean;
  recentErrorCount: number;
  currentWorkflowStage: string;
  expectedResponseType: ResponseType;
  urgencyLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  hasAlternativeOptions: boolean;
}

export interface BusinessContext {
  businessCriticality: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  peakUsageTime: boolean;
  affectedUserCount: number;
  revenueImpact: number;
  complianceRisk: boolean;
}

/**
 * Core error impact assessment system
 */
export class ErrorImpactAssessment {
  private errorContext: EnhancedErrorContext;
  private userContext: UserContext;
  private businessContext: BusinessContext;
  private recoveryAttempts: RecoveryAttempt[];

  constructor(
    errorContext: EnhancedErrorContext,
    userContext: UserContext,
    businessContext: BusinessContext,
    recoveryAttempts: RecoveryAttempt[] = []
  ) {
    this.errorContext = errorContext;
    this.userContext = userContext;
    this.businessContext = businessContext;
    this.recoveryAttempts = recoveryAttempts;
  }

  /**
   * Assess the overall impact of the error
   */
  assessImpact(): ImpactMetrics {
    const baseImpact = this.calculateBaseImpact();
    const contextualAdjustments = this.applyContextualAdjustments(baseImpact);
    const recoveryAdjustments = this.applyRecoveryAdjustments(contextualAdjustments);
    
    return recoveryAdjustments;
  }

  /**
   * Calculate base impact from error severity and operation phase
   */
  private calculateBaseImpact(): ImpactMetrics {
    const severity = this.errorContext.severity;
    const operation = this.errorContext.operation;
    const stage = this.errorContext.executionState.processingStage;

    // Base impact level from severity
    let impactLevel: ImpactLevel;
    let baseDelay: number;
    let baseConfidenceLoss: number;

    switch (severity) {
      case ErrorSeverity.CRITICAL:
        impactLevel = ImpactLevel.CRITICAL;
        baseDelay = 30000; // 30 seconds
        baseConfidenceLoss = 0.8;
        break;
      case ErrorSeverity.HIGH:
        impactLevel = ImpactLevel.HIGH;
        baseDelay = 15000; // 15 seconds
        baseConfidenceLoss = 0.6;
        break;
      case ErrorSeverity.MEDIUM:
        impactLevel = ImpactLevel.MODERATE;
        baseDelay = 8000; // 8 seconds
        baseConfidenceLoss = 0.4;
        break;
      case ErrorSeverity.LOW:
        impactLevel = ImpactLevel.LOW;
        baseDelay = 3000; // 3 seconds
        baseConfidenceLoss = 0.2;
        break;
      default:
        impactLevel = ImpactLevel.MINIMAL;
        baseDelay = 1000;
        baseConfidenceLoss = 0.1;
    }

    // Adjust based on processing stage
    const stageMultiplier = this.getStageMultiplier(stage);
    const phaseMultiplier = operation ? this.getPhaseMultiplier(operation.phase) : 1;

    // Calculate affected metrics based on failure point
    const affectedMetrics = this.determineAffectedMetrics(stage, operation?.phase);

    return {
      level: impactLevel,
      affectedMetrics,
      estimatedRecoveryTime: baseDelay * stageMultiplier * phaseMultiplier,
      userVisibleDelay: baseDelay * stageMultiplier,
      confidenceLoss: Math.min(baseConfidenceLoss * stageMultiplier, 1),
      workflowDisruption: this.calculateWorkflowDisruption(stage, operation?.phase),
      dataIntegrityRisk: this.calculateDataIntegrityRisk(stage, severity)
    };
  }

  /**
   * Apply contextual adjustments based on user and business context
   */
  private applyContextualAdjustments(baseImpact: ImpactMetrics): ImpactMetrics {
    let adjustedImpact = { ...baseImpact };

    // User context adjustments
    if (this.userContext.isFirstTimeUser) {
      adjustedImpact.confidenceLoss *= 1.5;
      adjustedImpact.affectedMetrics.push(UserExperienceMetric.TRUST_DEGRADATION);
    }

    if (this.userContext.recentErrorCount > 2) {
      adjustedImpact.confidenceLoss *= 1.3;
      adjustedImpact.workflowDisruption *= 1.2;
    }

    // Urgency adjustments
    const urgencyMultiplier = {
      'LOW': 0.8,
      'MEDIUM': 1.0,
      'HIGH': 1.3,
      'CRITICAL': 1.8
    }[this.userContext.urgencyLevel];

    adjustedImpact.userVisibleDelay *= urgencyMultiplier;
    adjustedImpact.workflowDisruption *= urgencyMultiplier;

    // Response type adjustments
    adjustedImpact = this.adjustForResponseType(adjustedImpact);

    // Business context adjustments
    if (this.businessContext.peakUsageTime) {
      adjustedImpact.level = this.escalateImpactLevel(adjustedImpact.level);
      adjustedImpact.workflowDisruption *= 1.4;
    }

    if (this.businessContext.businessCriticality === 'CRITICAL') {
      adjustedImpact.level = this.escalateImpactLevel(adjustedImpact.level);
      adjustedImpact.confidenceLoss *= 1.5;
    }

    return adjustedImpact;
  }

  /**
   * Apply adjustments based on recovery attempts
   */
  private applyRecoveryAdjustments(impact: ImpactMetrics): ImpactMetrics {
    let adjustedImpact = { ...impact };

    if (this.recoveryAttempts.length === 0) {
      return adjustedImpact;
    }

    // Calculate recovery effectiveness
    const successfulAttempts = this.recoveryAttempts.filter(a => a.result === RecoveryResult.SUCCESS);
    const failedAttempts = this.recoveryAttempts.filter(a => a.result === RecoveryResult.FAILED);

    // If recovery attempts are taking too long, increase perceived delay
    const totalRecoveryTime = this.recoveryAttempts.reduce((total, attempt) => {
      return total + (Date.now() - attempt.timestamp.getTime());
    }, 0);

    adjustedImpact.userVisibleDelay += totalRecoveryTime;

    // Multiple failed attempts increase frustration
    if (failedAttempts.length > 1) {
      adjustedImpact.confidenceLoss = Math.min(adjustedImpact.confidenceLoss * 1.5, 1);
      adjustedImpact.level = this.escalateImpactLevel(adjustedImpact.level);
      
      if (!adjustedImpact.affectedMetrics.includes(UserExperienceMetric.CONFUSION)) {
        adjustedImpact.affectedMetrics.push(UserExperienceMetric.CONFUSION);
      }
    }

    // Successful recovery reduces impact
    if (successfulAttempts.length > 0) {
      adjustedImpact.confidenceLoss *= 0.7;
      adjustedImpact.workflowDisruption *= 0.8;
    }

    return adjustedImpact;
  }

  /**
   * Get multiplier based on processing stage
   */
  private getStageMultiplier(stage: ProcessingStage): number {
    const multipliers = {
      [ProcessingStage.REQUEST_RECEIVED]: 0.5,
      [ProcessingStage.CONTEXT_GATHERING]: 0.7,
      [ProcessingStage.AI_PROCESSING]: 1.2,
      [ProcessingStage.TOOL_EXECUTION]: 1.5,
      [ProcessingStage.RESULT_VALIDATION]: 1.0,
      [ProcessingStage.RESPONSE_GENERATION]: 0.8,
      [ProcessingStage.DELIVERY]: 1.3,
      [ProcessingStage.COMPLETED]: 0.1,
      [ProcessingStage.FAILED]: 1.8
    };

    return multipliers[stage] || 1.0;
  }

  /**
   * Get multiplier based on operation phase
   */
  private getPhaseMultiplier(phase: OperationPhase): number {
    const multipliers = {
      [OperationPhase.INITIALIZATION]: 0.3,
      [OperationPhase.VALIDATION]: 0.5,
      [OperationPhase.TOOL_DISCOVERY]: 0.8,
      [OperationPhase.TOOL_SELECTION]: 0.9,
      [OperationPhase.TOOL_INVOCATION]: 1.5,
      [OperationPhase.RESULT_PROCESSING]: 1.2,
      [OperationPhase.RESPONSE_FORMATTING]: 0.7,
      [OperationPhase.CLEANUP]: 0.2
    };

    return multipliers[phase] || 1.0;
  }

  /**
   * Determine which UX metrics are affected based on failure point
   */
  private determineAffectedMetrics(stage: ProcessingStage, phase?: OperationPhase): UserExperienceMetric[] {
    const metrics: UserExperienceMetric[] = [];

    // Always affected by delays
    metrics.push(UserExperienceMetric.RESPONSE_DELAY);

    // Stage-specific impacts
    switch (stage) {
      case ProcessingStage.TOOL_EXECUTION:
        metrics.push(UserExperienceMetric.FEATURE_UNAVAILABILITY);
        if (phase === OperationPhase.TOOL_INVOCATION) {
          metrics.push(UserExperienceMetric.WORKFLOW_INTERRUPTION);
        }
        break;
      case ProcessingStage.RESULT_VALIDATION:
        metrics.push(UserExperienceMetric.DATA_LOSS);
        break;
      case ProcessingStage.RESPONSE_GENERATION:
        metrics.push(UserExperienceMetric.CONFUSION);
        break;
      case ProcessingStage.FAILED:
        metrics.push(
          UserExperienceMetric.FEATURE_UNAVAILABILITY,
          UserExperienceMetric.WORKFLOW_INTERRUPTION,
          UserExperienceMetric.TRUST_DEGRADATION
        );
        break;
    }

    return [...new Set(metrics)]; // Remove duplicates
  }

  /**
   * Calculate workflow disruption score
   */
  private calculateWorkflowDisruption(stage: ProcessingStage, phase?: OperationPhase): number {
    let baseScore = 0.3;

    // High disruption stages
    if (stage === ProcessingStage.TOOL_EXECUTION || stage === ProcessingStage.FAILED) {
      baseScore = 0.8;
    } else if (stage === ProcessingStage.AI_PROCESSING) {
      baseScore = 0.6;
    }

    // Phase adjustments
    if (phase === OperationPhase.TOOL_INVOCATION) {
      baseScore *= 1.3;
    } else if (phase === OperationPhase.CLEANUP) {
      baseScore *= 0.5;
    }

    // User context adjustments
    if (this.userContext.hasAlternativeOptions) {
      baseScore *= 0.7;
    }

    return Math.min(baseScore, 1.0);
  }

  /**
   * Calculate data integrity risk
   */
  private calculateDataIntegrityRisk(stage: ProcessingStage, severity: ErrorSeverity): number {
    let baseRisk = 0.1;

    // High-risk stages
    if (stage === ProcessingStage.TOOL_EXECUTION || stage === ProcessingStage.RESULT_VALIDATION) {
      baseRisk = 0.6;
    } else if (stage === ProcessingStage.RESPONSE_GENERATION) {
      baseRisk = 0.3;
    }

    // Severity adjustments
    const severityMultiplier = {
      [ErrorSeverity.CRITICAL]: 1.8,
      [ErrorSeverity.HIGH]: 1.4,
      [ErrorSeverity.MEDIUM]: 1.0,
      [ErrorSeverity.LOW]: 0.6
    }[severity];

    return Math.min(baseRisk * severityMultiplier, 1.0);
  }

  /**
   * Adjust impact based on expected response type
   */
  private adjustForResponseType(impact: ImpactMetrics): ImpactMetrics {
    const adjustedImpact = { ...impact };

    switch (this.userContext.expectedResponseType) {
      case ResponseType.REAL_TIME:
        adjustedImpact.userVisibleDelay *= 2.0;
        adjustedImpact.workflowDisruption *= 1.5;
        break;
      case ResponseType.INTERACTIVE:
        adjustedImpact.confidenceLoss *= 1.3;
        break;
      case ResponseType.FILE:
        adjustedImpact.dataIntegrityRisk *= 1.4;
        break;
      case ResponseType.ASYNC:
        adjustedImpact.userVisibleDelay *= 0.5;
        break;
    }

    return adjustedImpact;
  }

  /**
   * Escalate impact level to next severity
   */
  private escalateImpactLevel(currentLevel: ImpactLevel): ImpactLevel {
    const escalationMap = {
      [ImpactLevel.MINIMAL]: ImpactLevel.LOW,
      [ImpactLevel.LOW]: ImpactLevel.MODERATE,
      [ImpactLevel.MODERATE]: ImpactLevel.HIGH,
      [ImpactLevel.HIGH]: ImpactLevel.CRITICAL,
      [ImpactLevel.CRITICAL]: ImpactLevel.CRITICAL // Can't escalate further
    };

    return escalationMap[currentLevel];
  }
}

/**
 * Factory class for creating error impact assessments
 */
export class ErrorImpactFactory {
  /**
   * Create impact assessment with sensible defaults
   */
  static createAssessment(
    errorContext: EnhancedErrorContext,
    userContext?: Partial<UserContext>,
    businessContext?: Partial<BusinessContext>,
    recoveryAttempts?: RecoveryAttempt[]
  ): ErrorImpactAssessment {
    const defaultUserContext: UserContext = {
      isFirstTimeUser: false,
      recentErrorCount: 0,
      currentWorkflowStage: 'unknown',
      expectedResponseType: ResponseType.TEXT,
      urgencyLevel: 'MEDIUM',
      hasAlternativeOptions: true,
      ...userContext
    };

    const defaultBusinessContext: BusinessContext = {
      businessCriticality: 'MEDIUM',
      peakUsageTime: false,
      affectedUserCount: 1,
      revenueImpact: 0,
      complianceRisk: false,
      ...businessContext
    };

    return new ErrorImpactAssessment(
      errorContext,
      defaultUserContext,
      defaultBusinessContext,
      recoveryAttempts || []
    );
  }

  /**
   * Create assessment for Slack context
   */
  static createSlackAssessment(
    errorContext: EnhancedErrorContext,
    isFirstMessage: boolean = false,
    isUrgent: boolean = false,
    recoveryAttempts?: RecoveryAttempt[]
  ): ErrorImpactAssessment {
    const userContext: UserContext = {
      isFirstTimeUser: isFirstMessage,
      recentErrorCount: 0, // Could be enhanced with actual tracking
      currentWorkflowStage: 'slack_interaction',
      expectedResponseType: ResponseType.TEXT,
      urgencyLevel: isUrgent ? 'HIGH' : 'MEDIUM',
      hasAlternativeOptions: true // Users can always try rephrasing or different commands
    };

    const businessContext: BusinessContext = {
      businessCriticality: 'HIGH', // Slack bots are often business-critical
      peakUsageTime: this.isBusinessHours(),
      affectedUserCount: 1,
      revenueImpact: 0,
      complianceRisk: false
    };

    return new ErrorImpactAssessment(errorContext, userContext, businessContext, recoveryAttempts);
  }

  private static isBusinessHours(): boolean {
    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay();
    
    // Weekday between 9 AM and 5 PM
    return day >= 1 && day <= 5 && hour >= 9 && hour <= 17;
  }
}