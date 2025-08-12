/**
 * MCP Server Health Monitoring
 * Tracks availability, performance, and health status of MCP servers
 */

import { EventEmitter } from 'events';
import { MetricsCollector } from './MetricsCollector';

export enum MCPServerStatus {
  HEALTHY = 'healthy',
  DEGRADED = 'degraded',
  UNHEALTHY = 'unhealthy',
  UNREACHABLE = 'unreachable'
}

export interface MCPServerHealth {
  serverId: string;
  status: MCPServerStatus;
  lastCheckTime: Date;
  responseTime: number;
  errorRate: number;
  availability: number; // 0-100%
  consecutiveFailures: number;
  lastError?: string;
  uptime: number; // milliseconds
  metrics: MCPServerMetrics;
}

export interface MCPServerMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  avgResponseTime: number;
  p95ResponseTime: number;
  p99ResponseTime: number;
  lastHourRequests: number;
  lastHourErrors: number;
  toolsAvailable: number;
  toolsHealthy: number;
}

export interface HealthCheckResult {
  serverId: string;
  success: boolean;
  responseTime: number;
  error?: string;
  timestamp: Date;
  toolsStatus?: Array<{
    toolName: string;
    available: boolean;
    responseTime?: number;
  }>;
}

export interface PerformanceMetrics {
  cpu: number;
  memory: number;
  connections: number;
  throughput: number; // requests per second
}

export interface MCPHealthConfig {
  checkInterval: number; // milliseconds
  timeout: number; // milliseconds
  unhealthyThreshold: number; // consecutive failures
  degradedThreshold: number; // error rate percentage
  retentionPeriod: number; // days
}

/**
 * Monitors health and performance of MCP servers
 */
export class MCPHealthMonitor extends EventEmitter {
  private serverHealthMap: Map<string, MCPServerHealth> = new Map();
  private responseTimes: Map<string, number[]> = new Map();
  private healthCheckIntervals: Map<string, NodeJS.Timeout> = new Map();
  private isMonitoring: boolean = false;

  constructor(
    private metricsCollector: MetricsCollector,
    private config: MCPHealthConfig = {
      checkInterval: 30000, // 30 seconds
      timeout: 5000, // 5 seconds
      unhealthyThreshold: 5,
      degradedThreshold: 10, // 10% error rate
      retentionPeriod: 7
    }
  ) {
    super();
  }

  /**
   * Start monitoring MCP servers
   */
  startMonitoring(serverIds: string[]): void {
    if (this.isMonitoring) {
      throw new Error('Health monitoring is already running');
    }

    this.isMonitoring = true;
    
    // Initialize health tracking for each server
    serverIds.forEach(serverId => {
      this.initializeServerHealth(serverId);
      this.startHealthChecks(serverId);
    });

    this.emit('monitoring:started', { serverIds });
  }

  /**
   * Stop monitoring all MCP servers
   */
  stopMonitoring(): void {
    if (!this.isMonitoring) {
      return;
    }

    // Clear all health check intervals
    this.healthCheckIntervals.forEach(interval => {
      clearInterval(interval);
    });
    this.healthCheckIntervals.clear();

    this.isMonitoring = false;
    this.emit('monitoring:stopped');
  }

  /**
   * Add a new server to monitor
   */
  addServer(serverId: string): void {
    if (this.serverHealthMap.has(serverId)) {
      throw new Error(`Server ${serverId} is already being monitored`);
    }

    this.initializeServerHealth(serverId);
    
    if (this.isMonitoring) {
      this.startHealthChecks(serverId);
    }

    this.emit('server:added', { serverId });
  }

  /**
   * Remove a server from monitoring
   */
  removeServer(serverId: string): void {
    const interval = this.healthCheckIntervals.get(serverId);
    if (interval) {
      clearInterval(interval);
      this.healthCheckIntervals.delete(serverId);
    }

    this.serverHealthMap.delete(serverId);
    this.responseTimes.delete(serverId);
    
    this.emit('server:removed', { serverId });
  }

