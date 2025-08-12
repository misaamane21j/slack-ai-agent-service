/**
 * User Experience Impact Measurement System
 * Tracks error effects on user interactions and measures satisfaction metrics
 */

import { EventEmitter } from 'events';
import { MetricsCollector } from './MetricsCollector';
import { ErrorSeverity, ErrorCategory } from '../errors/types';

export enum UXImpactLevel {
  NONE = 'none',           // No impact on user experience
  MINIMAL = 'minimal',     // Slight delay or minor inconvenience
  MODERATE = 'moderate',   // Noticeable impact, user can continue
  SIGNIFICANT = 'significant', // Major disruption, user experience degraded
  CRITICAL = 'critical'    // User cannot complete task
}

export interface UXMetrics {
  userId: string;
  sessionId: string;
  impactLevel: UXImpactLevel;
  errorCount: number;
  totalInteractions: number;
  successfulInteractions: number;
  avgResponseTime: number;
  satisfactionScore?: number; // 1-5 scale if available
  frustrationIndicators: string[];
  recoveryTime?: number; // Time to complete task after error
  abandonmentRisk: number; // 0-100 percentage
  timestamp: Date;
}

export interface UserInteraction {
  userId: string;
  sessionId: string;
  interactionType: string;
  startTime: Date;
  endTime?: Date;
  success: boolean;
  errorEncountered?: {
    category: ErrorCategory;
    severity: ErrorSeverity;
    message: string;
    recoverable: boolean;
  };
  responseTime?: number;
  userFeedback?: {
    rating?: number; // 1-5 scale
    comment?: string;
  };
  context?: Record<string, any>;
}

export interface ResponseTimeMetrics {
  userId: string;
  p50ResponseTime: number;
  p95ResponseTime: number;
  p99ResponseTime: number;
  avgResponseTime: number;
  slowInteractions: number; // Count of interactions > threshold
  timeoutCount: number;
}

export interface UserSatisfactionMetrics {
  userId: string;
  overallSatisfaction: number; // 1-5 scale
  taskCompletionRate: number; // 0-100%
  errorRecoveryRate: number; // 0-100%
  recommendationScore?: number; // Net Promoter Score style
  lastInteractionTime: Date;
  sessionCount: number;
  avgSessionDuration: number;
}

export interface UXMonitoringConfig {
  slowInteractionThreshold: number; // milliseconds
  criticalResponseTimeThreshold: number; // milliseconds
  abandonmentTimeThreshold: number; // milliseconds
  satisfactionSurveyInterval: number; // interactions
  retentionPeriodDays: number;
}

/**
 * Monitors and measures user experience impact from errors and system performance
 */
export class UserExperienceMonitor extends EventEmitter {
  private userSessions: Map<string, UserInteraction[]> = new Map();
  private userMetrics: Map<string, UXMetrics> = new Map();
  private responseTimes: Map<string, number[]> = new Map();
  private satisfactionData: Map<string, UserSatisfactionMetrics> = new Map();

  constructor(
    private metricsCollector: MetricsCollector,
    private config: UXMonitoringConfig = {
      slowInteractionThreshold: 5000, // 5 seconds
      criticalResponseTimeThreshold: 15000, // 15 seconds
      abandonmentTimeThreshold: 60000, // 1 minute
      satisfactionSurveyInterval: 10, // every 10 interactions
      retentionPeriodDays: 30
    }
  ) {
    super();
    this.startCleanupJob();
  }

  /**
   * Start tracking a user interaction
   */
  startInteraction(interaction: Omit<UserInteraction, 'endTime' | 'success' | 'responseTime'>): void {
    const fullInteraction: UserInteraction = {
      ...interaction,
      success: false // Will be updated when interaction completes
    };

    // Get or create session
    const sessionKey = `${interaction.userId}_${interaction.sessionId}`;
    const sessions = this.userSessions.get(sessionKey) || [];
    sessions.push(fullInteraction);
    this.userSessions.set(sessionKey, sessions);

    this.emit('interaction:started', fullInteraction);
  }

