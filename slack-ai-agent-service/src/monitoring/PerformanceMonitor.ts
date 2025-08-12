/**
 * Performance Impact Analysis System
 * Monitors error handling overhead and system performance metrics
 */

import { EventEmitter } from 'events';
import { MetricsCollector } from './MetricsCollector';

export interface PerformanceSnapshot {
  timestamp: Date;
  cpu: {
    usage: number; // percentage
    loadAverage: number[];
  };
  memory: {
    used: number; // bytes
    total: number; // bytes
    heapUsed: number; // bytes
    heapTotal: number; // bytes
    external: number; // bytes
  };
  eventLoop: {
    delay: number; // milliseconds
    utilization: number; // percentage
  };
  errorHandling: {
    overhead: number; // milliseconds
    processingCount: number;
    averageTime: number; // milliseconds
  };
  network: {
    connections: number;
    bytesIn: number;
    bytesOut: number;
  };
  operations: {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    averageResponseTime: number;
    p95ResponseTime: number;
    p99ResponseTime: number;
  };
}

export interface PerformanceThresholds {
  cpu: {
    warning: number; // percentage
    critical: number; // percentage
  };
  memory: {
    warning: number; // percentage of total
    critical: number; // percentage of total
  };
  eventLoopDelay: {
    warning: number; // milliseconds
    critical: number; // milliseconds
  };
  responseTime: {
    warning: number; // milliseconds
    critical: number; // milliseconds
  };
  errorHandlingOverhead: {
    warning: number; // milliseconds
    critical: number; // milliseconds
  };
}

export interface ResourceUtilization {
  resourceType: 'cpu' | 'memory' | 'network' | 'disk';
  current: number;
  peak: number;
  average: number;
  threshold: number;
  isOverThreshold: boolean;
  trend: 'increasing' | 'decreasing' | 'stable';
}

export interface LatencyMetrics {
  operation: string;
  count: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  p95: number;
  p99: number;
  stdDev: number;
  throughput: number; // operations per second
}

export interface PerformanceAlert {
  type: 'threshold_exceeded' | 'performance_degradation' | 'resource_exhaustion';
  severity: 'warning' | 'critical';
  resource: string;
  currentValue: number;
  threshold: number;
  timestamp: Date;
  description: string;
}

/**
 * Monitors system performance and error handling overhead
 */
export class PerformanceMonitor extends EventEmitter {
  private performanceHistory: PerformanceSnapshot[] = [];
  private latencyTracking: Map<string, number[]> = new Map();
  private errorHandlingTimes: number[] = [];
  private operationTimes: Map<string, number[]> = new Map();
  private monitoringInterval?: NodeJS.Timeout;
  private isMonitoring: boolean = false;

  constructor(
    private metricsCollector: MetricsCollector,
    private thresholds: PerformanceThresholds = {
      cpu: { warning: 70, critical: 90 },
      memory: { warning: 80, critical: 95 },
      eventLoopDelay: { warning: 100, critical: 500 },
      responseTime: { warning: 5000, critical: 15000 },
      errorHandlingOverhead: { warning: 50, critical: 200 }
    },
    private config: {
      monitoringInterval: number;
      historyRetention: number;
      latencyBuckets: number;
    } = {
      monitoringInterval: 10000, // 10 seconds
      historyRetention: 1000, // snapshots
      latencyBuckets: 100 // latency measurements per operation
    }
  ) {
    super();
  }

  /**
   * Start performance monitoring
   */
  startMonitoring(): void {
    if (this.isMonitoring) {
      throw new Error('Performance monitoring is already running');
    }

    this.isMonitoring = true;
    this.monitoringInterval = setInterval(() => {
      this.capturePerformanceSnapshot();
    }, this.config.monitoringInterval);

    this.emit('monitoring:started');
  }

