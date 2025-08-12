/**
 * Monitoring Orchestrator
 * Central coordinator for all monitoring components and observability features
 */

import { EventEmitter } from 'events';
import { MetricsCollector } from './MetricsCollector';
import { MCPHealthMonitor } from './MCPHealthMonitor';
import { UserExperienceMonitor } from './UserExperienceMonitor';
import { PerformanceMonitor } from './PerformanceMonitor';
import { AlertManager } from './AlertManager';
import { DashboardProvider } from './DashboardProvider';

export interface MonitoringConfig {
  enabled: boolean;
  components: {
    metrics: boolean;
    mcpHealth: boolean;
    userExperience: boolean;
    performance: boolean;
    alerts: boolean;
    dashboard: boolean;
  };
  mcpServers: string[];
  alerting: {
    enabled: boolean;
    channels: string[];
  };
  dashboard: {
    enabled: boolean;
    port?: number;
  };
}

export interface MonitoringSnapshot {
  timestamp: Date;
  systemHealth: HealthStatus;
  metrics: {
    totalErrors: number;
    avgResponseTime: number;
    activeUsers: number;
    errorRate: number;
  };
  mcpServers: {
    total: number;
    healthy: number;
    degraded: number;
    unhealthy: number;
  };
  alerts: {
    active: number;
    critical: number;
    warnings: number;
  };
  performance: {
    cpuUsage: number;
    memoryUsage: number;
    errorHandlingOverhead: number;
  };
  userExperience: {
    satisfaction: number;
    highRiskUsers: number;
    impactLevel: string;
  };
}

export interface HealthStatus {
  overall: 'healthy' | 'degraded' | 'unhealthy' | 'critical';
  score: number; // 0-100
  components: {
    metrics: 'healthy' | 'degraded' | 'unhealthy';
    mcpServers: 'healthy' | 'degraded' | 'unhealthy';
    userExperience: 'healthy' | 'degraded' | 'unhealthy';
    performance: 'healthy' | 'degraded' | 'unhealthy';
    alerts: 'healthy' | 'degraded' | 'unhealthy';
  };
  lastUpdate: Date;
}

/**
 * Central orchestrator for all monitoring and observability components
 */
export class MonitoringOrchestrator extends EventEmitter {
  private metricsCollector!: MetricsCollector;
  private mcpHealthMonitor!: MCPHealthMonitor;
  private userExperienceMonitor!: UserExperienceMonitor;
  private performanceMonitor!: PerformanceMonitor;
  private alertManager!: AlertManager;
  private dashboardProvider!: DashboardProvider;
  
  private isInitialized: boolean = false;
  private isRunning: boolean = false;
  private healthCheckInterval?: NodeJS.Timeout;

  constructor(
    private config: MonitoringConfig = {
      enabled: true,
      components: {
        metrics: true,
        mcpHealth: true,
        userExperience: true,
        performance: true,
        alerts: true,
        dashboard: true
      },
      mcpServers: [],
      alerting: {
        enabled: true,
        channels: ['slack']
      },
      dashboard: {
        enabled: true,
        port: 3001
      }
    }
  ) {
    super();
    this.initializeComponents();
  }

  /**
   * Initialize all monitoring components
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      throw new Error('Monitoring orchestrator already initialized');
    }

    try {
      // Initialize components in dependency order
      if (this.config.components.metrics) {
        this.emit('component:initializing', 'metrics');
      }

      if (this.config.components.mcpHealth && this.config.mcpServers.length > 0) {
        this.emit('component:initializing', 'mcpHealth');
      }

      if (this.config.components.userExperience) {
        this.emit('component:initializing', 'userExperience');
      }

      if (this.config.components.performance) {
        this.emit('component:initializing', 'performance');
      }

      if (this.config.components.alerts) {
        this.emit('component:initializing', 'alerts');
      }

      if (this.config.components.dashboard) {
        this.emit('component:initializing', 'dashboard');
      }

      this.setupEventListeners();
      this.isInitialized = true;

      this.emit('monitoring:initialized');
    } catch (error) {
      this.emit('monitoring:initialization_error', error);
      throw error;
    }
  }

  /**
   * Start all monitoring components
   */
  async start(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (this.isRunning) {
      throw new Error('Monitoring orchestrator already running');
    }

    try {
      this.isRunning = true;

      // Start components
      if (this.config.components.mcpHealth && this.config.mcpServers.length > 0) {
        this.mcpHealthMonitor.startMonitoring(this.config.mcpServers);
        this.emit('component:started', 'mcpHealth');
      }

      if (this.config.components.performance) {
        this.performanceMonitor.startMonitoring();
        this.emit('component:started', 'performance');
      }

      if (this.config.components.dashboard) {
        this.dashboardProvider.start();
        this.emit('component:started', 'dashboard');
      }

      // Start health checks
      this.startHealthChecks();

      this.emit('monitoring:started');
    } catch (error) {
      this.isRunning = false;
      this.emit('monitoring:start_error', error);
      throw error;
    }
  }