  /**
   * Complete a user interaction and calculate impact
   */
  completeInteraction(
    userId: string,
    sessionId: string,
    interactionType: string,
    result: {
      success: boolean;
      error?: {
        category: ErrorCategory;
        severity: ErrorSeverity;
        message: string;
        recoverable: boolean;
      };
      userFeedback?: {
        rating?: number;
        comment?: string;
      };
      context?: Record<string, any>;
    }
  ): void {
    const sessionKey = `${userId}_${sessionId}`;
    const sessions = this.userSessions.get(sessionKey) || [];
    
    // Find the most recent incomplete interaction of this type
    const interaction = sessions
      .reverse()
      .find(i => 
        i.interactionType === interactionType && 
        !i.endTime
      );

    if (!interaction) {
      throw new Error(`No active interaction found for ${interactionType}`);
    }

    // Complete the interaction
    interaction.endTime = new Date();
    interaction.success = result.success;
    interaction.errorEncountered = result.error;
    interaction.userFeedback = result.userFeedback;
    interaction.responseTime = interaction.endTime.getTime() - interaction.startTime.getTime();

    // Update response times tracking
    this.updateResponseTimes(userId, interaction.responseTime);

    // Calculate and update UX metrics
    this.updateUXMetrics(userId, sessionId, interaction);

    // Record metrics
    this.recordInteractionMetrics(interaction);

    // Check for satisfaction survey trigger
    this.checkSatisfactionSurveyTrigger(userId, sessionId);

    this.emit('interaction:completed', interaction);
  }

  /**
   * Record an error and its impact on user experience
   */
  recordErrorImpact(
    userId: string,
    sessionId: string,
    error: {
      category: ErrorCategory;
      severity: ErrorSeverity;
      message: string;
      recoverable: boolean;
      userMessage: string;
    }
  ): void {
    const impactLevel = this.calculateErrorImpact(error);
    
    // Update user metrics
    const userMetrics = this.getUserMetrics(userId, sessionId);
    userMetrics.errorCount++;
    userMetrics.impactLevel = this.aggregateImpactLevel(userMetrics.impactLevel, impactLevel);
    
    // Add frustration indicators based on error
    this.addFrustrationIndicators(userMetrics, error);

    // Calculate abandonment risk
    userMetrics.abandonmentRisk = this.calculateAbandonmentRisk(userMetrics);

    this.userMetrics.set(userId, userMetrics);

    // Record metrics
    this.metricsCollector.recordUserExperience({
      userId,
      interaction: 'error_impact',
      satisfaction: this.convertImpactToSatisfaction(impactLevel),
      errorEncountered: true,
      context: {
        error_category: error.category,
        error_severity: error.severity,
        impact_level: impactLevel,
        abandonment_risk: userMetrics.abandonmentRisk
      }
    });

    this.emit('error:impact_recorded', {
      userId,
      sessionId,
      error,
      impactLevel,
      userMetrics
    });
  }

  /**
   * Record user satisfaction feedback
   */
  recordSatisfactionFeedback(
    userId: string,
    feedback: {
      rating: number; // 1-5 scale
      comment?: string;
      recommendationScore?: number;
      taskCompleted: boolean;
    }
  ): void {
    // Update satisfaction metrics
    const satisfaction = this.satisfactionData.get(userId) || this.createInitialSatisfactionMetrics(userId);
    
    satisfaction.overallSatisfaction = this.calculateWeightedSatisfaction(
      satisfaction.overallSatisfaction,
      feedback.rating,
      satisfaction.sessionCount
    );
    
    if (feedback.recommendationScore !== undefined) {
      satisfaction.recommendationScore = feedback.recommendationScore;
    }

    satisfaction.lastInteractionTime = new Date();
    this.satisfactionData.set(userId, satisfaction);

    // Record metrics
    this.metricsCollector.recordUserExperience({
      userId,
      interaction: 'satisfaction_feedback',
      satisfaction: feedback.rating,
      context: {
        task_completed: feedback.taskCompleted,
        recommendation_score: feedback.recommendationScore,
        comment: feedback.comment
      }
    });

    this.emit('satisfaction:recorded', { userId, feedback, satisfaction });
  }

  /**
   * Get UX metrics for a specific user
   */
  getUserUXMetrics(userId: string): UXMetrics | undefined {
    return this.userMetrics.get(userId);
  }

  /**
   * Get satisfaction metrics for a specific user
   */
  getUserSatisfactionMetrics(userId: string): UserSatisfactionMetrics | undefined {
    return this.satisfactionData.get(userId);
  }