  /**
   * Stop performance monitoring
   */
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }
    this.isMonitoring = false;
    this.emit('monitoring:stopped');
  }

  /**
   * Record error handling overhead
   */
  recordErrorHandlingOverhead(processingTime: number): void {
    this.errorHandlingTimes.push(processingTime);
    
    // Keep only recent measurements
    if (this.errorHandlingTimes.length > this.config.latencyBuckets) {
      this.errorHandlingTimes.shift();
    }

    // Check thresholds
    if (processingTime > this.thresholds.errorHandlingOverhead.critical) {
      this.emitAlert({
        type: 'threshold_exceeded',
        severity: 'critical',
        resource: 'error_handling_overhead',
        currentValue: processingTime,
        threshold: this.thresholds.errorHandlingOverhead.critical,
        timestamp: new Date(),
        description: `Error handling overhead exceeded critical threshold: ${processingTime}ms`
      });
    } else if (processingTime > this.thresholds.errorHandlingOverhead.warning) {
      this.emitAlert({
        type: 'threshold_exceeded',
        severity: 'warning',
        resource: 'error_handling_overhead',
        currentValue: processingTime,
        threshold: this.thresholds.errorHandlingOverhead.warning,
        timestamp: new Date(),
        description: `Error handling overhead exceeded warning threshold: ${processingTime}ms`
      });
    }

    // Record metric
    this.metricsCollector.recordPerformance({
      operation: 'error_handling',
      duration: processingTime,
      success: true,
      context: {
        overhead_type: 'error_processing'
      }
    });
  }

  /**
   * Record operation latency
   */
  recordOperationLatency(operation: string, latency: number, success: boolean = true): void {
    const latencies = this.operationTimes.get(operation) || [];
    latencies.push(latency);
    
    // Keep only recent measurements
    if (latencies.length > this.config.latencyBuckets) {
      latencies.shift();
    }
    
    this.operationTimes.set(operation, latencies);

    // Record metric
    this.metricsCollector.recordPerformance({
      operation,
      duration: latency,
      success,
      context: {
        operation_type: 'general'
      }
    });

    // Check response time thresholds
    if (latency > this.thresholds.responseTime.critical) {
      this.emitAlert({
        type: 'performance_degradation',
        severity: 'critical',
        resource: operation,
        currentValue: latency,
        threshold: this.thresholds.responseTime.critical,
        timestamp: new Date(),
        description: `Operation ${operation} response time exceeded critical threshold: ${latency}ms`
      });
    } else if (latency > this.thresholds.responseTime.warning) {
      this.emitAlert({
        type: 'performance_degradation',
        severity: 'warning',
        resource: operation,
        currentValue: latency,
        threshold: this.thresholds.responseTime.warning,
        timestamp: new Date(),
        description: `Operation ${operation} response time exceeded warning threshold: ${latency}ms`
      });
    }
  }

  /**
   * Get current performance snapshot
   */
  getCurrentSnapshot(): PerformanceSnapshot {
    return this.capturePerformanceSnapshot();
  }

  /**
   * Get performance history
   */
  getPerformanceHistory(count?: number): PerformanceSnapshot[] {
    const history = [...this.performanceHistory];
    if (count) {
      return history.slice(-count);
    }
    return history;
  }

  /**
   * Get latency metrics for a specific operation
   */
  getLatencyMetrics(operation: string): LatencyMetrics | undefined {
    const latencies = this.operationTimes.get(operation);
    if (!latencies || latencies.length === 0) {
      return undefined;
    }

    const sorted = [...latencies].sort((a, b) => a - b);
    const count = sorted.length;
    const sum = sorted.reduce((acc, val) => acc + val, 0);
    const mean = sum / count;
    
    // Calculate percentiles
    const p95Index = Math.floor(count * 0.95);
    const p99Index = Math.floor(count * 0.99);
    const medianIndex = Math.floor(count * 0.5);

    // Calculate standard deviation
    const variance = sorted.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / count;
    const stdDev = Math.sqrt(variance);

    // Calculate throughput (operations per second)
    const timeWindow = this.config.monitoringInterval / 1000; // Convert to seconds
    const throughput = count / timeWindow;

    return {
      operation,
      count,
      min: sorted[0],
      max: sorted[count - 1],
      mean,
      median: sorted[medianIndex],
      p95: sorted[p95Index],
      p99: sorted[p99Index],
      stdDev,
      throughput
    };
  }

  /**
   * Get resource utilization summary
   */
  getResourceUtilization(): ResourceUtilization[] {
    const latest = this.performanceHistory[this.performanceHistory.length - 1];
    if (!latest) {
      return [];
    }

    const history = this.getPerformanceHistory(10); // Last 10 snapshots
    const resources: ResourceUtilization[] = [];

    // CPU utilization
    const cpuValues = history.map(h => h.cpu.usage);
    const cpuTrend = this.calculateTrend(cpuValues);
    resources.push({
      resourceType: 'cpu',
      current: latest.cpu.usage,
      peak: Math.max(...cpuValues),
      average: cpuValues.reduce((sum, val) => sum + val, 0) / cpuValues.length,
      threshold: this.thresholds.cpu.warning,
      isOverThreshold: latest.cpu.usage > this.thresholds.cpu.warning,
      trend: cpuTrend
    });

    // Memory utilization
    const memoryValues = history.map(h => (h.memory.used / h.memory.total) * 100);
    const memoryTrend = this.calculateTrend(memoryValues);
    const currentMemoryPercent = (latest.memory.used / latest.memory.total) * 100;
    resources.push({
      resourceType: 'memory',
      current: currentMemoryPercent,
      peak: Math.max(...memoryValues),
      average: memoryValues.reduce((sum, val) => sum + val, 0) / memoryValues.length,
      threshold: this.thresholds.memory.warning,
      isOverThreshold: currentMemoryPercent > this.thresholds.memory.warning,
      trend: memoryTrend
    });

    // Network utilization (simplified)
    const networkValues = history.map(h => h.network.connections);
    const networkTrend = this.calculateTrend(networkValues);
    resources.push({
      resourceType: 'network',
      current: latest.network.connections,
      peak: Math.max(...networkValues),
      average: networkValues.reduce((sum, val) => sum + val, 0) / networkValues.length,
      threshold: 100, // Simplified threshold
      isOverThreshold: latest.network.connections > 100,
      trend: networkTrend
    });

    return resources;
  }

  /**
   * Get error handling overhead statistics
   */
  getErrorHandlingStats(): {
    averageOverhead: number;
    maxOverhead: number;
    minOverhead: number;
    p95Overhead: number;
    totalProcessed: number;
    isOverThreshold: boolean;
  } {
    if (this.errorHandlingTimes.length === 0) {
      return {
        averageOverhead: 0,
        maxOverhead: 0,
        minOverhead: 0,
        p95Overhead: 0,
        totalProcessed: 0,
        isOverThreshold: false
      };
    }

    const sorted = [...this.errorHandlingTimes].sort((a, b) => a - b);
    const count = sorted.length;
    const average = sorted.reduce((sum, time) => sum + time, 0) / count;
    const p95Index = Math.floor(count * 0.95);

    return {
      averageOverhead: average,
      maxOverhead: sorted[count - 1],
      minOverhead: sorted[0],
      p95Overhead: sorted[p95Index],
      totalProcessed: count,
      isOverThreshold: average > this.thresholds.errorHandlingOverhead.warning
    };
  }

  /**
   * Check for performance degradation
   */
  checkPerformanceDegradation(): boolean {
    const recent = this.getPerformanceHistory(5);
    if (recent.length < 5) {
      return false;
    }

    // Check if response times are consistently increasing
    const responseTimes = recent.map(snapshot => snapshot.operations.averageResponseTime);
    const isIncreasing = this.isConsistentlyIncreasing(responseTimes);

    // Check if CPU usage is consistently high
    const cpuUsages = recent.map(snapshot => snapshot.cpu.usage);
    const highCpu = cpuUsages.every(usage => usage > this.thresholds.cpu.warning);

    // Check if memory usage is consistently high
    const memoryUsages = recent.map(snapshot => (snapshot.memory.used / snapshot.memory.total) * 100);
    const highMemory = memoryUsages.every(usage => usage > this.thresholds.memory.warning);

    return isIncreasing || highCpu || highMemory;
  }

  private capturePerformanceSnapshot(): PerformanceSnapshot {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    // Calculate CPU usage percentage (simplified)
    const totalCpuTime = cpuUsage.user + cpuUsage.system;
    const cpuPercent = Math.min((totalCpuTime / 1000000) / this.config.monitoringInterval * 100, 100);

    // Calculate error handling overhead
    const errorHandlingOverhead = this.calculateErrorHandlingOverhead();

    // Calculate operation metrics
    const operationMetrics = this.calculateOperationMetrics();

    const snapshot: PerformanceSnapshot = {
      timestamp: new Date(),
      cpu: {
        usage: cpuPercent,
        loadAverage: [0, 0, 0] // Would be populated with actual load average on Unix systems
      },
      memory: {
        used: memUsage.rss,
        total: memUsage.rss + memUsage.external, // Simplified
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        external: memUsage.external
      },
      eventLoop: {
        delay: 0, // Would be populated with actual event loop delay
        utilization: 0 // Would be populated with actual utilization
      },
      errorHandling: errorHandlingOverhead,
      network: {
        connections: 0, // Would be populated with actual connection count
        bytesIn: 0,
        bytesOut: 0
      },
      operations: operationMetrics
    };

    // Add to history
    this.performanceHistory.push(snapshot);
    
    // Trim history if needed
    if (this.performanceHistory.length > this.config.historyRetention) {
      this.performanceHistory.shift();
    }

    // Check thresholds and emit alerts
    this.checkThresholds(snapshot);

    this.emit('performance:snapshot', snapshot);
    return snapshot;
  }

  private calculateErrorHandlingOverhead(): {
    overhead: number;
    processingCount: number;
    averageTime: number;
  } {
    if (this.errorHandlingTimes.length === 0) {
      return {
        overhead: 0,
        processingCount: 0,
        averageTime: 0
      };
    }

    const totalTime = this.errorHandlingTimes.reduce((sum, time) => sum + time, 0);
    const averageTime = totalTime / this.errorHandlingTimes.length;

    return {
      overhead: totalTime,
      processingCount: this.errorHandlingTimes.length,
      averageTime
    };
  }

  private calculateOperationMetrics(): {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    averageResponseTime: number;
    p95ResponseTime: number;
    p99ResponseTime: number;
  } {
    let totalRequests = 0;
    let totalTime = 0;
    const allTimes: number[] = [];

    // Aggregate all operation times
    Array.from(this.operationTimes.entries()).forEach(([operation, times]) => {
      totalRequests += times.length;
      totalTime += times.reduce((sum, time) => sum + time, 0);
      allTimes.push(...times);
    });

    if (allTimes.length === 0) {
      return {
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        averageResponseTime: 0,
        p95ResponseTime: 0,
        p99ResponseTime: 0
      };
    }

    const sortedTimes = allTimes.sort((a, b) => a - b);
    const p95Index = Math.floor(sortedTimes.length * 0.95);
    const p99Index = Math.floor(sortedTimes.length * 0.99);

    return {
      totalRequests,
      successfulRequests: totalRequests, // Simplified - would track actual success/failure
      failedRequests: 0,
      averageResponseTime: totalTime / totalRequests,
      p95ResponseTime: sortedTimes[p95Index] || 0,
      p99ResponseTime: sortedTimes[p99Index] || 0
    };
  }

  private checkThresholds(snapshot: PerformanceSnapshot): void {
    // CPU threshold check
    if (snapshot.cpu.usage > this.thresholds.cpu.critical) {
      this.emitAlert({
        type: 'resource_exhaustion',
        severity: 'critical',
        resource: 'cpu',
        currentValue: snapshot.cpu.usage,
        threshold: this.thresholds.cpu.critical,
        timestamp: snapshot.timestamp,
        description: `CPU usage critical: ${snapshot.cpu.usage}%`
      });
    } else if (snapshot.cpu.usage > this.thresholds.cpu.warning) {
      this.emitAlert({
        type: 'threshold_exceeded',
        severity: 'warning',
        resource: 'cpu',
        currentValue: snapshot.cpu.usage,
        threshold: this.thresholds.cpu.warning,
        timestamp: snapshot.timestamp,
        description: `CPU usage warning: ${snapshot.cpu.usage}%`
      });
    }

    // Memory threshold check
    const memoryPercent = (snapshot.memory.used / snapshot.memory.total) * 100;
    if (memoryPercent > this.thresholds.memory.critical) {
      this.emitAlert({
        type: 'resource_exhaustion',
        severity: 'critical',
        resource: 'memory',
        currentValue: memoryPercent,
        threshold: this.thresholds.memory.critical,
        timestamp: snapshot.timestamp,
        description: `Memory usage critical: ${memoryPercent.toFixed(1)}%`
      });
    } else if (memoryPercent > this.thresholds.memory.warning) {
      this.emitAlert({
        type: 'threshold_exceeded',
        severity: 'warning',
        resource: 'memory',
        currentValue: memoryPercent,
        threshold: this.thresholds.memory.warning,
        timestamp: snapshot.timestamp,
        description: `Memory usage warning: ${memoryPercent.toFixed(1)}%`
      });
    }
  }

  private calculateTrend(values: number[]): 'increasing' | 'decreasing' | 'stable' {
    if (values.length < 2) return 'stable';
    
    const first = values[0];
    const last = values[values.length - 1];
    const diff = last - first;
    const threshold = first * 0.1; // 10% change threshold
    
    if (Math.abs(diff) < threshold) return 'stable';
    return diff > 0 ? 'increasing' : 'decreasing';
  }

  private isConsistentlyIncreasing(values: number[]): boolean {
    if (values.length < 3) return false;
    
    for (let i = 1; i < values.length; i++) {
      if (values[i] <= values[i - 1]) {
        return false;
      }
    }
    return true;
  }

  private emitAlert(alert: PerformanceAlert): void {
    this.emit('performance:alert', alert);
  }
}