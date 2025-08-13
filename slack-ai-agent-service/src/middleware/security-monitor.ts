/**
 * Security Event Monitoring and Logging System
 * Comprehensive monitoring system for network security events
 */

import { Request, Response, NextFunction } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../utils/logger';
import { SecurityLoggingConfig } from '../config/network-security';

/**
 * Security event types
 */
export type SecurityEventType = 
  | 'ip_whitelist_violation'
  | 'rate_limit_exceeded'
  | 'insecure_connection_attempt'
  | 'tls_version_violation'
  | 'firewall_block'
  | 'suspicious_activity'
  | 'authentication_failure'
  | 'authorization_failure'
  | 'malformed_request'
  | 'potential_attack'
  | 'security_scan_detected';

/**
 * Security event severity levels
 */
export type SecurityEventSeverity = 'low' | 'medium' | 'high' | 'critical';

/**
 * Security event interface
 */
export interface SecurityEvent {
  /** Event unique identifier */
  id: string;
  /** Event type */
  type: SecurityEventType;
  /** Event severity */
  severity: SecurityEventSeverity;
  /** Event timestamp */
  timestamp: string;
  /** Client IP address */
  clientIP?: string;
  /** User agent string */
  userAgent?: string;
  /** Request method */
  method?: string;
  /** Request path */
  path?: string;
  /** Request host */
  host?: string;
  /** Event description */
  description: string;
  /** Event details */
  details: Record<string, any>;
  /** Geographic information (if available) */
  location?: {
    country?: string;
    region?: string;
    city?: string;
    isp?: string;
  };
  /** Risk score (0-100) */
  riskScore: number;
  /** Whether this event was automatically blocked */
  blocked: boolean;
  /** Response status code */
  responseStatus?: number;
  /** Response time in milliseconds */
  responseTime?: number;
}

/**
 * Security alert interface
 */
export interface SecurityAlert {
  /** Alert ID */
  id: string;
  /** Alert timestamp */
  timestamp: string;
  /** Alert type based on event patterns */
  type: 'burst' | 'persistent' | 'escalation' | 'anomaly';
  /** Alert severity */
  severity: SecurityEventSeverity;
  /** Alert description */
  description: string;
  /** Related events */
  events: SecurityEvent[];
  /** Whether alert was sent */
  sent: boolean;
  /** Alert expiry time */
  expiresAt: string;
}

/**
 * Security monitoring statistics
 */
export interface SecurityStats {
  /** Total events recorded */
  totalEvents: number;
  /** Events by type */
  eventsByType: Record<SecurityEventType, number>;
  /** Events by severity */
  eventsBySeverity: Record<SecurityEventSeverity, number>;
  /** Unique IPs seen */
  uniqueIPs: Set<string>;
  /** Most active IPs */
  topIPs: Array<{ ip: string; count: number }>;
  /** Recent events */
  recentEvents: SecurityEvent[];
  /** Active alerts */
  activeAlerts: SecurityAlert[];
  /** Stats reset timestamp */
  lastReset: Date;
}

/**
 * Security monitoring options
 */
export interface SecurityMonitoringOptions extends SecurityLoggingConfig {
  /** Maximum events to keep in memory */
  maxEventsInMemory?: number;
  /** Maximum alerts to keep active */
  maxActiveAlerts?: number;
  /** Log file rotation size in bytes */
  logRotationSize?: number;
  /** Enable geographic IP lookup */
  enableGeoLocation?: boolean;
  /** Custom event processors */
  eventProcessors?: Array<(event: SecurityEvent) => Promise<void>>;
  /** Custom alert handlers */
  alertHandlers?: Array<(alert: SecurityAlert) => Promise<void>>;
}

/**
 * Security Event Monitor Class
 */