  /**
   * Record a health check result
   */
  recordHealthCheck(result: HealthCheckResult): void {
    const serverHealth = this.serverHealthMap.get(result.serverId);
    if (!serverHealth) {
      throw new Error(`Server ${result.serverId} is not being monitored`);
    }

    // Update response times
    this.updateResponseTimes(result.serverId, result.responseTime);

    // Update server health
    const previousStatus = serverHealth.status;
    this.updateServerHealth(serverHealth, result);

    // Record metrics
    this.metricsCollector.recordMCPHealth({
      serverId: result.serverId,
      status: serverHealth.status as 'healthy' | 'degraded' | 'unhealthy',
      responseTime: result.responseTime,
      errorRate: serverHealth.errorRate,
      availability: serverHealth.availability,
      context: {
        consecutive_failures: serverHealth.consecutiveFailures,
        tools_available: serverHealth.metrics.toolsAvailable,
        tools_healthy: serverHealth.metrics.toolsHealthy
      }
    });

    // Emit events for status changes
    if (previousStatus !== serverHealth.status) {
      this.emit('server:status_changed', {
        serverId: result.serverId,
        previousStatus,
        currentStatus: serverHealth.status,
        health: serverHealth
      });
    }

    this.emit('health:check_completed', result);
  }

  /**
   * Get health status for a specific server
   */
  getServerHealth(serverId: string): MCPServerHealth | undefined {
    return this.serverHealthMap.get(serverId);
  }

  /**
   * Get health status for all monitored servers
   */
  getAllServersHealth(): MCPServerHealth[] {
    return Array.from(this.serverHealthMap.values());
  }

  /**
   * Get servers by status
   */
  getServersByStatus(status: MCPServerStatus): MCPServerHealth[] {
    return this.getAllServersHealth().filter(health => health.status === status);
  }

  /**
   * Get overall health summary
   */
  getHealthSummary(): {
    totalServers: number;
    healthyServers: number;
    degradedServers: number;
    unhealthyServers: number;
    unreachableServers: number;
    overallHealthScore: number;
    avgResponseTime: number;
    avgAvailability: number;
  } {
    const allHealth = this.getAllServersHealth();
    const totalServers = allHealth.length;
    
    if (totalServers === 0) {
      return {
        totalServers: 0,
        healthyServers: 0,
        degradedServers: 0,
        unhealthyServers: 0,
        unreachableServers: 0,
        overallHealthScore: 0,
        avgResponseTime: 0,
        avgAvailability: 0
      };
    }

    const statusCounts = allHealth.reduce((acc, health) => {
      acc[health.status] = (acc[health.status] || 0) + 1;
      return acc;
    }, {} as Record<MCPServerStatus, number>);

    const avgResponseTime = allHealth.reduce((sum, h) => sum + h.responseTime, 0) / totalServers;
    const avgAvailability = allHealth.reduce((sum, h) => sum + h.availability, 0) / totalServers;
    
    // Calculate overall health score (weighted by server status)
    const healthScore = allHealth.reduce((score, health) => {
      switch (health.status) {
        case MCPServerStatus.HEALTHY: return score + 100;
        case MCPServerStatus.DEGRADED: return score + 70;
        case MCPServerStatus.UNHEALTHY: return score + 30;
        case MCPServerStatus.UNREACHABLE: return score + 0;
        default: return score + 50;
      }
    }, 0) / totalServers;

    return {
      totalServers,
      healthyServers: statusCounts[MCPServerStatus.HEALTHY] || 0,
      degradedServers: statusCounts[MCPServerStatus.DEGRADED] || 0,
      unhealthyServers: statusCounts[MCPServerStatus.UNHEALTHY] || 0,
      unreachableServers: statusCounts[MCPServerStatus.UNREACHABLE] || 0,
      overallHealthScore: Math.round(healthScore),
      avgResponseTime: Math.round(avgResponseTime),
      avgAvailability: Math.round(avgAvailability * 100) / 100
    };
  }

  /**
   * Check if any servers are in critical state
   */
  hasCriticalIssues(): boolean {
    return this.getAllServersHealth().some(health => 
      health.status === MCPServerStatus.UNHEALTHY || 
      health.status === MCPServerStatus.UNREACHABLE
    );
  }

  /**
   * Get performance metrics for a server
   */
  getPerformanceMetrics(serverId: string): PerformanceMetrics | undefined {
    const responseTimes = this.responseTimes.get(serverId) || [];
    const serverHealth = this.serverHealthMap.get(serverId);
    
    if (!serverHealth || responseTimes.length === 0) {
      return undefined;
    }

    // Calculate throughput (requests per second in last hour)
    const hourAgo = Date.now() - (60 * 60 * 1000);
    const recentRequests = serverHealth.metrics.lastHourRequests;
    const throughput = recentRequests / 3600; // requests per second

    return {
      cpu: 0, // Would be populated by actual server metrics
      memory: 0, // Would be populated by actual server metrics
      connections: 0, // Would be populated by actual server metrics
      throughput
    };
  }

