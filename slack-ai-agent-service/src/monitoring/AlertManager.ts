/**
 * Alert Management System
 * Handles alert thresholds, escalation policies, and notifications for critical failures
 */

import { EventEmitter } from 'events';
import { MetricsCollector } from './MetricsCollector';
import { ErrorSeverity, ErrorCategory } from '../errors/types';

export enum AlertSeverity {
  INFO = 'info',
  WARNING = 'warning',
  CRITICAL = 'critical',
  EMERGENCY = 'emergency'
}

export enum AlertType {
  ERROR_RATE = 'error_rate',
  RESPONSE_TIME = 'response_time',
  RESOURCE_USAGE = 'resource_usage',
  MCP_SERVER_DOWN = 'mcp_server_down',
  USER_IMPACT = 'user_impact',
  PERFORMANCE_DEGRADATION = 'performance_degradation',
  SYSTEM_FAILURE = 'system_failure'
}

export interface Alert {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  description: string;
  timestamp: Date;
  source: string;
  metrics: Record<string, number>;
  tags: Record<string, string>;
  status: 'active' | 'acknowledged' | 'resolved';
  acknowledgedBy?: string;
  acknowledgedAt?: Date;
  resolvedAt?: Date;
  escalationLevel: number;
  escalatedAt?: Date;
  suppressUntil?: Date;
}

export interface AlertRule {
  id: string;
  name: string;
  type: AlertType;
  enabled: boolean;
  condition: {
    metric: string;
    operator: '>' | '<' | '>=' | '<=' | '==' | '!=';
    threshold: number;
    timeWindow: number; // minutes
    evaluationInterval: number; // seconds
  };
  severity: AlertSeverity;
  escalationPolicy?: string;
  suppressionRules?: {
    duration: number; // minutes
    maxAlertsPerWindow: number;
  };
  tags?: Record<string, string>;
  notificationChannels: string[];
}

export interface AlertThreshold {
  metric: string;
  warning: number;
  critical: number;
  emergency?: number;
  timeWindow: number; // minutes
  minDataPoints: number;
}

export interface EscalationPolicy {
  id: string;
  name: string;
  steps: EscalationStep[];
  repeatInterval?: number; // minutes
  maxEscalations?: number;
}

export interface EscalationStep {
  level: number;
  delay: number; // minutes
  channels: NotificationChannel[];
  condition?: {
    alertAge: number; // minutes
    unacknowledged: boolean;
  };
}

export interface NotificationChannel {
  type: 'slack' | 'email' | 'webhook' | 'pagerduty';
  config: Record<string, any>;
  enabled: boolean;
}

export interface AlertStatistics {
  total: number;
  active: number;
  acknowledged: number;
  resolved: number;
  bySeverity: Record<AlertSeverity, number>;
  byType: Record<AlertType, number>;
  averageResolutionTime: number; // minutes
  escalationRate: number; // percentage
}

/**
 * Manages alerts, escalation policies, and notifications
 */
export class AlertManager extends EventEmitter {
  private alerts: Map<string, Alert> = new Map();
  private alertRules: Map<string, AlertRule> = new Map();
  private escalationPolicies: Map<string, EscalationPolicy> = new Map();
  private thresholds: Map<string, AlertThreshold> = new Map();
  private evaluationTimers: Map<string, NodeJS.Timeout> = new Map();
  private escalationTimers: Map<string, NodeJS.Timeout> = new Map();
  private alertHistory: Alert[] = [];

  constructor(
    private metricsCollector: MetricsCollector,
    private config: {
      historyRetentionDays: number;
      maxActiveAlerts: number;
      defaultEscalationDelay: number; // minutes
    } = {
      historyRetentionDays: 30,
      maxActiveAlerts: 1000,
      defaultEscalationDelay: 15
    }
  ) {
    super();
    this.setupDefaultRules();
    this.startCleanupJob();
  }