export class SecurityEventMonitor {
  private config: SecurityMonitoringOptions;
  private events: SecurityEvent[] = [];
  private alerts: SecurityAlert[] = [];
  private stats: SecurityStats;
  private eventCounts: Map<string, { count: number; firstSeen: number; lastSeen: number }> = new Map();
  private logStream?: fs.FileHandle;
  private alertCooldowns: Map<string, number> = new Map();

  constructor(config: SecurityMonitoringOptions) {
    this.config = {
      maxEventsInMemory: 10000,
      maxActiveAlerts: 100,
      logRotationSize: 10 * 1024 * 1024, // 10MB
      enableGeoLocation: false,
      ...config,
    };

    this.stats = {
      totalEvents: 0,
      eventsByType: {} as Record<SecurityEventType, number>,
      eventsBySeverity: {} as Record<SecurityEventSeverity, number>,
      uniqueIPs: new Set(),
      topIPs: [],
      recentEvents: [],
      activeAlerts: [],
      lastReset: new Date(),
    };

    this.initializeLogging();
    this.startCleanupProcess();

    logger().info('Security Event Monitor initialized', {
      enabled: this.config.enabled,
      level: this.config.level,
      logFile: this.config.logFile,
      alerting: this.config.alerting.enabled,
    });
  }

  /**
   * Initialize security logging
   */
  private async initializeLogging(): Promise<void> {
    if (!this.config.enabled || !this.config.logFile) {
      return;
    }

    try {
      const logDir = path.dirname(this.config.logFile);
      await fs.mkdir(logDir, { recursive: true });
      
      this.logStream = await fs.open(this.config.logFile, 'a');
      logger().info('Security log file opened', { logFile: this.config.logFile });
    } catch (error) {
      logger().error('Failed to initialize security logging', { error, logFile: this.config.logFile });
    }
  }

  /**
   * Start cleanup process for old events and alerts
   */
  private startCleanupProcess(): void {
    // Cleanup every 10 minutes
    setInterval(() => {
      this.cleanupOldData();
    }, 10 * 60 * 1000);
  }

  /**
   * Cleanup old events and alerts
   */
  private cleanupOldData(): void {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours

    // Remove old events
    const originalEventCount = this.events.length;
    this.events = this.events.filter(event => {
      const eventAge = now - new Date(event.timestamp).getTime();
      return eventAge < maxAge;
    });

    // Remove expired alerts
    const originalAlertCount = this.alerts.length;
    this.alerts = this.alerts.filter(alert => {
      return new Date(alert.expiresAt).getTime() > now;
    });

    // Limit memory usage
    if (this.events.length > this.config.maxEventsInMemory!) {
      this.events = this.events.slice(-this.config.maxEventsInMemory!);
    }

    if (this.alerts.length > this.config.maxActiveAlerts!) {
      this.alerts = this.alerts.slice(-this.config.maxActiveAlerts!);
    }

    if (originalEventCount !== this.events.length || originalAlertCount !== this.alerts.length) {
      logger().debug('Security data cleanup completed', {
        eventsRemoved: originalEventCount - this.events.length,
        alertsRemoved: originalAlertCount - this.alerts.length,
        currentEvents: this.events.length,
        currentAlerts: this.alerts.length,
      });
    }
  }

