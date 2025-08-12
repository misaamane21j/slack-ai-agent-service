/**
 * Metrics Collection System
 * Categorizes metrics by tool type, operation, and severity for comprehensive error tracking
 */

import { EventEmitter } from 'events';
import { ErrorSeverity, ErrorCategory } from '../errors/types';

export enum MetricCategory {
  ERROR = 'error',
  PERFORMANCE = 'performance',
  USER_EXPERIENCE = 'user_experience',
  MCP_HEALTH = 'mcp_health',
  SYSTEM = 'system'
}

export enum MetricType {
  COUNTER = 'counter',
  GAUGE = 'gauge',
  HISTOGRAM = 'histogram',
  TIMER = 'timer'
}

export interface Metric {
  id: string;
  category: MetricCategory;
  type: MetricType;
  name: string;
  value: number;
  tags: Record<string, string>;
  timestamp: Date;
  context?: Record<string, any>;
}

export interface MetricsSnapshot {
  timestamp: Date;
  metrics: Metric[];
  summary: {
    totalErrors: number;
    errorsByCategory: Record<ErrorCategory, number>;
    errorsBySeverity: Record<ErrorSeverity, number>;
    avgResponseTime: number;
    systemHealth: number; // 0-100 score
  };
}

export interface MetricsQuery {
  category?: MetricCategory;
  type?: MetricType;
  timeRange?: {
    start: Date;
    end: Date;
  };
  tags?: Record<string, string>;
  limit?: number;
}

export interface MetricsFilter {
  includeCategories?: MetricCategory[];
  excludeCategories?: MetricCategory[];
  minSeverity?: ErrorSeverity;
  timeWindow?: number; // minutes
}

/**
 * Central metrics collection and aggregation system
 */
export class MetricsCollector extends EventEmitter {
  private metrics: Map<string, Metric> = new Map();
  private aggregatedData: Map<string, number> = new Map();
  private retentionPeriodMs: number;
  private cleanupIntervalId?: NodeJS.Timeout;

  constructor(
    private config: {
      retentionDays?: number;
      aggregationInterval?: number; // minutes
      maxMetrics?: number;
    } = {}
  ) {
    super();
    this.retentionPeriodMs = (config.retentionDays || 7) * 24 * 60 * 60 * 1000;
    this.startCleanupJob();
    this.startAggregationJob();
  }

  /**
   * Record a new metric
   */
  record(metric: Omit<Metric, 'id' | 'timestamp'>): void {
    const fullMetric: Metric = {
      ...metric,
      id: this.generateMetricId(metric),
      timestamp: new Date()
    };

    this.metrics.set(fullMetric.id, fullMetric);
    this.updateAggregations(fullMetric);
    this.emit('metric:recorded', fullMetric);

    // Check if cleanup is needed
    if (this.metrics.size > (this.config.maxMetrics || 10000)) {
      this.cleanup();
    }
  }

  /**
   * Record error metric with rich context
   */
  recordError(error: {
    category: ErrorCategory;
    severity: ErrorSeverity;
    toolType?: string;
    operation?: string;
    userId?: string;
    context?: Record<string, any>;
  }): void {
    this.record({
      category: MetricCategory.ERROR,
      type: MetricType.COUNTER,
      name: 'error_count',
      value: 1,
      tags: {
        error_category: error.category,
        error_severity: error.severity,
        tool_type: error.toolType || 'unknown',
        operation: error.operation || 'unknown',
        user_id: error.userId || 'anonymous'
      },
      context: error.context
    });
  }

  /**
   * Record performance metric
   */
  recordPerformance(metric: {
    operation: string;
    duration: number;
    toolType?: string;
    success: boolean;
    context?: Record<string, any>;
  }): void {
    this.record({
      category: MetricCategory.PERFORMANCE,
      type: MetricType.TIMER,
      name: 'operation_duration',
      value: metric.duration,
      tags: {
        operation: metric.operation,
        tool_type: metric.toolType || 'unknown',
        success: metric.success.toString()
      },
      context: metric.context
    });
  }

  /**
   * Record user experience metric
   */
  recordUserExperience(metric: {
    userId: string;
    interaction: string;
    satisfaction?: number; // 1-5 scale
    responseTime?: number;
    errorEncountered?: boolean;
    context?: Record<string, any>;
  }): void {
    this.record({
      category: MetricCategory.USER_EXPERIENCE,
      type: MetricType.GAUGE,
      name: 'user_interaction',
      value: metric.satisfaction || 0,
      tags: {
        user_id: metric.userId,
        interaction: metric.interaction,
        error_encountered: (metric.errorEncountered || false).toString()
      },
      context: {
        ...metric.context,
        response_time: metric.responseTime
      }
    });
  }

  /**
   * Record MCP server health metric
   */
  recordMCPHealth(metric: {
    serverId: string;
    status: 'healthy' | 'degraded' | 'unhealthy';
    responseTime?: number;
    errorRate?: number;
    availability?: number;
    context?: Record<string, any>;
  }): void {
    this.record({
      category: MetricCategory.MCP_HEALTH,
      type: MetricType.GAUGE,
      name: 'mcp_server_health',
      value: metric.availability || 0,
      tags: {
        server_id: metric.serverId,
        status: metric.status
      },
      context: {
        ...metric.context,
        response_time: metric.responseTime,
        error_rate: metric.errorRate
      }
    });
  }