  /**
   * Create a new alert
   */
  createAlert(alert: Omit<Alert, 'id' | 'timestamp' | 'status' | 'escalationLevel'>): Alert {
    const fullAlert: Alert = {
      ...alert,
      id: this.generateAlertId(),
      timestamp: new Date(),
      status: 'active',
      escalationLevel: 0
    };

    // Check for existing similar alerts (deduplication)
    const existingAlert = this.findSimilarAlert(fullAlert);
    if (existingAlert) {
      this.updateAlertMetrics(existingAlert, fullAlert.metrics);
      return existingAlert;
    }

    // Check alert limits
    if (this.getActiveAlerts().length >= this.config.maxActiveAlerts) {
      throw new Error('Maximum number of active alerts reached');
    }

    this.alerts.set(fullAlert.id, fullAlert);
    this.alertHistory.push({ ...fullAlert });

    // Start escalation timer if escalation policy exists
    const rule = this.getAlertRule(fullAlert.type);
    if (rule?.escalationPolicy) {
      this.startEscalationTimer(fullAlert.id, rule.escalationPolicy);
    }

    // Emit events
    this.emit('alert:created', fullAlert);
    this.notifyChannels(fullAlert);

    return fullAlert;
  }

  /**
   * Acknowledge an alert
   */
  acknowledgeAlert(alertId: string, acknowledgedBy: string): boolean {
    const alert = this.alerts.get(alertId);
    if (!alert || alert.status !== 'active') {
      return false;
    }

    alert.status = 'acknowledged';
    alert.acknowledgedBy = acknowledgedBy;
    alert.acknowledgedAt = new Date();

    // Stop escalation timer
    this.stopEscalationTimer(alertId);

    this.emit('alert:acknowledged', alert);
    return true;
  }

  /**
   * Resolve an alert
   */
  resolveAlert(alertId: string): boolean {
    const alert = this.alerts.get(alertId);
    if (!alert || alert.status === 'resolved') {
      return false;
    }

    alert.status = 'resolved';
    alert.resolvedAt = new Date();

    // Stop escalation timer
    this.stopEscalationTimer(alertId);

    this.emit('alert:resolved', alert);
    return true;
  }

  /**
   * Suppress an alert for a specified duration
   */
  suppressAlert(alertId: string, durationMinutes: number): boolean {
    const alert = this.alerts.get(alertId);
    if (!alert) {
      return false;
    }

    alert.suppressUntil = new Date(Date.now() + (durationMinutes * 60 * 1000));
    this.emit('alert:suppressed', { alert, duration: durationMinutes });
    return true;
  }

  /**
   * Add or update an alert rule
   */
  addAlertRule(rule: AlertRule): void {
    this.alertRules.set(rule.id, rule);
    
    if (rule.enabled) {
      this.startRuleEvaluation(rule);
    }

    this.emit('rule:added', rule);
  }

  /**
   * Remove an alert rule
   */
  removeAlertRule(ruleId: string): boolean {
    const rule = this.alertRules.get(ruleId);
    if (!rule) {
      return false;
    }

    this.stopRuleEvaluation(ruleId);
    this.alertRules.delete(ruleId);
    
    this.emit('rule:removed', rule);
    return true;
  }

  /**
   * Add or update an escalation policy
   */
  addEscalationPolicy(policy: EscalationPolicy): void {
    this.escalationPolicies.set(policy.id, policy);
    this.emit('escalation_policy:added', policy);
  }

  /**
   * Add or update alert threshold
   */
  addThreshold(threshold: AlertThreshold): void {
    this.thresholds.set(threshold.metric, threshold);
    this.emit('threshold:added', threshold);
  }