  /**
   * Generate unique event ID
   */
  private generateEventId(): string {
    return `sec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Calculate risk score for event
   */
  private calculateRiskScore(event: Partial<SecurityEvent>): number {
    let score = 0;

    // Base score by event type
    const typeScores: Record<SecurityEventType, number> = {
      'ip_whitelist_violation': 30,
      'rate_limit_exceeded': 20,
      'insecure_connection_attempt': 10,
      'tls_version_violation': 15,
      'firewall_block': 40,
      'suspicious_activity': 60,
      'authentication_failure': 50,
      'authorization_failure': 45,
      'malformed_request': 35,
      'potential_attack': 80,
      'security_scan_detected': 70,
    };

    if (event.type) {
      score += typeScores[event.type] || 20;
    }

    // Increase score for repeat offenders
    if (event.clientIP) {
      const ipData = this.eventCounts.get(event.clientIP);
      if (ipData) {
        score += Math.min(ipData.count * 2, 30);
      }
    }

    // Increase score based on severity
    const severityMultipliers: Record<SecurityEventSeverity, number> = {
      'low': 1.0,
      'medium': 1.5,
      'high': 2.0,
      'critical': 2.5,
    };

    if (event.severity) {
      score *= severityMultipliers[event.severity];
    }

    return Math.min(Math.round(score), 100);
  }

  /**
   * Detect suspicious patterns and create alerts
   */
  private async detectPatterns(event: SecurityEvent): Promise<void> {
    if (!this.config.alerting.enabled) {
      return;
    }

    const now = Date.now();
    const windowMs = 5 * 60 * 1000; // 5 minute window

    // Check for burst activity (multiple events from same IP in short time)
    if (event.clientIP) {
      const recentEvents = this.events.filter(e => 
        e.clientIP === event.clientIP && 
        (now - new Date(e.timestamp).getTime()) < windowMs
      );

      if (recentEvents.length >= 10) {
        await this.createAlert({
          type: 'burst',
          severity: 'high',
          description: `Burst of ${recentEvents.length} security events from IP ${event.clientIP}`,
          events: recentEvents.slice(-10),
        });
      }
    }

    // Check for escalation (increasing severity)
    const recentEvents = this.events.slice(-20).filter(e => 
      e.clientIP === event.clientIP
    );

    if (recentEvents.length >= 3) {
      const severityLevels = { low: 1, medium: 2, high: 3, critical: 4 };
      const isEscalating = recentEvents.every((e, i) => 
        i === 0 || severityLevels[e.severity] >= severityLevels[recentEvents[i - 1].severity]
      );

      if (isEscalating && event.severity === 'high' || event.severity === 'critical') {
        await this.createAlert({
          type: 'escalation',
          severity: 'critical',
          description: `Escalating threat pattern detected from IP ${event.clientIP}`,
          events: recentEvents,
        });
      }
    }

    // Check for potential attacks (high-risk events)
    if (event.riskScore >= 70) {
      await this.createAlert({
        type: 'anomaly',
        severity: 'critical',
        description: `High-risk security event detected: ${event.description}`,
        events: [event],
      });
    }
  }

  /**
   * Create security alert
   */
  private async createAlert(alertData: {
    type: SecurityAlert['type'];
    severity: SecurityEventSeverity;
    description: string;
    events: SecurityEvent[];
  }): Promise<void> {
    const alertId = `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const cooldownKey = `${alertData.type}_${alertData.events[0]?.clientIP || 'unknown'}`;

    // Check cooldown
    const lastAlert = this.alertCooldowns.get(cooldownKey);
    const now = Date.now();
    const cooldownMs = this.config.alerting.cooldownMinutes * 60 * 1000;

    if (lastAlert && (now - lastAlert) < cooldownMs) {
      logger().debug('Alert suppressed due to cooldown', { cooldownKey });
      return;
    }

    const alert: SecurityAlert = {
      id: alertId,
      timestamp: new Date().toISOString(),
      type: alertData.type,
      severity: alertData.severity,
      description: alertData.description,
      events: alertData.events,
      sent: false,
      expiresAt: new Date(now + (60 * 60 * 1000)).toISOString(), // 1 hour
    };

    this.alerts.push(alert);
    this.alertCooldowns.set(cooldownKey, now);

    logger().warn('Security alert created', {
      alertId,
      type: alert.type,
      severity: alert.severity,
      description: alert.description,
      eventCount: alert.events.length,
    });

    // Process custom alert handlers
    if (this.config.alertHandlers) {
      for (const handler of this.config.alertHandlers) {
        try {
          await handler(alert);
          alert.sent = true;
        } catch (error) {
          logger().error('Alert handler failed', { alertId, error });
        }
      }
    }

    // Update stats
    this.stats.activeAlerts = this.alerts.filter(a => new Date(a.expiresAt).getTime() > now);
  }

