/**
 * Dashboard Integration Provider
 * Provides real-time error monitoring and historical analysis data for dashboards
 */

import { EventEmitter } from 'events';
import { MetricsCollector, MetricsSnapshot } from './MetricsCollector';
import { MCPHealthMonitor } from './MCPHealthMonitor';
import { UserExperienceMonitor } from './UserExperienceMonitor';
import { PerformanceMonitor } from './PerformanceMonitor';
import { AlertManager, AlertStatistics } from './AlertManager';

export interface DashboardConfig {
  refreshInterval: number; // milliseconds
  dataRetentionHours: number;
  enableRealTime: boolean;
  widgets: DashboardWidget[];
}

export interface DashboardWidget {
  id: string;
  type: 'metric' | 'chart' | 'table' | 'alert' | 'status';
  title: string;
  position: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  config: VisualizationConfig;
  refreshInterval?: number; // Override default refresh
}

export interface VisualizationConfig {
  dataSource: string;
  visualization: {
    type: 'line' | 'bar' | 'pie' | 'gauge' | 'number' | 'status' | 'heatmap';
    options: Record<string, any>;
  };
  query: {
    metric?: string;
    timeRange?: string;
    aggregation?: 'sum' | 'avg' | 'max' | 'min' | 'count';
    groupBy?: string[];
    filters?: Record<string, any>;
  };
  thresholds?: {
    warning: number;
    critical: number;
  };
}

export interface RealTimeData {
  timestamp: Date;
  metrics: Record<string, number>;
  alerts: any[];
  systemHealth: {
    overall: number; // 0-100
    components: Record<string, number>;
  };
  userExperience: {
    satisfaction: number;
    errorImpact: string;
    activeUsers: number;
  };
  performance: {
    responseTime: number;
    throughput: number;
    errorRate: number;
  };
}

export interface DashboardData {
  overview: {
    systemHealth: number;
    totalErrors: number;
    avgResponseTime: number;
    activeUsers: number;
    mcpServersOnline: number;
  };
  charts: {
    errorTrend: Array<{ timestamp: Date; value: number }>;
    responseTimes: Array<{ timestamp: Date; p50: number; p95: number; p99: number }>;
    userSatisfaction: Array<{ timestamp: Date; score: number }>;
    resourceUtilization: Array<{ timestamp: Date; cpu: number; memory: number }>;
  };
  alerts: AlertStatistics;
  topErrors: Array<{
    category: string;
    count: number;
    lastOccurrence: Date;
  }>;
  mcpServerStatus: Array<{
    serverId: string;
    status: string;
    responseTime: number;
    availability: number;
  }>;
  userImpact: {
    highRiskUsers: number;
    avgSatisfaction: number;
    taskCompletionRate: number;
  };
}

/**
 * Provides dashboard data and real-time updates for monitoring interfaces
 */
export class DashboardProvider extends EventEmitter {
  private realTimeData: RealTimeData;
  private historicalData: Map<string, any[]> = new Map();
  private widgetData: Map<string, any> = new Map();
  private refreshTimers: Map<string, NodeJS.Timeout> = new Map();
  private isEnabled: boolean = false;

  constructor(
    private metricsCollector: MetricsCollector,
    private mcpHealthMonitor: MCPHealthMonitor,
    private userExperienceMonitor: UserExperienceMonitor,
    private performanceMonitor: PerformanceMonitor,
    private alertManager: AlertManager,
    private config: DashboardConfig = {
      refreshInterval: 5000, // 5 seconds
      dataRetentionHours: 24,
      enableRealTime: true,
      widgets: []
    }
  ) {
    super();
    this.realTimeData = this.createInitialRealTimeData();
    this.setupEventListeners();
  }

  /**
   * Start dashboard data collection and real-time updates
   */
  start(): void {
    if (this.isEnabled) {
      throw new Error('Dashboard provider is already running');
    }

    this.isEnabled = true;

    // Start real-time data updates
    if (this.config.enableRealTime) {
      this.startRealTimeUpdates();
    }

    // Start widget refresh timers
    this.config.widgets.forEach(widget => {
      this.startWidgetRefresh(widget);
    });

    this.emit('dashboard:started');
  }

  /**
   * Stop dashboard data collection
   */
  stop(): void {
    if (!this.isEnabled) {
      return;
    }

    this.isEnabled = false;

    // Clear all timers
    this.refreshTimers.forEach(timer => clearInterval(timer));
    this.refreshTimers.clear();

    this.emit('dashboard:stopped');
  }