  /**
   * Stop all monitoring components
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      this.isRunning = false;

      // Stop health checks
      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
        this.healthCheckInterval = undefined;
      }

      // Stop components
      if (this.config.components.mcpHealth) {
        this.mcpHealthMonitor.stopMonitoring();
        this.emit('component:stopped', 'mcpHealth');
      }

      if (this.config.components.performance) {
        this.performanceMonitor.stopMonitoring();
        this.emit('component:stopped', 'performance');
      }

      if (this.config.components.dashboard) {
        this.dashboardProvider.stop();
        this.emit('component:stopped', 'dashboard');
      }

      this.emit('monitoring:stopped');
    } catch (error) {
      this.emit('monitoring:stop_error', error);
      throw error;
    }
  }

  /**
   * Get current monitoring snapshot
   */
  getSnapshot(): MonitoringSnapshot {
    const timestamp = new Date();
    const healthStatus = this.getHealthStatus();
    
    // Collect data from all components
    const metricsSnapshot = this.metricsCollector.getSnapshot();
    const mcpHealthSummary = this.mcpHealthMonitor.getHealthSummary();
    const uxSummary = this.userExperienceMonitor.getUXSummary();
    const performanceSnapshot = this.performanceMonitor.getCurrentSnapshot();
    const alertStats = this.alertManager.getAlertStatistics();
    const errorHandlingStats = this.performanceMonitor.getErrorHandlingStats();

    return {
      timestamp,
      systemHealth: healthStatus,
      metrics: {
        totalErrors: metricsSnapshot.summary.totalErrors,
        avgResponseTime: metricsSnapshot.summary.avgResponseTime,
        activeUsers: uxSummary.activeUsers,
        errorRate: performanceSnapshot.operations.failedRequests / Math.max(1, performanceSnapshot.operations.totalRequests) * 100
      },
      mcpServers: {
        total: mcpHealthSummary.totalServers,
        healthy: mcpHealthSummary.healthyServers,
        degraded: mcpHealthSummary.degradedServers,
        unhealthy: mcpHealthSummary.unhealthyServers
      },
      alerts: {
        active: alertStats.active,
        critical: alertStats.bySeverity.critical || 0,
        warnings: alertStats.bySeverity.warning || 0
      },
      performance: {
        cpuUsage: performanceSnapshot.cpu.usage,
        memoryUsage: (performanceSnapshot.memory.used / performanceSnapshot.memory.total) * 100,
        errorHandlingOverhead: errorHandlingStats.averageOverhead
      },
      userExperience: {
        satisfaction: uxSummary.avgSatisfactionScore,
        highRiskUsers: uxSummary.highRiskUsers,
        impactLevel: this.calculateOverallImpactLevel(uxSummary.errorImpactDistribution)
      }
    };
  }

  /**
   * Get overall system health status
   */
  getHealthStatus(): HealthStatus {
    const mcpHealth = this.mcpHealthMonitor.getHealthSummary();
    const alertStats = this.alertManager.getAlertStatistics();
    const uxSummary = this.userExperienceMonitor.getUXSummary();
    const performanceSnapshot = this.performanceMonitor.getCurrentSnapshot();
    const metricsSnapshot = this.metricsCollector.getSnapshot();

    // Calculate component health
    const components = {
      metrics: this.calculateMetricsHealth(metricsSnapshot),
      mcpServers: this.calculateMCPHealth(mcpHealth),
      userExperience: this.calculateUXHealth(uxSummary),
      performance: this.calculatePerformanceHealth(performanceSnapshot),
      alerts: this.calculateAlertsHealth(alertStats)
    };

    // Calculate overall health score
    const componentScores = {
      metrics: this.getHealthScore(components.metrics),
      mcpServers: this.getHealthScore(components.mcpServers),
      userExperience: this.getHealthScore(components.userExperience),
      performance: this.getHealthScore(components.performance),
      alerts: this.getHealthScore(components.alerts)
    };

    const overallScore = Object.values(componentScores).reduce((sum, score) => sum + score, 0) / Object.keys(componentScores).length;
    const overall = this.scoreToHealthStatus(overallScore);

    return {
      overall,
      score: Math.round(overallScore),
      components,
      lastUpdate: new Date()
    };
  }