  /**
   * Record a security event
   */
  async recordEvent(eventData: {
    type: SecurityEventType;
    severity?: SecurityEventSeverity;
    description: string;
    details?: Record<string, any>;
    req?: Request;
    res?: Response;
    blocked?: boolean;
    responseTime?: number;
  }): Promise<SecurityEvent> {
    if (!this.config.enabled) {
      return {} as SecurityEvent;
    }

    const now = new Date();
    const clientIP = eventData.req?.socket.remoteAddress?.replace(/^::ffff:/, '') || undefined;

    const event: SecurityEvent = {
      id: this.generateEventId(),
      type: eventData.type,
      severity: eventData.severity || 'medium',
      timestamp: now.toISOString(),
      description: eventData.description,
      details: eventData.details || {},
      blocked: eventData.blocked || false,
      riskScore: 0, // Will be calculated below
      clientIP,
      userAgent: eventData.req?.get('user-agent'),
      method: eventData.req?.method,
      path: eventData.req?.path,
      host: eventData.req?.get('host'),
      responseStatus: eventData.res?.statusCode,
      responseTime: eventData.responseTime,
    };

    // Calculate risk score
    event.riskScore = this.calculateRiskScore(event);

    // Update tracking
    if (clientIP) {
      const ipData = this.eventCounts.get(clientIP) || { count: 0, firstSeen: now.getTime(), lastSeen: 0 };
      ipData.count++;
      ipData.lastSeen = now.getTime();
      this.eventCounts.set(clientIP, ipData);
      this.stats.uniqueIPs.add(clientIP);
    }

    // Add to events list
    this.events.push(event);

    // Update statistics
    this.stats.totalEvents++;
    this.stats.eventsByType[event.type] = (this.stats.eventsByType[event.type] || 0) + 1;
    this.stats.eventsBySeverity[event.severity] = (this.stats.eventsBySeverity[event.severity] || 0) + 1;
    this.stats.recentEvents.unshift(event);
    this.stats.recentEvents = this.stats.recentEvents.slice(0, 100); // Keep last 100

    // Update top IPs
    this.updateTopIPs();

    // Log the event
    await this.logEvent(event);

    // Process custom event processors
    if (this.config.eventProcessors) {
      for (const processor of this.config.eventProcessors) {
        try {
          await processor(event);
        } catch (error) {
          logger().error('Event processor failed', { eventId: event.id, error });
        }
      }
    }

    // Detect patterns and create alerts
    await this.detectPatterns(event);

    logger().log(this.config.level, 'Security event recorded', {
      eventId: event.id,
      type: event.type,
      severity: event.severity,
      clientIP: event.clientIP,
      riskScore: event.riskScore,
      blocked: event.blocked,
    });

    return event;
  }