  /**
   * Get active alerts
   */
  getActiveAlerts(): Alert[] {
    return Array.from(this.alerts.values())
      .filter(alert => alert.status === 'active')
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * Get alerts by severity
   */
  getAlertsBySeverity(severity: AlertSeverity): Alert[] {
    return Array.from(this.alerts.values())
      .filter(alert => alert.severity === severity)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * Get alerts by type
   */
  getAlertsByType(type: AlertType): Alert[] {
    return Array.from(this.alerts.values())
      .filter(alert => alert.type === type)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * Get alert statistics
   */
  getAlertStatistics(): AlertStatistics {
    const allAlerts = Array.from(this.alerts.values());
    const activeAlerts = allAlerts.filter(a => a.status === 'active');
    const acknowledgedAlerts = allAlerts.filter(a => a.status === 'acknowledged');
    const resolvedAlerts = allAlerts.filter(a => a.status === 'resolved');

    const bySeverity = allAlerts.reduce((acc, alert) => {
      acc[alert.severity] = (acc[alert.severity] || 0) + 1;
      return acc;
    }, {} as Record<AlertSeverity, number>);

    const byType = allAlerts.reduce((acc, alert) => {
      acc[alert.type] = (acc[alert.type] || 0) + 1;
      return acc;
    }, {} as Record<AlertType, number>);

    // Calculate average resolution time
    const resolvedWithTime = resolvedAlerts.filter(a => a.resolvedAt);
    const avgResolutionTime = resolvedWithTime.length > 0
      ? resolvedWithTime.reduce((sum, alert) => {
          const resolutionTime = alert.resolvedAt!.getTime() - alert.timestamp.getTime();
          return sum + (resolutionTime / (1000 * 60)); // Convert to minutes
        }, 0) / resolvedWithTime.length
      : 0;

    // Calculate escalation rate
    const escalatedAlerts = allAlerts.filter(a => a.escalationLevel > 0);
    const escalationRate = allAlerts.length > 0
      ? (escalatedAlerts.length / allAlerts.length) * 100
      : 0;

    return {
      total: allAlerts.length,
      active: activeAlerts.length,
      acknowledged: acknowledgedAlerts.length,
      resolved: resolvedAlerts.length,
      bySeverity,
      byType,
      averageResolutionTime: Math.round(avgResolutionTime),
      escalationRate: Math.round(escalationRate * 100) / 100
    };
  }

  /**
   * Evaluate all alert rules
   */
  evaluateAllRules(): void {
    Array.from(this.alertRules.values()).forEach(rule => {
      if (rule.enabled) {
        this.evaluateRule(rule);
      }
    });
  }

  /**
   * Check if system is in critical state
   */
  isCriticalState(): boolean {
    const criticalAlerts = this.getAlertsBySeverity(AlertSeverity.CRITICAL);
    const emergencyAlerts = this.getAlertsBySeverity(AlertSeverity.EMERGENCY);
    
    return criticalAlerts.length > 0 || emergencyAlerts.length > 0;
  }

  private setupDefaultRules(): void {
    // Error rate rule
    this.addAlertRule({
      id: 'high_error_rate',
      name: 'High Error Rate',
      type: AlertType.ERROR_RATE,
      enabled: true,
      condition: {
        metric: 'error.error_count',
        operator: '>',
        threshold: 10,
        timeWindow: 5,
        evaluationInterval: 60
      },
      severity: AlertSeverity.WARNING,
      escalationPolicy: 'default',
      notificationChannels: ['slack', 'email']
    });

    // MCP server down rule
    this.addAlertRule({
      id: 'mcp_server_down',
      name: 'MCP Server Unavailable',
      type: AlertType.MCP_SERVER_DOWN,
      enabled: true,
      condition: {
        metric: 'mcp_health.mcp_server_health',
        operator: '<',
        threshold: 50,
        timeWindow: 2,
        evaluationInterval: 30
      },
      severity: AlertSeverity.CRITICAL,
      escalationPolicy: 'urgent',
      notificationChannels: ['slack', 'pagerduty']
    });

    // Response time rule
    this.addAlertRule({
      id: 'slow_response_time',
      name: 'Slow Response Time',
      type: AlertType.RESPONSE_TIME,
      enabled: true,
      condition: {
        metric: 'performance.operation_duration',
        operator: '>',
        threshold: 5000,
        timeWindow: 5,
        evaluationInterval: 60
      },
      severity: AlertSeverity.WARNING,
      notificationChannels: ['slack']
    });

    // Add default escalation policies
    this.addEscalationPolicy({
      id: 'default',
      name: 'Default Escalation',
      steps: [
        {
          level: 1,
          delay: 0,
          channels: [{ type: 'slack', config: {}, enabled: true }]
        },
        {
          level: 2,
          delay: 15,
          channels: [
            { type: 'slack', config: {}, enabled: true },
            { type: 'email', config: {}, enabled: true }
          ],
          condition: { alertAge: 15, unacknowledged: true }
        }
      ]
    });

    this.addEscalationPolicy({
      id: 'urgent',
      name: 'Urgent Escalation',
      steps: [
        {
          level: 1,
          delay: 0,
          channels: [
            { type: 'slack', config: {}, enabled: true },
            { type: 'pagerduty', config: {}, enabled: true }
          ]
        },
        {
          level: 2,
          delay: 5,
          channels: [
            { type: 'slack', config: {}, enabled: true },
            { type: 'email', config: {}, enabled: true },
            { type: 'pagerduty', config: {}, enabled: true }
          ],
          condition: { alertAge: 5, unacknowledged: true }
        }
      ]
    });
  }

  private startRuleEvaluation(rule: AlertRule): void {
    const timer = setInterval(() => {
      this.evaluateRule(rule);
    }, rule.condition.evaluationInterval * 1000);

    this.evaluationTimers.set(rule.id, timer);
  }

  private stopRuleEvaluation(ruleId: string): void {
    const timer = this.evaluationTimers.get(ruleId);
    if (timer) {
      clearInterval(timer);
      this.evaluationTimers.delete(ruleId);
    }
  }

  private evaluateRule(rule: AlertRule): void {
    try {
      const now = new Date();
      const timeWindowStart = new Date(now.getTime() - (rule.condition.timeWindow * 60 * 1000));

      // Query metrics for the time window
      const metrics = this.metricsCollector.query({
        timeRange: { start: timeWindowStart, end: now }
      });

      // Filter metrics by the rule's metric name
      const relevantMetrics = metrics.filter(m => 
        m.name === rule.condition.metric || 
        m.category === rule.condition.metric
      );

      if (relevantMetrics.length === 0) {
        return;
      }

      // Calculate aggregate value
      const aggregateValue = this.calculateAggregateValue(relevantMetrics, rule.condition.operator);

      // Check if condition is met
      const conditionMet = this.evaluateCondition(
        aggregateValue,
        rule.condition.operator,
        rule.condition.threshold
      );

      if (conditionMet) {
        // Check if alert already exists for this rule
        const existingAlert = Array.from(this.alerts.values())
          .find(alert => 
            alert.source === rule.id && 
            alert.status === 'active'
          );

        if (!existingAlert) {
          this.createAlert({
            type: rule.type,
            severity: rule.severity,
            title: rule.name,
            description: `${rule.name}: ${rule.condition.metric} ${rule.condition.operator} ${rule.condition.threshold} (current: ${aggregateValue})`,
            source: rule.id,
            metrics: { [rule.condition.metric]: aggregateValue },
            tags: rule.tags || {}
          });
        }
      }
    } catch (error) {
      this.emit('rule:evaluation_error', { rule, error });
    }
  }

  private calculateAggregateValue(metrics: any[], operator: string): number {
    if (metrics.length === 0) return 0;

    switch (operator) {
      case '>':
      case '>=':
        return Math.max(...metrics.map(m => m.value));
      case '<':
      case '<=':
        return Math.min(...metrics.map(m => m.value));
      default:
        return metrics.reduce((sum, m) => sum + m.value, 0) / metrics.length;
    }
  }

  private evaluateCondition(value: number, operator: string, threshold: number): boolean {
    switch (operator) {
      case '>': return value > threshold;
      case '<': return value < threshold;
      case '>=': return value >= threshold;
      case '<=': return value <= threshold;
      case '==': return value === threshold;
      case '!=': return value !== threshold;
      default: return false;
    }
  }

  private startEscalationTimer(alertId: string, policyId: string): void {
    const policy = this.escalationPolicies.get(policyId);
    if (!policy) return;

    const alert = this.alerts.get(alertId);
    if (!alert) return;

    // Find next escalation step
    const nextStep = policy.steps.find(step => step.level > alert.escalationLevel);
    if (!nextStep) return;

    const timer = setTimeout(() => {
      this.escalateAlert(alertId, nextStep, policy);
    }, nextStep.delay * 60 * 1000);

    this.escalationTimers.set(alertId, timer);
  }

  private stopEscalationTimer(alertId: string): void {
    const timer = this.escalationTimers.get(alertId);
    if (timer) {
      clearTimeout(timer);
      this.escalationTimers.delete(alertId);
    }
  }

  private escalateAlert(alertId: string, step: EscalationStep, policy: EscalationPolicy): void {
    const alert = this.alerts.get(alertId);
    if (!alert || alert.status !== 'active') {
      return;
    }

    // Check escalation condition
    if (step.condition) {
      const alertAge = (Date.now() - alert.timestamp.getTime()) / (1000 * 60);
      if (step.condition.unacknowledged && alert.status !== 'active') {
        return;
      }
      if (alertAge < step.condition.alertAge) {
        return;
      }
    }

    alert.escalationLevel = step.level;
    alert.escalatedAt = new Date();

    // Notify escalation channels
    step.channels.forEach(channel => {
      if (channel.enabled) {
        this.sendNotification(alert, channel);
      }
    });

    this.emit('alert:escalated', { alert, step, policy });

    // Schedule next escalation if available
    const nextStep = policy.steps.find(s => s.level > step.level);
    if (nextStep) {
      this.startEscalationTimer(alertId, policy.id);
    }
  }

  private notifyChannels(alert: Alert): void {
    const rule = this.getAlertRule(alert.type);
    if (!rule) return;

    rule.notificationChannels.forEach(channelType => {
      const channel: NotificationChannel = {
        type: channelType as any,
        config: {},
        enabled: true
      };
      this.sendNotification(alert, channel);
    });
  }

  private sendNotification(alert: Alert, channel: NotificationChannel): void {
    // This would integrate with actual notification systems
    this.emit('notification:sent', { alert, channel });
  }

  private findSimilarAlert(newAlert: Alert): Alert | undefined {
    const threshold = 5 * 60 * 1000; // 5 minutes
    const cutoff = new Date(Date.now() - threshold);

    return Array.from(this.alerts.values())
      .find(existing => 
        existing.type === newAlert.type &&
        existing.source === newAlert.source &&
        existing.status === 'active' &&
        existing.timestamp > cutoff
      );
  }

  private updateAlertMetrics(existing: Alert, newMetrics: Record<string, number>): void {
    Object.assign(existing.metrics, newMetrics);
    this.emit('alert:updated', existing);
  }

  private getAlertRule(type: AlertType): AlertRule | undefined {
    return Array.from(this.alertRules.values())
      .find(rule => rule.type === type && rule.enabled);
  }

  private generateAlertId(): string {
    return `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private startCleanupJob(): void {
    // Clean up old alerts every 24 hours
    setInterval(() => {
      this.cleanup();
    }, 24 * 60 * 60 * 1000);
  }

  private cleanup(): void {
    const cutoff = new Date(Date.now() - (this.config.historyRetentionDays * 24 * 60 * 60 * 1000));
    let cleanedCount = 0;

    // Clean up resolved alerts older than retention period
    Array.from(this.alerts.entries()).forEach(([id, alert]) => {
      if (alert.status === 'resolved' && alert.resolvedAt && alert.resolvedAt < cutoff) {
        this.alerts.delete(id);
        cleanedCount++;
      }
    });

    // Clean up alert history
    this.alertHistory = this.alertHistory.filter(alert => 
      alert.status !== 'resolved' || !alert.resolvedAt || alert.resolvedAt >= cutoff
    );

    if (cleanedCount > 0) {
      this.emit('alert:cleanup_completed', { cleanedAlerts: cleanedCount });
    }
  }
}