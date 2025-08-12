/**
 * Unit tests for MCPHealthMonitor
 */

import { MCPHealthMonitor, MCPServerStatus } from '../../../src/monitoring/MCPHealthMonitor';
import { MetricsCollector } from '../../../src/monitoring/MetricsCollector';

describe('MCPHealthMonitor', () => {
  let mcpHealthMonitor: MCPHealthMonitor;
  let metricsCollector: MetricsCollector;

  beforeEach(() => {
    metricsCollector = new MetricsCollector();
    mcpHealthMonitor = new MCPHealthMonitor(metricsCollector, {
      checkInterval: 1000,
      timeout: 500,
      unhealthyThreshold: 3,
      degradedThreshold: 10,
      retentionPeriod: 1
    });
  });

  afterEach(() => {
    mcpHealthMonitor.stopMonitoring();
    metricsCollector.destroy();
  });

  describe('startMonitoring', () => {
    it('should start monitoring specified servers', () => {
      const serverIds = ['jenkins-server', 'ai-server'];
      
      mcpHealthMonitor.startMonitoring(serverIds);
      
      const allHealth = mcpHealthMonitor.getAllServersHealth();
      expect(allHealth).toHaveLength(2);
      expect(allHealth.map(h => h.serverId)).toEqual(expect.arrayContaining(serverIds));
    });

    it('should emit monitoring:started event', (done) => {
      mcpHealthMonitor.on('monitoring:started', (event) => {
        expect(event.serverIds).toEqual(['test-server']);
        done();
      });

      mcpHealthMonitor.startMonitoring(['test-server']);
    });

    it('should throw error if already monitoring', () => {
      mcpHealthMonitor.startMonitoring(['test-server']);
      
      expect(() => {
        mcpHealthMonitor.startMonitoring(['another-server']);
      }).toThrow('Health monitoring is already running');
    });
  });

  describe('addServer', () => {
    beforeEach(() => {
      mcpHealthMonitor.startMonitoring([]);
    });

    it('should add new server to monitoring', () => {
      mcpHealthMonitor.addServer('new-server');
      
      const health = mcpHealthMonitor.getServerHealth('new-server');
      expect(health).toBeDefined();
      expect(health?.serverId).toBe('new-server');
      expect(health?.status).toBe(MCPServerStatus.HEALTHY);
    });

    it('should emit server:added event', (done) => {
      mcpHealthMonitor.on('server:added', (event) => {
        expect(event.serverId).toBe('new-server');
        done();
      });

      mcpHealthMonitor.addServer('new-server');
    });

    it('should throw error if server already exists', () => {
      mcpHealthMonitor.addServer('test-server');
      
      expect(() => {
        mcpHealthMonitor.addServer('test-server');
      }).toThrow('Server test-server is already being monitored');
    });
  });

  describe('recordHealthCheck', () => {
    beforeEach(() => {
      mcpHealthMonitor.startMonitoring(['test-server']);
    });

    it('should record successful health check', () => {
      const result = {
        serverId: 'test-server',
        success: true,
        responseTime: 100,
        timestamp: new Date(),
        toolsStatus: [
          { toolName: 'trigger_job', available: true, responseTime: 50 }
        ]
      };

      mcpHealthMonitor.recordHealthCheck(result);
      
      const health = mcpHealthMonitor.getServerHealth('test-server');
      expect(health?.status).toBe(MCPServerStatus.HEALTHY);
      expect(health?.responseTime).toBe(100);
      expect(health?.metrics.totalRequests).toBe(1);
      expect(health?.metrics.successfulRequests).toBe(1);
    });

    it('should record failed health check', () => {
      const result = {
        serverId: 'test-server',
        success: false,
        responseTime: 5000,
        error: 'Connection timeout',
        timestamp: new Date()
      };

      mcpHealthMonitor.recordHealthCheck(result);
      
      const health = mcpHealthMonitor.getServerHealth('test-server');
      expect(health?.consecutiveFailures).toBe(1);
      expect(health?.lastError).toBe('Connection timeout');
    });

    it('should emit server:status_changed event on status change', (done) => {
      // First make server unhealthy
      for (let i = 0; i < 5; i++) {
        mcpHealthMonitor.recordHealthCheck({
          serverId: 'test-server',
          success: false,
          responseTime: 5000,
          error: 'Timeout',
          timestamp: new Date()
        });
      }

      mcpHealthMonitor.on('server:status_changed', (event) => {
        if (event.currentStatus === MCPServerStatus.HEALTHY) {
          expect(event.serverId).toBe('test-server');
          expect(event.previousStatus).toBe(MCPServerStatus.UNREACHABLE);
          done();
        }
      });

      // Now make it healthy
      mcpHealthMonitor.recordHealthCheck({
        serverId: 'test-server',
        success: true,
        responseTime: 100,
        timestamp: new Date()
      });
    });
  });

  describe('getHealthSummary', () => {
    beforeEach(() => {
      mcpHealthMonitor.startMonitoring(['server1', 'server2', 'server3']);
    });

    it('should provide overall health summary', () => {
      // Make one server degraded
      for (let i = 0; i < 2; i++) {
        mcpHealthMonitor.recordHealthCheck({
          serverId: 'server2',
          success: false,
          responseTime: 1000,
          error: 'Slow response',
          timestamp: new Date()
        });
      }

      // Make one server unreachable
      for (let i = 0; i < 5; i++) {
        mcpHealthMonitor.recordHealthCheck({
          serverId: 'server3',
          success: false,
          responseTime: 5000,
          error: 'Connection failed',
          timestamp: new Date()
        });
      }

      const summary = mcpHealthMonitor.getHealthSummary();
      
      expect(summary.totalServers).toBe(3);
      expect(summary.healthyServers).toBe(1);
      expect(summary.unreachableServers).toBe(1);
      expect(summary.overallHealthScore).toBeLessThan(100);
    });

    it('should calculate average response time and availability', () => {
      mcpHealthMonitor.recordHealthCheck({
        serverId: 'server1',
        success: true,
        responseTime: 200,
        timestamp: new Date()
      });

      mcpHealthMonitor.recordHealthCheck({
        serverId: 'server2',
        success: true,
        responseTime: 300,
        timestamp: new Date()
      });

      const summary = mcpHealthMonitor.getHealthSummary();
      expect(summary.avgResponseTime).toBe(250);
    });
  });

  describe('hasCriticalIssues', () => {
    beforeEach(() => {
      mcpHealthMonitor.startMonitoring(['test-server']);
    });

    it('should return true when servers are unhealthy', () => {
      // Make server unreachable
      for (let i = 0; i < 5; i++) {
        mcpHealthMonitor.recordHealthCheck({
          serverId: 'test-server',
          success: false,
          responseTime: 5000,
          error: 'Connection failed',
          timestamp: new Date()
        });
      }

      expect(mcpHealthMonitor.hasCriticalIssues()).toBe(true);
    });

    it('should return false when all servers are healthy', () => {
      mcpHealthMonitor.recordHealthCheck({
        serverId: 'test-server',
        success: true,
        responseTime: 100,
        timestamp: new Date()
      });

      expect(mcpHealthMonitor.hasCriticalIssues()).toBe(false);
    });
  });
});