  /**
   * Get current dashboard data snapshot
   */
  getDashboardData(): DashboardData {
    const metricsSnapshot = this.metricsCollector.getSnapshot();
    const mcpHealthSummary = this.mcpHealthMonitor.getHealthSummary();
    const uxSummary = this.userExperienceMonitor.getUXSummary();
    const alertStats = this.alertManager.getAlertStatistics();

    return {
      overview: {
        systemHealth: metricsSnapshot.summary.systemHealth,
        totalErrors: metricsSnapshot.summary.totalErrors,
        avgResponseTime: metricsSnapshot.summary.avgResponseTime,
        activeUsers: uxSummary.activeUsers,
        mcpServersOnline: mcpHealthSummary.healthyServers
      },
      charts: {
        errorTrend: this.getErrorTrendData(),
        responseTimes: this.getResponseTimeData(),
        userSatisfaction: this.getUserSatisfactionData(),
        resourceUtilization: this.getResourceUtilizationData()
      },
      alerts: alertStats,
      topErrors: this.getTopErrorsData(metricsSnapshot),
      mcpServerStatus: this.getMCPServerStatusData(),
      userImpact: {
        highRiskUsers: uxSummary.highRiskUsers,
        avgSatisfaction: uxSummary.avgSatisfactionScore,
        taskCompletionRate: uxSummary.taskCompletionRate
      }
    };
  }

  /**
   * Get real-time data stream
   */
  getRealTimeData(): RealTimeData {
    return { ...this.realTimeData };
  }

  /**
   * Get data for a specific widget
   */
  getWidgetData(widgetId: string): any {
    return this.widgetData.get(widgetId);
  }

  /**
   * Update widget configuration
   */
  updateWidget(widget: DashboardWidget): void {
    // Stop existing refresh timer
    const existingTimer = this.refreshTimers.get(widget.id);
    if (existingTimer) {
      clearInterval(existingTimer);
    }

    // Update widget in config
    const index = this.config.widgets.findIndex(w => w.id === widget.id);
    if (index >= 0) {
      this.config.widgets[index] = widget;
    } else {
      this.config.widgets.push(widget);
    }

    // Start new refresh timer if enabled
    if (this.isEnabled) {
      this.startWidgetRefresh(widget);
    }

    this.emit('widget:updated', widget);
  }

  /**
   * Remove a widget
   */
  removeWidget(widgetId: string): void {
    // Stop refresh timer
    const timer = this.refreshTimers.get(widgetId);
    if (timer) {
      clearInterval(timer);
      this.refreshTimers.delete(widgetId);
    }

    // Remove from config
    this.config.widgets = this.config.widgets.filter(w => w.id !== widgetId);
    this.widgetData.delete(widgetId);

    this.emit('widget:removed', widgetId);
  }

