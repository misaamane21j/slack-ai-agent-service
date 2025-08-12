/**
 * Integration tests for MonitoringOrchestrator
 */

import { MonitoringOrchestrator } from '../../../src/monitoring/MonitoringOrchestrator';
import { ErrorCategory, ErrorSeverity } from '../../../src/errors/types';

describe('MonitoringOrchestrator Integration', () => {
  let monitoring: MonitoringOrchestrator;

  beforeEach(async () => {
    monitoring = new MonitoringOrchestrator({
      enabled: true,
      components: {
        metrics: true,
        mcpHealth: true,
        userExperience: true,
        performance: true,
        alerts: true,
        dashboard: false // Disable dashboard for testing
      },
      mcpServers: ['jenkins-server', 'ai-server'],
      alerting: {
        enabled: true,
        channels: ['test']
      },
      dashboard: {
        enabled: false
      }
    });
  });

  afterEach(async () => {
    await monitoring.stop();
  });

  describe('Lifecycle Management', () => {
    it('should initialize and start all components', async () => {
      await monitoring.initialize();
      await monitoring.start();

      const health = monitoring.getHealthStatus();
      expect(health.components.metrics).toBe('healthy');
      expect(health.components.mcpServers).toBe('healthy');
    });

    it('should handle start/stop cycles', async () => {
      await monitoring.initialize();
      await monitoring.start();
      await monitoring.stop();
      
      // Should be able to start again
      await monitoring.start();
      expect(monitoring.getHealthStatus()).toBeDefined();
    });
  });

  describe('Error Recording and Monitoring', () => {
    beforeEach(async () => {
      await monitoring.initialize();
      await monitoring.start();
    });

    it('should record errors across all monitoring components', () => {
      const error = {
        category: ErrorCategory.MCP_TOOL,
        severity: ErrorSeverity.HIGH,
        message: 'Jenkins job failed',
        userId: 'user123',
        sessionId: 'session456',
        operation: 'trigger_job',
        context: {
          toolType: 'jenkins',
          jobName: 'test-deployment',
          recoverable: false
        }
      };

      monitoring.recordError(error);

      const snapshot = monitoring.getSnapshot();
      expect(snapshot.metrics.totalErrors).toBeGreaterThan(0);
      expect(snapshot.metrics.errorRate).toBeGreaterThan(0);
    });

    it('should trigger alerts for critical errors', (done) => {
      monitoring.on('alert:created', (alert) => {
        expect(alert.severity).toBe('critical');
        expect(alert.type).toBeDefined();
        done();
      });

      // Record multiple critical errors to trigger alert
      for (let i = 0; i < 15; i++) {
        monitoring.recordError({
          category: ErrorCategory.MCP_TOOL,
          severity: ErrorSeverity.CRITICAL,
          message: `Critical error ${i}`,
          operation: 'test_operation'
        });
      }
    });

    it('should measure performance impact of error recording', () => {
      const startTime = Date.now();
      
      monitoring.recordError({
        category: ErrorCategory.AI_PROCESSING,
        severity: ErrorSeverity.MEDIUM,
        message: 'AI processing timeout',
        operation: 'ai_analysis'
      });

      const endTime = Date.now();
      const processingTime = endTime - startTime;

      // Error recording should be fast (< 10ms typically)
      expect(processingTime).toBeLessThan(100);
    });
  });

  describe('Operation Performance Monitoring', () => {
    beforeEach(async () => {
      await monitoring.initialize();
      await monitoring.start();
    });

    it('should record operation metrics', () => {
      monitoring.recordOperation({
        name: 'slack_message_processing',
        duration: 1500,
        success: true,
        userId: 'user123',
        context: {
          messageLength: 100,
          toolsUsed: ['jenkins']
        }
      });

      const snapshot = monitoring.getSnapshot();
      expect(snapshot.metrics.avgResponseTime).toBeGreaterThan(0);
    });

    it('should track failed operations', () => {
      monitoring.recordOperation({
        name: 'mcp_tool_execution',
        duration: 5000,
        success: false,
        context: {
          toolName: 'jenkins',
          error: 'Connection timeout'
        }
      });

      const snapshot = monitoring.getSnapshot();
      expect(snapshot.metrics.errorRate).toBeGreaterThan(0);
    });
  });

  describe('System Health Monitoring', () => {
    beforeEach(async () => {
      await monitoring.initialize();
      await monitoring.start();
    });

    it('should provide comprehensive health status', () => {
      const health = monitoring.getHealthStatus();
      
      expect(health.overall).toMatch(/healthy|degraded|unhealthy|critical/);
      expect(health.score).toBeGreaterThanOrEqual(0);
      expect(health.score).toBeLessThanOrEqual(100);
      expect(health.components).toHaveProperty('metrics');
      expect(health.components).toHaveProperty('mcpServers');
      expect(health.components).toHaveProperty('userExperience');
      expect(health.components).toHaveProperty('performance');
    });

    it('should detect system degradation', () => {
      // Simulate system stress
      for (let i = 0; i < 50; i++) {
        monitoring.recordError({
          category: ErrorCategory.SYSTEM,
          severity: ErrorSeverity.HIGH,
          message: `System error ${i}`,
          operation: 'system_operation'
        });
      }

      const health = monitoring.getHealthStatus();
      expect(health.overall).toMatch(/degraded|unhealthy|critical/);
      expect(health.score).toBeLessThan(80);
    });

    it('should emit health check events', (done) => {
      monitoring.on('health:check', (health) => {
        expect(health.overall).toBeDefined();
        expect(health.score).toBeDefined();
        expect(health.components).toBeDefined();
        done();
      });

      // Health checks run every 30 seconds, but we can trigger manually
      // In real testing, we'd wait or use test timers
    });
  });

  describe('Metrics Export', () => {
    beforeEach(async () => {
      await monitoring.initialize();
      await monitoring.start();
    });

    it('should export metrics for external systems', () => {
      // Add some test data
      monitoring.recordError({
        category: ErrorCategory.MCP_TOOL,
        severity: ErrorSeverity.MEDIUM,
        message: 'Test error',
        operation: 'test'
      });

      monitoring.recordOperation({
        name: 'test_operation',
        duration: 1000,
        success: true
      });

      const exportedMetrics = monitoring.getMetricsForExport();
      
      expect(exportedMetrics).toHaveProperty('system.health.overall');
      expect(exportedMetrics).toHaveProperty('errors.total');
      expect(exportedMetrics).toHaveProperty('response_time.avg');
      expect(exportedMetrics['system.health.overall']).toBeGreaterThan(0);
    });
  });

  describe('Configuration Updates', () => {
    beforeEach(async () => {
      await monitoring.initialize();
      await monitoring.start();
    });

    it('should handle configuration changes', (done) => {
      monitoring.on('config:updated', (event) => {
        expect(event.current.mcpServers).toContain('new-server');
        done();
      });

      monitoring.updateConfig({
        mcpServers: ['jenkins-server', 'ai-server', 'new-server']
      });
    });

    it('should reconfigure MCP monitoring on server list changes', (done) => {
      monitoring.on('mcp:status_changed', (event) => {
        // This would be triggered when new servers are added
        done();
      });

      monitoring.updateConfig({
        mcpServers: ['new-jenkins-server']
      });
    });
  });
});