  /**
   * Update top IPs list
   */
  private updateTopIPs(): void {
    const ipCounts = Array.from(this.eventCounts.entries())
      .map(([ip, data]) => ({ ip, count: data.count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    this.stats.topIPs = ipCounts;
  }

  /**
   * Log event to file
   */
  private async logEvent(event: SecurityEvent): Promise<void> {
    if (!this.logStream) {
      return;
    }

    try {
      const logEntry = {
        timestamp: event.timestamp,
        level: 'SECURITY',
        eventId: event.id,
        type: event.type,
        severity: event.severity,
        clientIP: event.clientIP,
        userAgent: event.userAgent,
        method: event.method,
        path: event.path,
        host: event.host,
        description: event.description,
        riskScore: event.riskScore,
        blocked: event.blocked,
        responseStatus: event.responseStatus,
        responseTime: event.responseTime,
        details: this.config.includeRequestDetails ? event.details : undefined,
      };

      await this.logStream.write(JSON.stringify(logEntry) + '\n');
    } catch (error) {
      logger().error('Failed to write security log entry', { eventId: event.id, error });
    }
  }

  /**
   * Create Express middleware function
   */
  middleware(): (req: Request, res: Response, next: NextFunction) => void {
    return (req: Request, res: Response, next: NextFunction) => {
      const startTime = Date.now();

      // Hook into response to capture response data
      const originalEnd = res.end;
      res.end = function(this: Response, ...args: any[]) {
        const responseTime = Date.now() - startTime;
        
        // Check for suspicious patterns in response
        if (res.statusCode >= 400) {
          // Record security event for error responses
          // This will be handled by other middleware, we just capture timing here
        }

        return originalEnd.apply(this, args);
      };

      next();
    };
  }

  /**
   * Get current statistics
   */
  getStatistics(): SecurityStats {
    return {
      ...this.stats,
      uniqueIPs: new Set(this.stats.uniqueIPs), // Return copy
      activeAlerts: this.alerts.filter(a => new Date(a.expiresAt).getTime() > Date.now()),
    };
  }

  /**
   * Get recent events with filtering
   */
  getRecentEvents(options: {
    limit?: number;
    type?: SecurityEventType;
    severity?: SecurityEventSeverity;
    clientIP?: string;
    since?: Date;
  } = {}): SecurityEvent[] {
    let filtered = [...this.events];

    if (options.type) {
      filtered = filtered.filter(e => e.type === options.type);
    }

    if (options.severity) {
      filtered = filtered.filter(e => e.severity === options.severity);
    }

    if (options.clientIP) {
      filtered = filtered.filter(e => e.clientIP === options.clientIP);
    }

    if (options.since) {
      filtered = filtered.filter(e => new Date(e.timestamp) >= options.since!);
    }

    filtered.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return filtered.slice(0, options.limit || 100);
  }

  /**
   * Get active alerts
   */
  getActiveAlerts(): SecurityAlert[] {
    const now = Date.now();
    return this.alerts.filter(a => new Date(a.expiresAt).getTime() > now);
  }

  /**
   * Reset statistics
   */
  resetStatistics(): void {
    this.stats = {
      totalEvents: 0,
      eventsByType: {} as Record<SecurityEventType, number>,
      eventsBySeverity: {} as Record<SecurityEventSeverity, number>,
      uniqueIPs: new Set(),
      topIPs: [],
      recentEvents: [],
      activeAlerts: [],
      lastReset: new Date(),
    };

    this.eventCounts.clear();
    this.alertCooldowns.clear();

    logger().info('Security monitoring statistics reset');
  }

  /**
   * Get health status
   */
  getHealthStatus(): {
    healthy: boolean;
    enabled: boolean;
    logFileWritable: boolean;
    configuration: {
      level: string;
      alerting: boolean;
      logFile?: string;
    };
    activity: {
      totalEvents: number;
      recentEvents: number;
      activeAlerts: number;
      uniqueIPs: number;
    };
  } {
    const recentEventCount = this.events.filter(e => 
      (Date.now() - new Date(e.timestamp).getTime()) < (60 * 60 * 1000) // Last hour
    ).length;

    return {
      healthy: true,
      enabled: this.config.enabled,
      logFileWritable: !!this.logStream,
      configuration: {
        level: this.config.level,
        alerting: this.config.alerting.enabled,
        logFile: this.config.logFile,
      },
      activity: {
        totalEvents: this.stats.totalEvents,
        recentEvents: recentEventCount,
        activeAlerts: this.getActiveAlerts().length,
        uniqueIPs: this.stats.uniqueIPs.size,
      },
    };
  }

  /**
   * Cleanup resources
   */
  async destroy(): Promise<void> {
    if (this.logStream) {
      await this.logStream.close();
    }
    logger().info('Security Event Monitor destroyed');
  }
}

/**
 * Create security monitoring middleware
 */
export function createSecurityMonitor(config: SecurityMonitoringOptions): SecurityEventMonitor {
  return new SecurityEventMonitor(config);
}