  /**
   * Record an error and its monitoring impact
   */
  recordError(error: {
    category: string;
    severity: string;
    message: string;
    userId?: string;
    sessionId?: string;
    operation?: string;
    context?: Record<string, any>;
  }): void {
    const startTime = Date.now();

    try {
      // Record in metrics collector
      this.metricsCollector.recordError({
        category: error.category as any,
        severity: error.severity as any,
        toolType: error.context?.toolType,
        operation: error.operation,
        userId: error.userId,
        context: error.context
      });

      // Record UX impact if user information available
      if (error.userId && error.sessionId) {
        this.userExperienceMonitor.recordErrorImpact(error.userId, error.sessionId, {
          category: error.category as any,
          severity: error.severity as any,
          message: error.message,
          recoverable: error.context?.recoverable !== false,
          userMessage: error.context?.userMessage || error.message
        });
      }

      // Record error handling overhead
      const processingTime = Date.now() - startTime;
      this.performanceMonitor.recordErrorHandlingOverhead(processingTime);

      this.emit('error:recorded', { error, processingTime });
    } catch (monitoringError) {
      // Don't let monitoring errors break the main application
      this.emit('monitoring:error', { 
        type: 'error_recording_failed', 
        originalError: error, 
        monitoringError 
      });
    }
  }

  /**
   * Record an operation performance metric
   */
  recordOperation(operation: {
    name: string;
    duration: number;
    success: boolean;
    userId?: string;
    context?: Record<string, any>;
  }): void {
    try {
      // Record performance metric
      this.performanceMonitor.recordOperationLatency(operation.name, operation.duration, operation.success);

      // Record user interaction if user information available
      if (operation.userId) {
        // This would integrate with user experience monitoring
        this.emit('operation:recorded', operation);
      }
    } catch (error) {
      this.emit('monitoring:error', { 
        type: 'operation_recording_failed', 
        operation, 
        error 
      });
    }
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<MonitoringConfig>): void {
    const previousConfig = { ...this.config };
    this.config = { ...this.config, ...newConfig };

    // Handle component enable/disable
    this.handleConfigChanges(previousConfig, this.config);

    this.emit('config:updated', { previous: previousConfig, current: this.config });
  }

  /**
   * Get monitoring metrics for external systems
   */
  getMetricsForExport(): Record<string, number> {
    const snapshot = this.getSnapshot();
    
    return {
      'system.health.overall': snapshot.systemHealth.score,
      'system.health.mcp_servers': this.getHealthScore(snapshot.systemHealth.components.mcpServers),
      'system.health.performance': this.getHealthScore(snapshot.systemHealth.components.performance),
      'system.health.user_experience': this.getHealthScore(snapshot.systemHealth.components.userExperience),
      'errors.total': snapshot.metrics.totalErrors,
      'errors.rate': snapshot.metrics.errorRate,
      'response_time.avg': snapshot.metrics.avgResponseTime,
      'users.active': snapshot.metrics.activeUsers,
      'users.high_risk': snapshot.userExperience.highRiskUsers,
      'users.satisfaction': snapshot.userExperience.satisfaction,
      'mcp.servers.total': snapshot.mcpServers.total,
      'mcp.servers.healthy': snapshot.mcpServers.healthy,
      'mcp.servers.unhealthy': snapshot.mcpServers.unhealthy,
      'alerts.active': snapshot.alerts.active,
      'alerts.critical': snapshot.alerts.critical,
      'performance.cpu': snapshot.performance.cpuUsage,
      'performance.memory': snapshot.performance.memoryUsage,
      'performance.error_overhead': snapshot.performance.errorHandlingOverhead
    };
  }

  private initializeComponents(): void {
    // Initialize core components
    this.metricsCollector = new MetricsCollector();
    this.mcpHealthMonitor = new MCPHealthMonitor(this.metricsCollector);
    this.userExperienceMonitor = new UserExperienceMonitor(this.metricsCollector);
    this.performanceMonitor = new PerformanceMonitor(this.metricsCollector);
    this.alertManager = new AlertManager(this.metricsCollector);
    this.dashboardProvider = new DashboardProvider(
      this.metricsCollector,
      this.mcpHealthMonitor,
      this.userExperienceMonitor,
      this.performanceMonitor,
      this.alertManager
    );
  }

