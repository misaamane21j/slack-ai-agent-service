/**
 * Unit tests for MetricsCollector
 */

import { MetricsCollector, MetricCategory, MetricType } from '../../../src/monitoring/MetricsCollector';
import { ErrorSeverity, ErrorCategory } from '../../../src/errors/types';

describe('MetricsCollector', () => {
  let metricsCollector: MetricsCollector;

  beforeEach(() => {
    metricsCollector = new MetricsCollector({
      retentionDays: 1,
      aggregationInterval: 1,
      maxMetrics: 100
    });
  });

  afterEach(() => {
    metricsCollector.destroy();
  });

  describe('record', () => {
    it('should record a metric with generated ID and timestamp', () => {
      const metric = {
        category: MetricCategory.ERROR,
        type: MetricType.COUNTER,
        name: 'test_error',
        value: 1,
        tags: { test: 'true' }
      };

      metricsCollector.record(metric);
      
      const snapshot = metricsCollector.getSnapshot();
      expect(snapshot.metrics).toHaveLength(1);
      expect(snapshot.metrics[0]).toMatchObject(metric);
      expect(snapshot.metrics[0].id).toBeDefined();
      expect(snapshot.metrics[0].timestamp).toBeDefined();
    });

    it('should emit metric:recorded event', (done) => {
      metricsCollector.on('metric:recorded', (metric) => {
        expect(metric.name).toBe('test_metric');
        done();
      });

      metricsCollector.record({
        category: MetricCategory.PERFORMANCE,
        type: MetricType.GAUGE,
        name: 'test_metric',
        value: 100,
        tags: {}
      });
    });
  });

  describe('recordError', () => {
    it('should record error metrics with proper categorization', () => {
      metricsCollector.recordError({
        category: ErrorCategory.MCP_TOOL,
        severity: ErrorSeverity.HIGH,
        toolType: 'jenkins',
        operation: 'trigger_job',
        userId: 'user123',
        context: { jobName: 'test-job' }
      });

      const snapshot = metricsCollector.getSnapshot();
      expect(snapshot.summary.totalErrors).toBe(1);
      expect(snapshot.summary.errorsBySeverity[ErrorSeverity.HIGH]).toBe(1);
      expect(snapshot.summary.errorsByCategory[ErrorCategory.MCP_TOOL]).toBe(1);
    });
  });

  describe('recordPerformance', () => {
    it('should record performance metrics', () => {
      metricsCollector.recordPerformance({
        operation: 'ai_processing',
        duration: 1500,
        toolType: 'jenkins',
        success: true,
        context: { tokens: 100 }
      });

      const metrics = metricsCollector.query({
        category: MetricCategory.PERFORMANCE,
        type: MetricType.TIMER
      });

      expect(metrics).toHaveLength(1);
      expect(metrics[0].value).toBe(1500);
      expect(metrics[0].tags.operation).toBe('ai_processing');
      expect(metrics[0].tags.success).toBe('true');
    });
  });

  describe('query', () => {
    beforeEach(() => {
      // Add test metrics
      metricsCollector.record({
        category: MetricCategory.ERROR,
        type: MetricType.COUNTER,
        name: 'error_count',
        value: 1,
        tags: { severity: 'high' }
      });
      
      metricsCollector.record({
        category: MetricCategory.PERFORMANCE,
        type: MetricType.TIMER,
        name: 'response_time',
        value: 500,
        tags: { operation: 'test' }
      });
    });

    it('should filter metrics by category', () => {
      const errorMetrics = metricsCollector.query({
        category: MetricCategory.ERROR
      });
      
      expect(errorMetrics).toHaveLength(1);
      expect(errorMetrics[0].category).toBe(MetricCategory.ERROR);
    });

    it('should filter metrics by type', () => {
      const timerMetrics = metricsCollector.query({
        type: MetricType.TIMER
      });
      
      expect(timerMetrics).toHaveLength(1);
      expect(timerMetrics[0].type).toBe(MetricType.TIMER);
    });

    it('should filter metrics by tags', () => {
      const highSeverityMetrics = metricsCollector.query({
        tags: { severity: 'high' }
      });
      
      expect(highSeverityMetrics).toHaveLength(1);
      expect(highSeverityMetrics[0].tags.severity).toBe('high');
    });

    it('should limit results', () => {
      const limitedMetrics = metricsCollector.query({
        limit: 1
      });
      
      expect(limitedMetrics).toHaveLength(1);
    });
  });

  describe('getSnapshot', () => {
    it('should calculate system health score', () => {
      // Add some error metrics
      metricsCollector.recordError({
        category: ErrorCategory.MCP_TOOL,
        severity: ErrorSeverity.LOW,
        toolType: 'test',
        operation: 'test'
      });

      const snapshot = metricsCollector.getSnapshot();
      expect(snapshot.summary.systemHealth).toBeGreaterThan(0);
      expect(snapshot.summary.systemHealth).toBeLessThanOrEqual(100);
    });

    it('should apply time window filter', () => {
      const snapshot = metricsCollector.getSnapshot({
        timeWindow: 1 // 1 minute
      });
      
      expect(snapshot.timestamp).toBeDefined();
      expect(Array.isArray(snapshot.metrics)).toBe(true);
    });
  });

  describe('cleanup', () => {
    it('should clean up old metrics', (done) => {
      metricsCollector.on('metrics:cleaned', (event) => {
        expect(event.count).toBeGreaterThan(0);
        done();
      });

      // Add metric with old timestamp
      const oldMetric = {
        category: MetricCategory.ERROR,
        type: MetricType.COUNTER,
        name: 'old_error',
        value: 1,
        tags: {},
        id: 'old_metric',
        timestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) // 2 days ago
      };

      // Access private method for testing
      (metricsCollector as any).metrics.set('old_metric', oldMetric);
      (metricsCollector as any).cleanup();
    });
  });
});