  /**
   * Get historical data for a metric
   */
  getHistoricalData(
    metric: string,
    timeRange: { start: Date; end: Date },
    aggregation: 'sum' | 'avg' | 'max' | 'min' | 'count' = 'avg'
  ): Array<{ timestamp: Date; value: number }> {
    const metrics = this.metricsCollector.query({
      timeRange,
      category: metric as any
    });

    // Group by time intervals (e.g., 5-minute buckets)
    const bucketSize = 5 * 60 * 1000; // 5 minutes
    const buckets = new Map<number, number[]>();

    metrics.forEach(metric => {
      const bucketKey = Math.floor(metric.timestamp.getTime() / bucketSize) * bucketSize;
      const values = buckets.get(bucketKey) || [];
      values.push(metric.value);
      buckets.set(bucketKey, values);
    });

    // Aggregate values in each bucket
    const result: Array<{ timestamp: Date; value: number }> = [];
    buckets.forEach((values, bucketKey) => {
      let aggregatedValue: number;
      
      switch (aggregation) {
        case 'sum':
          aggregatedValue = values.reduce((sum, val) => sum + val, 0);
          break;
        case 'max':
          aggregatedValue = Math.max(...values);
          break;
        case 'min':
          aggregatedValue = Math.min(...values);
          break;
        case 'count':
          aggregatedValue = values.length;
          break;
        case 'avg':
        default:
          aggregatedValue = values.reduce((sum, val) => sum + val, 0) / values.length;
          break;
      }

      result.push({
        timestamp: new Date(bucketKey),
        value: aggregatedValue
      });
    });

    return result.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  /**
   * Export dashboard configuration
   */
  exportConfig(): DashboardConfig {
    return JSON.parse(JSON.stringify(this.config));
  }

  /**
   * Import dashboard configuration
   */
  importConfig(config: DashboardConfig): void {
    this.stop();
    this.config = config;
    this.widgetData.clear();
    
    if (this.isEnabled) {
      this.start();
    }

    this.emit('config:imported', config);
  }

  private createInitialRealTimeData(): RealTimeData {
    return {
      timestamp: new Date(),
      metrics: {},
      alerts: [],
      systemHealth: {
        overall: 100,
        components: {
          mcp_servers: 100,
          error_handling: 100,
          user_experience: 100,
          performance: 100
        }
      },
      userExperience: {
        satisfaction: 5,
        errorImpact: 'none',
        activeUsers: 0
      },
      performance: {
        responseTime: 0,
        throughput: 0,
        errorRate: 0
      }
    };
  }

  private setupEventListeners(): void {
    // Listen for metric updates
    this.metricsCollector.on('metric:recorded', (metric) => {
      this.updateRealTimeMetric(metric.name, metric.value);
    });

    // Listen for alert updates
    this.alertManager.on('alert:created', (alert) => {
      this.updateRealTimeAlerts();
    });

    this.alertManager.on('alert:resolved', (alert) => {
      this.updateRealTimeAlerts();
    });

    // Listen for health updates
    this.mcpHealthMonitor.on('server:status_changed', () => {
      this.updateSystemHealth();
    });

    // Listen for UX updates
    this.userExperienceMonitor.on('ux:cleanup_completed', () => {
      this.updateUserExperienceData();
    });
  }

  private startRealTimeUpdates(): void {
    const interval = setInterval(() => {
      this.updateRealTimeData();
      this.emit('realtime:updated', this.realTimeData);
    }, this.config.refreshInterval);

    this.refreshTimers.set('realtime', interval);
  }

  private startWidgetRefresh(widget: DashboardWidget): void {
    const refreshInterval = widget.refreshInterval || this.config.refreshInterval;
    
    const timer = setInterval(() => {
      this.refreshWidget(widget);
    }, refreshInterval);

    this.refreshTimers.set(widget.id, timer);

    // Initial refresh
    this.refreshWidget(widget);
  }

  private refreshWidget(widget: DashboardWidget): void {
    try {
      const data = this.generateWidgetData(widget);
      this.widgetData.set(widget.id, data);
      this.emit('widget:refreshed', { widget, data });
    } catch (error) {
      this.emit('widget:error', { widget, error });
    }
  }

  private generateWidgetData(widget: DashboardWidget): any {
    const { config } = widget;
    
    switch (config.dataSource) {
      case 'metrics':
        return this.generateMetricsWidgetData(config);
      case 'alerts':
        return this.generateAlertsWidgetData(config);
      case 'mcp_health':
        return this.generateMCPHealthWidgetData(config);
      case 'user_experience':
        return this.generateUXWidgetData(config);
      case 'performance':
        return this.generatePerformanceWidgetData(config);
      default:
        return null;
    }
  }

  private generateMetricsWidgetData(config: VisualizationConfig): any {
    const timeRange = this.parseTimeRange(config.query.timeRange || '1h');
    const metrics = this.metricsCollector.query({
      timeRange,
      category: config.query.metric as any
    });

    switch (config.visualization.type) {
      case 'number':
        return {
          value: metrics.reduce((sum, m) => sum + m.value, 0),
          timestamp: new Date()
        };
      case 'line':
        return this.getHistoricalData(
          config.query.metric || 'error',
          timeRange,
          config.query.aggregation
        );
      default:
        return metrics;
    }
  }

  private generateAlertsWidgetData(config: VisualizationConfig): any {
    const stats = this.alertManager.getAlertStatistics();
    
    switch (config.visualization.type) {
      case 'number':
        return { value: stats.active, timestamp: new Date() };
      case 'pie':
        return Object.entries(stats.bySeverity).map(([severity, count]) => ({
          name: severity,
          value: count
        }));
      default:
        return stats;
    }
  }

  private generateMCPHealthWidgetData(config: VisualizationConfig): any {
    const summary = this.mcpHealthMonitor.getHealthSummary();
    
    switch (config.visualization.type) {
      case 'gauge':
        return { value: summary.overallHealthScore, max: 100 };
      case 'status':
        return {
          status: summary.overallHealthScore > 80 ? 'healthy' : 'degraded',
          servers: summary
        };
      default:
        return summary;
    }
  }

  private generateUXWidgetData(config: VisualizationConfig): any {
    const summary = this.userExperienceMonitor.getUXSummary();
    
    switch (config.visualization.type) {
      case 'number':
        return { value: summary.avgSatisfactionScore, timestamp: new Date() };
      case 'gauge':
        return { value: summary.avgSatisfactionScore, max: 5 };
      default:
        return summary;
    }
  }

  private generatePerformanceWidgetData(config: VisualizationConfig): any {
    const snapshot = this.performanceMonitor.getCurrentSnapshot();
    
    switch (config.visualization.type) {
      case 'number':
        return { value: snapshot.operations.averageResponseTime, timestamp: new Date() };
      case 'gauge':
        return { value: snapshot.cpu.usage, max: 100 };
      default:
        return snapshot;
    }
  }

  private updateRealTimeData(): void {
    this.realTimeData.timestamp = new Date();
    this.updateSystemHealth();
    this.updateUserExperienceData();
    this.updatePerformanceData();
    this.updateRealTimeAlerts();
  }

  private updateRealTimeMetric(name: string, value: number): void {
    this.realTimeData.metrics[name] = value;
  }

  private updateSystemHealth(): void {
    const mcpHealth = this.mcpHealthMonitor.getHealthSummary();
    const alertStats = this.alertManager.getAlertStatistics();
    
    // Calculate component health scores
    this.realTimeData.systemHealth.components.mcp_servers = mcpHealth.overallHealthScore;
    this.realTimeData.systemHealth.components.error_handling = alertStats.active === 0 ? 100 : Math.max(0, 100 - (alertStats.active * 10));
    
    // Calculate overall health
    const componentScores = Object.values(this.realTimeData.systemHealth.components);
    this.realTimeData.systemHealth.overall = componentScores.reduce((sum, score) => sum + score, 0) / componentScores.length;
  }

  private updateUserExperienceData(): void {
    const uxSummary = this.userExperienceMonitor.getUXSummary();
    
    this.realTimeData.userExperience = {
      satisfaction: uxSummary.avgSatisfactionScore,
      errorImpact: this.calculateErrorImpactLevel(uxSummary.errorImpactDistribution),
      activeUsers: uxSummary.activeUsers
    };
  }

  private updatePerformanceData(): void {
    const snapshot = this.performanceMonitor.getCurrentSnapshot();
    
    this.realTimeData.performance = {
      responseTime: snapshot.operations.averageResponseTime,
      throughput: snapshot.operations.totalRequests,
      errorRate: snapshot.operations.failedRequests / Math.max(1, snapshot.operations.totalRequests) * 100
    };
  }

  private updateRealTimeAlerts(): void {
    this.realTimeData.alerts = this.alertManager.getActiveAlerts().slice(0, 10); // Latest 10 alerts
  }

  private getErrorTrendData(): Array<{ timestamp: Date; value: number }> {
    const timeRange = {
      start: new Date(Date.now() - (24 * 60 * 60 * 1000)), // Last 24 hours
      end: new Date()
    };
    return this.getHistoricalData('error', timeRange, 'count');
  }

  private getResponseTimeData(): Array<{ timestamp: Date; p50: number; p95: number; p99: number }> {
    // This would be implemented with actual performance data
    return [];
  }

  private getUserSatisfactionData(): Array<{ timestamp: Date; score: number }> {
    // This would be implemented with actual UX data
    return [];
  }

  private getResourceUtilizationData(): Array<{ timestamp: Date; cpu: number; memory: number }> {
    const history = this.performanceMonitor.getPerformanceHistory(24); // Last 24 snapshots
    return history.map(snapshot => ({
      timestamp: snapshot.timestamp,
      cpu: snapshot.cpu.usage,
      memory: (snapshot.memory.used / snapshot.memory.total) * 100
    }));
  }

  private getTopErrorsData(snapshot: MetricsSnapshot): Array<{ category: string; count: number; lastOccurrence: Date }> {
    return Object.entries(snapshot.summary.errorsByCategory)
      .map(([category, count]) => ({
        category,
        count,
        lastOccurrence: new Date() // Would be actual last occurrence
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }

  private getMCPServerStatusData(): Array<{ serverId: string; status: string; responseTime: number; availability: number }> {
    return this.mcpHealthMonitor.getAllServersHealth().map(health => ({
      serverId: health.serverId,
      status: health.status,
      responseTime: health.responseTime,
      availability: health.availability
    }));
  }

  private calculateErrorImpactLevel(distribution: any): string {
    if (distribution.critical > 0) return 'critical';
    if (distribution.significant > 0) return 'significant';
    if (distribution.moderate > 0) return 'moderate';
    if (distribution.minimal > 0) return 'minimal';
    return 'none';
  }

  private parseTimeRange(timeRange: string): { start: Date; end: Date } {
    const now = new Date();
    let start: Date;

    if (timeRange.endsWith('h')) {
      const hours = parseInt(timeRange.slice(0, -1));
      start = new Date(now.getTime() - (hours * 60 * 60 * 1000));
    } else if (timeRange.endsWith('d')) {
      const days = parseInt(timeRange.slice(0, -1));
      start = new Date(now.getTime() - (days * 24 * 60 * 60 * 1000));
    } else if (timeRange.endsWith('m')) {
      const minutes = parseInt(timeRange.slice(0, -1));
      start = new Date(now.getTime() - (minutes * 60 * 1000));
    } else {
      start = new Date(now.getTime() - (60 * 60 * 1000)); // Default 1 hour
    }

    return { start, end: now };
  }
}