  private setupEventListeners(): void {
    // Forward important events
    this.alertManager.on('alert:created', (alert) => {
      this.emit('alert:created', alert);
    });

    this.mcpHealthMonitor.on('server:status_changed', (event) => {
      this.emit('mcp:status_changed', event);
    });

    this.userExperienceMonitor.on('satisfaction:survey_trigger', (event) => {
      this.emit('ux:survey_trigger', event);
    });

    this.performanceMonitor.on('performance:alert', (alert) => {
      this.emit('performance:alert', alert);
    });
  }

  private startHealthChecks(): void {
    // Run health checks every 30 seconds
    this.healthCheckInterval = setInterval(() => {
      try {
        const health = this.getHealthStatus();
        this.emit('health:check', health);

        // Trigger alerts for critical health issues
        if (health.overall === 'critical') {
          this.alertManager.createAlert({
            type: 'system_failure' as any,
            severity: 'critical' as any,
            title: 'System Critical Health',
            description: `System health critical (score: ${health.score})`,
            source: 'monitoring_orchestrator',
            metrics: { health_score: health.score },
            tags: { component: 'system_health' }
          });
        }
      } catch (error) {
        this.emit('monitoring:error', { type: 'health_check_failed', error });
      }
    }, 30000);
  }

  private calculateMetricsHealth(snapshot: any): 'healthy' | 'degraded' | 'unhealthy' {
    if (snapshot.summary.totalErrors > 100) return 'unhealthy';
    if (snapshot.summary.totalErrors > 20) return 'degraded';
    return 'healthy';
  }

  private calculateMCPHealth(summary: any): 'healthy' | 'degraded' | 'unhealthy' {
    if (summary.overallHealthScore < 50) return 'unhealthy';
    if (summary.overallHealthScore < 80) return 'degraded';
    return 'healthy';
  }

  private calculateUXHealth(summary: any): 'healthy' | 'degraded' | 'unhealthy' {
    if (summary.avgSatisfactionScore < 2) return 'unhealthy';
    if (summary.avgSatisfactionScore < 3.5) return 'degraded';
    return 'healthy';
  }

  private calculatePerformanceHealth(snapshot: any): 'healthy' | 'degraded' | 'unhealthy' {
    if (snapshot.cpu.usage > 90 || snapshot.operations.averageResponseTime > 10000) return 'unhealthy';
    if (snapshot.cpu.usage > 70 || snapshot.operations.averageResponseTime > 5000) return 'degraded';
    return 'healthy';
  }

  private calculateAlertsHealth(stats: any): 'healthy' | 'degraded' | 'unhealthy' {
    if (stats.bySeverity.critical > 0) return 'unhealthy';
    if (stats.bySeverity.warning > 5) return 'degraded';
    return 'healthy';
  }

  private getHealthScore(status: 'healthy' | 'degraded' | 'unhealthy'): number {
    switch (status) {
      case 'healthy': return 100;
      case 'degraded': return 60;
      case 'unhealthy': return 20;
      default: return 0;
    }
  }

  private scoreToHealthStatus(score: number): 'healthy' | 'degraded' | 'unhealthy' | 'critical' {
    if (score >= 80) return 'healthy';
    if (score >= 60) return 'degraded';
    if (score >= 20) return 'unhealthy';
    return 'critical';
  }

  private calculateOverallImpactLevel(distribution: any): string {
    if (distribution?.critical > 0) return 'critical';
    if (distribution?.significant > 0) return 'significant';
    if (distribution?.moderate > 0) return 'moderate';
    if (distribution?.minimal > 0) return 'minimal';
    return 'none';
  }

  private handleConfigChanges(previous: MonitoringConfig, current: MonitoringConfig): void {
    // Handle MCP server list changes
    if (JSON.stringify(previous.mcpServers) !== JSON.stringify(current.mcpServers)) {
      if (this.isRunning && current.components.mcpHealth) {
        this.mcpHealthMonitor.stopMonitoring();
        this.mcpHealthMonitor.startMonitoring(current.mcpServers);
      }
    }

    // Handle component enable/disable
    Object.keys(current.components).forEach(component => {
      const wasEnabled = (previous.components as any)[component];
      const isEnabled = (current.components as any)[component];
      
      if (wasEnabled !== isEnabled) {
        this.emit('component:config_changed', { component, enabled: isEnabled });
      }
    });
  }
}