  /**
   * Query metrics based on filters
   */
  query(query: MetricsQuery): Metric[] {
    let filteredMetrics = Array.from(this.metrics.values());

    if (query.category) {
      filteredMetrics = filteredMetrics.filter(m => m.category === query.category);
    }

    if (query.type) {
      filteredMetrics = filteredMetrics.filter(m => m.type === query.type);
    }

    if (query.timeRange) {
      filteredMetrics = filteredMetrics.filter(m => 
        m.timestamp >= query.timeRange!.start && 
        m.timestamp <= query.timeRange!.end
      );
    }

    if (query.tags) {
      filteredMetrics = filteredMetrics.filter(m => {
        return Object.entries(query.tags!).every(([key, value]) => 
          m.tags[key] === value
        );
      });
    }

    // Sort by timestamp (newest first)
    filteredMetrics.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    if (query.limit) {
      filteredMetrics = filteredMetrics.slice(0, query.limit);
    }

    return filteredMetrics;
  }

  /**
   * Get current metrics snapshot
   */
  getSnapshot(filter?: MetricsFilter): MetricsSnapshot {
    const now = new Date();
    const timeWindow = filter?.timeWindow || 60; // Default 1 hour
    const startTime = new Date(now.getTime() - (timeWindow * 60 * 1000));

    let metrics = this.query({
      timeRange: { start: startTime, end: now }
    });

    // Apply filters
    if (filter) {
      if (filter.includeCategories) {
        metrics = metrics.filter(m => filter.includeCategories!.includes(m.category));
      }
      if (filter.excludeCategories) {
        metrics = metrics.filter(m => !filter.excludeCategories!.includes(m.category));
      }
    }

    // Calculate summary
    const errorMetrics = metrics.filter(m => m.category === MetricCategory.ERROR);
    const performanceMetrics = metrics.filter(m => m.category === MetricCategory.PERFORMANCE);

    const errorsByCategory = errorMetrics.reduce((acc, metric) => {
      const category = metric.tags.error_category as ErrorCategory;
      acc[category] = (acc[category] || 0) + metric.value;
      return acc;
    }, {} as Record<ErrorCategory, number>);

    const errorsBySeverity = errorMetrics.reduce((acc, metric) => {
      const severity = metric.tags.error_severity as ErrorSeverity;
      acc[severity] = (acc[severity] || 0) + metric.value;
      return acc;
    }, {} as Record<ErrorSeverity, number>);

    const avgResponseTime = performanceMetrics.length > 0
      ? performanceMetrics.reduce((sum, m) => sum + m.value, 0) / performanceMetrics.length
      : 0;

    const systemHealth = this.calculateSystemHealth(metrics);

    return {
      timestamp: now,
      metrics,
      summary: {
        totalErrors: errorMetrics.reduce((sum, m) => sum + m.value, 0),
        errorsByCategory,
        errorsBySeverity,
        avgResponseTime,
        systemHealth
      }
    };
  }

  /**
   * Get aggregated data for a specific key
   */
  getAggregatedValue(key: string): number {
    return this.aggregatedData.get(key) || 0;
  }

  /**
   * Clear all metrics (for testing)
   */
  clear(): void {
    this.metrics.clear();
    this.aggregatedData.clear();
    this.emit('metrics:cleared');
  }

  /**
   * Stop the collector and cleanup resources
   */
  destroy(): void {
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
    }
    this.removeAllListeners();
    this.clear();
  }

  private generateMetricId(metric: Omit<Metric, 'id' | 'timestamp'>): string {
    const timestamp = Date.now();
    const hash = this.simpleHash(JSON.stringify({
      category: metric.category,
      type: metric.type,
      name: metric.name,
      tags: metric.tags
    }));
    return `${metric.category}_${metric.type}_${hash}_${timestamp}`;
  }

  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16);
  }

  private updateAggregations(metric: Metric): void {
    // Update aggregated counters
    const key = `${metric.category}.${metric.name}`;
    const currentValue = this.aggregatedData.get(key) || 0;
    
    if (metric.type === MetricType.COUNTER) {
      this.aggregatedData.set(key, currentValue + metric.value);
    } else if (metric.type === MetricType.GAUGE) {
      this.aggregatedData.set(key, metric.value);
    }

    // Update tag-based aggregations
    Object.entries(metric.tags).forEach(([tagKey, tagValue]) => {
      const taggedKey = `${key}.${tagKey}:${tagValue}`;
      const taggedValue = this.aggregatedData.get(taggedKey) || 0;
      this.aggregatedData.set(taggedKey, taggedValue + metric.value);
    });
  }

  private calculateSystemHealth(metrics: Metric[]): number {
    // Simple health calculation based on error rates and performance
    const errorCount = metrics.filter(m => m.category === MetricCategory.ERROR).length;
    const totalMetrics = metrics.length;
    
    if (totalMetrics === 0) return 100;
    
    const errorRate = errorCount / totalMetrics;
    const healthScore = Math.max(0, 100 - (errorRate * 100));
    
    return Math.round(healthScore);
  }

  private startCleanupJob(): void {
    // Run cleanup every hour
    this.cleanupIntervalId = setInterval(() => {
      this.cleanup();
    }, 60 * 60 * 1000);
  }

  private startAggregationJob(): void {
    // Update aggregations every minute
    setInterval(() => {
      this.emit('metrics:aggregated', this.aggregatedData);
    }, (this.config.aggregationInterval || 1) * 60 * 1000);
  }

  private cleanup(): void {
    const cutoff = new Date(Date.now() - this.retentionPeriodMs);
    let cleanedCount = 0;

    Array.from(this.metrics.entries()).forEach(([id, metric]) => {
      if (metric.timestamp < cutoff) {
        this.metrics.delete(id);
        cleanedCount++;
      }
    });

    if (cleanedCount > 0) {
      this.emit('metrics:cleaned', { count: cleanedCount });
    }
  }
}