  /**
   * Get response time metrics for a specific user
   */
  getUserResponseTimeMetrics(userId: string): ResponseTimeMetrics | undefined {
    const responseTimes = this.responseTimes.get(userId);
    if (!responseTimes || responseTimes.length === 0) {
      return undefined;
    }

    const sortedTimes = [...responseTimes].sort((a, b) => a - b);
    const p50Index = Math.floor(sortedTimes.length * 0.5);
    const p95Index = Math.floor(sortedTimes.length * 0.95);
    const p99Index = Math.floor(sortedTimes.length * 0.99);

    const avgResponseTime = responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length;
    const slowInteractions = responseTimes.filter(time => time > this.config.slowInteractionThreshold).length;
    const timeoutCount = responseTimes.filter(time => time > this.config.criticalResponseTimeThreshold).length;

    return {
      userId,
      p50ResponseTime: sortedTimes[p50Index] || 0,
      p95ResponseTime: sortedTimes[p95Index] || 0,
      p99ResponseTime: sortedTimes[p99Index] || 0,
      avgResponseTime,
      slowInteractions,
      timeoutCount
    };
  }

  /**
   * Get overall UX summary
   */
  getUXSummary(): {
    totalUsers: number;
    activeUsers: number;
    avgSatisfactionScore: number;
    avgResponseTime: number;
    errorImpactDistribution: Record<UXImpactLevel, number>;
    highRiskUsers: number;
    taskCompletionRate: number;
  } {
    const allMetrics = Array.from(this.userMetrics.values());
    const allSatisfaction = Array.from(this.satisfactionData.values());
    const allResponseTimes = Array.from(this.responseTimes.values()).flat();

    const totalUsers = allMetrics.length;
    const activeUsers = allMetrics.filter(m => {
      const timeDiff = Date.now() - m.timestamp.getTime();
      return timeDiff < 24 * 60 * 60 * 1000; // Active in last 24 hours
    }).length;

    const avgSatisfactionScore = allSatisfaction.length > 0
      ? allSatisfaction.reduce((sum, s) => sum + s.overallSatisfaction, 0) / allSatisfaction.length
      : 0;

    const avgResponseTime = allResponseTimes.length > 0
      ? allResponseTimes.reduce((sum, time) => sum + time, 0) / allResponseTimes.length
      : 0;

    const errorImpactDistribution = allMetrics.reduce((acc, metrics) => {
      acc[metrics.impactLevel] = (acc[metrics.impactLevel] || 0) + 1;
      return acc;
    }, {} as Record<UXImpactLevel, number>);

    const highRiskUsers = allMetrics.filter(m => m.abandonmentRisk > 70).length;

    const taskCompletionRate = allSatisfaction.length > 0
      ? allSatisfaction.reduce((sum, s) => sum + s.taskCompletionRate, 0) / allSatisfaction.length
      : 0;

    return {
      totalUsers,
      activeUsers,
      avgSatisfactionScore: Math.round(avgSatisfactionScore * 100) / 100,
      avgResponseTime: Math.round(avgResponseTime),
      errorImpactDistribution,
      highRiskUsers,
      taskCompletionRate: Math.round(taskCompletionRate * 100) / 100
    };
  }

  /**
   * Get users at high risk of abandonment
   */
  getHighRiskUsers(): Array<{ userId: string; metrics: UXMetrics; riskFactors: string[] }> {
    return Array.from(this.userMetrics.entries())
      .filter(([, metrics]) => metrics.abandonmentRisk > 70)
      .map(([userId, metrics]) => ({
        userId,
        metrics,
        riskFactors: this.identifyRiskFactors(metrics)
      }));
  }

  private getUserMetrics(userId: string, sessionId: string): UXMetrics {
    let metrics = this.userMetrics.get(userId);
    
    if (!metrics) {
      metrics = {
        userId,
        sessionId,
        impactLevel: UXImpactLevel.NONE,
        errorCount: 0,
        totalInteractions: 0,
        successfulInteractions: 0,
        avgResponseTime: 0,
        frustrationIndicators: [],
        abandonmentRisk: 0,
        timestamp: new Date()
      };
      this.userMetrics.set(userId, metrics);
    }

    return metrics;
  }