  private initializeServerHealth(serverId: string): void {
    const now = new Date();
    const serverHealth: MCPServerHealth = {
      serverId,
      status: MCPServerStatus.HEALTHY,
      lastCheckTime: now,
      responseTime: 0,
      errorRate: 0,
      availability: 100,
      consecutiveFailures: 0,
      uptime: 0,
      metrics: {
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        avgResponseTime: 0,
        p95ResponseTime: 0,
        p99ResponseTime: 0,
        lastHourRequests: 0,
        lastHourErrors: 0,
        toolsAvailable: 0,
        toolsHealthy: 0
      }
    };

    this.serverHealthMap.set(serverId, serverHealth);
    this.responseTimes.set(serverId, []);
  }

  private startHealthChecks(serverId: string): void {
    const interval = setInterval(async () => {
      try {
        const result = await this.performHealthCheck(serverId);
        this.recordHealthCheck(result);
      } catch (error) {
        // Record failed health check
        this.recordHealthCheck({
          serverId,
          success: false,
          responseTime: this.config.timeout,
          error: error instanceof Error ? error.message : 'Health check failed',
          timestamp: new Date()
        });
      }
    }, this.config.checkInterval);

    this.healthCheckIntervals.set(serverId, interval);
  }

  private async performHealthCheck(serverId: string): Promise<HealthCheckResult> {
    const startTime = Date.now();
    
    try {
      // This would be replaced with actual MCP server health check
      // For now, simulate a health check
      const responseTime = Math.random() * 1000; // Simulated response time
      const success = Math.random() > 0.1; // 90% success rate simulation
      
      await new Promise(resolve => setTimeout(resolve, responseTime));
      
      return {
        serverId,
        success,
        responseTime: Date.now() - startTime,
        timestamp: new Date(),
        toolsStatus: [] // Would be populated by actual tool checks
      };
    } catch (error) {
      return {
        serverId,
        success: false,
        responseTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date()
      };
    }
  }

  private updateServerHealth(serverHealth: MCPServerHealth, result: HealthCheckResult): void {
    const now = new Date();
    serverHealth.lastCheckTime = now;
    serverHealth.responseTime = result.responseTime;

    // Update request metrics
    serverHealth.metrics.totalRequests++;
    
    if (result.success) {
      serverHealth.metrics.successfulRequests++;
      serverHealth.consecutiveFailures = 0;
    } else {
      serverHealth.metrics.failedRequests++;
      serverHealth.consecutiveFailures++;
      serverHealth.lastError = result.error;
    }

    // Calculate error rate
    serverHealth.errorRate = (serverHealth.metrics.failedRequests / serverHealth.metrics.totalRequests) * 100;

    // Calculate availability (simple uptime calculation)
    const successRate = (serverHealth.metrics.successfulRequests / serverHealth.metrics.totalRequests) * 100;
    serverHealth.availability = Math.max(0, successRate);

    // Update status based on thresholds
    serverHealth.status = this.calculateServerStatus(serverHealth);

    // Update response time metrics
    this.updateResponseTimeMetrics(serverHealth);
  }

  private calculateServerStatus(serverHealth: MCPServerHealth): MCPServerStatus {
    // Check if server is unreachable
    if (serverHealth.consecutiveFailures >= this.config.unhealthyThreshold) {
      return MCPServerStatus.UNREACHABLE;
    }

    // Check if server is unhealthy
    if (serverHealth.errorRate > this.config.degradedThreshold * 2) {
      return MCPServerStatus.UNHEALTHY;
    }

    // Check if server is degraded
    if (serverHealth.errorRate > this.config.degradedThreshold) {
      return MCPServerStatus.DEGRADED;
    }

    return MCPServerStatus.HEALTHY;
  }

  private updateResponseTimes(serverId: string, responseTime: number): void {
    const times = this.responseTimes.get(serverId) || [];
    times.push(responseTime);

    // Keep only last 1000 response times
    if (times.length > 1000) {
      times.shift();
    }

    this.responseTimes.set(serverId, times);
  }

  private updateResponseTimeMetrics(serverHealth: MCPServerHealth): void {
    const times = this.responseTimes.get(serverHealth.serverId) || [];
    
    if (times.length === 0) {
      return;
    }

    // Sort for percentile calculations
    const sortedTimes = [...times].sort((a, b) => a - b);
    
    serverHealth.metrics.avgResponseTime = times.reduce((sum, time) => sum + time, 0) / times.length;
    
    // Calculate percentiles
    const p95Index = Math.floor(sortedTimes.length * 0.95);
    const p99Index = Math.floor(sortedTimes.length * 0.99);
    
    serverHealth.metrics.p95ResponseTime = sortedTimes[p95Index] || 0;
    serverHealth.metrics.p99ResponseTime = sortedTimes[p99Index] || 0;
  }
}