  private updateUXMetrics(userId: string, sessionId: string, interaction: UserInteraction): void {
    const metrics = this.getUserMetrics(userId, sessionId);
    
    metrics.totalInteractions++;
    if (interaction.success) {
      metrics.successfulInteractions++;
    }

    // Update average response time
    if (interaction.responseTime) {
      const totalTime = metrics.avgResponseTime * (metrics.totalInteractions - 1);
      metrics.avgResponseTime = (totalTime + interaction.responseTime) / metrics.totalInteractions;
    }

    // Update satisfaction score if feedback provided
    if (interaction.userFeedback?.rating) {
      metrics.satisfactionScore = interaction.userFeedback.rating;
    }

    // Check for slow response frustration
    if (interaction.responseTime && interaction.responseTime > this.config.slowInteractionThreshold) {
      if (!metrics.frustrationIndicators.includes('slow_response')) {
        metrics.frustrationIndicators.push('slow_response');
      }
    }

    metrics.timestamp = new Date();
    this.userMetrics.set(userId, metrics);
  }

  private calculateErrorImpact(error: {
    category: ErrorCategory;
    severity: ErrorSeverity;
    recoverable: boolean;
  }): UXImpactLevel {
    // Base impact on severity
    let impactLevel: UXImpactLevel;
    
    switch (error.severity) {
      case ErrorSeverity.LOW:
        impactLevel = UXImpactLevel.MINIMAL;
        break;
      case ErrorSeverity.MEDIUM:
        impactLevel = UXImpactLevel.MODERATE;
        break;
      case ErrorSeverity.HIGH:
        impactLevel = UXImpactLevel.SIGNIFICANT;
        break;
      case ErrorSeverity.CRITICAL:
        impactLevel = UXImpactLevel.CRITICAL;
        break;
      default:
        impactLevel = UXImpactLevel.MODERATE;
    }

    // Adjust based on recoverability
    if (!error.recoverable && impactLevel !== UXImpactLevel.CRITICAL) {
      impactLevel = UXImpactLevel.SIGNIFICANT;
    }

    // Adjust based on error category - check for authentication/authorization errors
    const categoryStr = error.category.toString().toUpperCase();
    if (categoryStr.includes('AUTHENTICATION') || categoryStr.includes('AUTHORIZATION')) {
      impactLevel = UXImpactLevel.CRITICAL;
    }

    return impactLevel;
  }

  private aggregateImpactLevel(current: UXImpactLevel, new_: UXImpactLevel): UXImpactLevel {
    const levels = [
      UXImpactLevel.NONE,
      UXImpactLevel.MINIMAL,
      UXImpactLevel.MODERATE,
      UXImpactLevel.SIGNIFICANT,
      UXImpactLevel.CRITICAL
    ];

    const currentIndex = levels.indexOf(current);
    const newIndex = levels.indexOf(new_);
    
    return levels[Math.max(currentIndex, newIndex)];
  }

  private addFrustrationIndicators(metrics: UXMetrics, error: any): void {
    if (error.severity === ErrorSeverity.CRITICAL && !metrics.frustrationIndicators.includes('critical_error')) {
      metrics.frustrationIndicators.push('critical_error');
    }

    if (!error.recoverable && !metrics.frustrationIndicators.includes('unrecoverable_error')) {
      metrics.frustrationIndicators.push('unrecoverable_error');
    }

    if (metrics.errorCount > 3 && !metrics.frustrationIndicators.includes('repeated_errors')) {
      metrics.frustrationIndicators.push('repeated_errors');
    }
  }

  private calculateAbandonmentRisk(metrics: UXMetrics): number {
    let risk = 0;

    // Base risk on error count
    risk += Math.min(metrics.errorCount * 10, 40);

    // Risk based on impact level
    switch (metrics.impactLevel) {
      case UXImpactLevel.CRITICAL: risk += 30; break;
      case UXImpactLevel.SIGNIFICANT: risk += 20; break;
      case UXImpactLevel.MODERATE: risk += 10; break;
      case UXImpactLevel.MINIMAL: risk += 5; break;
    }

    // Risk based on frustration indicators
    risk += metrics.frustrationIndicators.length * 5;

    // Risk based on satisfaction
    if (metrics.satisfactionScore && metrics.satisfactionScore <= 2) {
      risk += 20;
    }

    // Risk based on success rate
    const successRate = metrics.totalInteractions > 0 
      ? metrics.successfulInteractions / metrics.totalInteractions 
      : 1;
    risk += (1 - successRate) * 30;

    return Math.min(Math.max(risk, 0), 100);
  }

  private convertImpactToSatisfaction(impact: UXImpactLevel): number {
    switch (impact) {
      case UXImpactLevel.NONE: return 5;
      case UXImpactLevel.MINIMAL: return 4;
      case UXImpactLevel.MODERATE: return 3;
      case UXImpactLevel.SIGNIFICANT: return 2;
      case UXImpactLevel.CRITICAL: return 1;
      default: return 3;
    }
  }

  private updateResponseTimes(userId: string, responseTime: number): void {
    const times = this.responseTimes.get(userId) || [];
    times.push(responseTime);

    // Keep only last 100 response times per user
    if (times.length > 100) {
      times.shift();
    }

    this.responseTimes.set(userId, times);
  }

  private recordInteractionMetrics(interaction: UserInteraction): void {
    this.metricsCollector.recordUserExperience({
      userId: interaction.userId,
      interaction: interaction.interactionType,
      satisfaction: interaction.userFeedback?.rating,
      responseTime: interaction.responseTime,
      errorEncountered: !!interaction.errorEncountered,
      context: {
        session_id: interaction.sessionId,
        success: interaction.success,
        error_category: interaction.errorEncountered?.category,
        error_severity: interaction.errorEncountered?.severity
      }
    });
  }

  private checkSatisfactionSurveyTrigger(userId: string, sessionId: string): void {
    const sessionKey = `${userId}_${sessionId}`;
    const sessions = this.userSessions.get(sessionKey) || [];
    const completedInteractions = sessions.filter(i => i.endTime).length;

    if (completedInteractions > 0 && completedInteractions % this.config.satisfactionSurveyInterval === 0) {
      this.emit('satisfaction:survey_trigger', { userId, sessionId, interactionCount: completedInteractions });
    }
  }

  private createInitialSatisfactionMetrics(userId: string): UserSatisfactionMetrics {
    return {
      userId,
      overallSatisfaction: 3, // Neutral starting point
      taskCompletionRate: 0,
      errorRecoveryRate: 0,
      lastInteractionTime: new Date(),
      sessionCount: 0,
      avgSessionDuration: 0
    };
  }

  private calculateWeightedSatisfaction(current: number, newRating: number, sessionCount: number): number {
    if (sessionCount === 0) return newRating;
    return (current * sessionCount + newRating) / (sessionCount + 1);
  }

  private identifyRiskFactors(metrics: UXMetrics): string[] {
    const factors: string[] = [];
    
    if (metrics.errorCount > 5) factors.push('High error count');
    if (metrics.impactLevel === UXImpactLevel.CRITICAL) factors.push('Critical impact level');
    if (metrics.avgResponseTime > this.config.slowInteractionThreshold) factors.push('Slow response times');
    if (metrics.satisfactionScore && metrics.satisfactionScore <= 2) factors.push('Low satisfaction score');
    if (metrics.frustrationIndicators.includes('repeated_errors')) factors.push('Repeated errors');
    if (metrics.successfulInteractions / metrics.totalInteractions < 0.5) factors.push('Low success rate');

    return factors;
  }

  private startCleanupJob(): void {
    // Clean up old data every 24 hours
    setInterval(() => {
      this.cleanup();
    }, 24 * 60 * 60 * 1000);
  }

  private cleanup(): void {
    const cutoff = new Date(Date.now() - (this.config.retentionPeriodDays * 24 * 60 * 60 * 1000));
    let cleanedCount = 0;

    // Clean up old user metrics
    Array.from(this.userMetrics.entries()).forEach(([userId, metrics]) => {
      if (metrics.timestamp < cutoff) {
        this.userMetrics.delete(userId);
        this.responseTimes.delete(userId);
        cleanedCount++;
      }
    });

    // Clean up old sessions
    Array.from(this.userSessions.entries()).forEach(([sessionKey, sessions]) => {
      const validSessions = sessions.filter(s => s.startTime >= cutoff);
      if (validSessions.length === 0) {
        this.userSessions.delete(sessionKey);
      } else if (validSessions.length !== sessions.length) {
        this.userSessions.set(sessionKey, validSessions);
      }
    });

    if (cleanedCount > 0) {
      this.emit('ux:cleanup_completed', { cleanedUsers: cleanedCount });
    }
  }
}