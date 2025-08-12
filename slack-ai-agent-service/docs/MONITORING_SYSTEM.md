# Monitoring and Observability System Documentation

## Overview

The Monitoring and Observability System provides comprehensive monitoring for error tracking, MCP server health, and user experience impact measurement. It was implemented as part of Task #6.5 and integrates seamlessly with the existing error handling infrastructure.

## Architecture

### Core Components

```
MonitoringOrchestrator (Central Coordinator)
├── MetricsCollector (Data Collection)
├── MCPHealthMonitor (Server Health)
├── UserExperienceMonitor (UX Impact)
├── PerformanceMonitor (System Performance)
├── AlertManager (Alerting & Escalation)
└── DashboardProvider (Visualization)
```

## Component Reference

### 1. MetricsCollector

**Purpose:** Central metrics collection system categorized by tool type, operation, and severity

**Key Features:**
- Records error metrics with rich context (category, severity, tool type, operation, user)
- Records performance metrics (operation duration, success rates)
- Records user experience metrics (satisfaction, response times, error encounters)
- Records MCP server health metrics (status, response time, availability)
- Provides querying, aggregation, and cleanup functionality

**Usage:**
```typescript
import { createMonitoringSystem } from './src/monitoring';

const monitoring = createMonitoringSystem();
await monitoring.initialize();

// Record an error
monitoring.recordError({
  category: ErrorCategory.MCP_TOOL,
  severity: ErrorSeverity.HIGH,
  message: 'Jenkins job failed',
  userId: 'user123',
  operation: 'trigger_job',
  context: { toolType: 'jenkins', jobName: 'deploy-prod' }
});
```

**Configuration:**
```typescript
const metricsCollector = new MetricsCollector({
  retentionDays: 7,        // Data retention period
  aggregationInterval: 1,  // Aggregation interval in minutes
  maxMetrics: 10000       // Maximum metrics in memory
});
```

### 2. MCPHealthMonitor

**Purpose:** Comprehensive MCP server health tracking with availability and performance metrics

**Key Features:**
- Monitors availability and performance metrics for multiple MCP servers
- Tracks response times, error rates, consecutive failures, and uptime
- Provides health status classification (healthy/degraded/unhealthy/unreachable)
- Calculates percentile response times (p95, p99) and availability scores
- Supports health check intervals and threshold-based status updates

**Health Status Levels:**
- `HEALTHY`: Normal operation, low error rate
- `DEGRADED`: Elevated error rate but functioning
- `UNHEALTHY`: High error rate, significant issues
- `UNREACHABLE`: Cannot connect to server

**Usage:**
```typescript
const mcpMonitor = new MCPHealthMonitor(metricsCollector, {
  checkInterval: 30000,      // 30 second health checks
  timeout: 5000,            // 5 second timeout
  unhealthyThreshold: 5,     // 5 consecutive failures = unhealthy
  degradedThreshold: 10      // 10% error rate = degraded
});

// Start monitoring servers
mcpMonitor.startMonitoring(['jenkins-server', 'ai-server']);

// Get health summary
const summary = mcpMonitor.getHealthSummary();
console.log(`${summary.healthyServers}/${summary.totalServers} servers healthy`);
```

### 3. UserExperienceMonitor

**Purpose:** User experience impact measurement system with satisfaction scoring and abandonment risk calculation

**Key Features:**
- Tracks error effects on user interactions with impact levels (none/minimal/moderate/significant/critical)
- Measures user satisfaction scores, task completion rates, and response times
- Calculates abandonment risk based on error frequency and satisfaction
- Identifies frustration indicators and high-risk users
- Provides UX summary with active users and satisfaction metrics

**Impact Levels:**
- `NONE`: No impact on user experience
- `MINIMAL`: Slight delay or minor inconvenience
- `MODERATE`: Noticeable impact, user can continue
- `SIGNIFICANT`: Major disruption, user experience degraded
- `CRITICAL`: User cannot complete task

**Usage:**
```typescript
const uxMonitor = new UserExperienceMonitor(metricsCollector);

// Start user interaction
uxMonitor.startInteraction({
  userId: 'user123',
  sessionId: 'session456',
  interactionType: 'slack_command',
  startTime: new Date()
});

// Complete interaction with result
uxMonitor.completeInteraction('user123', 'session456', 'slack_command', {
  success: false,
  error: {
    category: ErrorCategory.MCP_TOOL,
    severity: ErrorSeverity.HIGH,
    message: 'Jenkins server unavailable',
    recoverable: false
  }
});

// Get high-risk users
const highRiskUsers = uxMonitor.getHighRiskUsers();
```

### 4. PerformanceMonitor

**Purpose:** Performance impact analysis for error handling overhead with resource utilization tracking

**Key Features:**
- Monitors system performance metrics (CPU, memory, event loop)
- Tracks error handling overhead and processing times
- Records operation latencies with percentile calculations
- Provides resource utilization trends and threshold alerts
- Detects performance degradation patterns

**Usage:**
```typescript
const perfMonitor = new PerformanceMonitor(metricsCollector, {
  cpu: { warning: 70, critical: 90 },
  memory: { warning: 80, critical: 95 },
  responseTime: { warning: 5000, critical: 15000 }
});

// Start monitoring
perfMonitor.startMonitoring();

// Record operation latency
perfMonitor.recordOperationLatency('ai_inference', 2500, true);

// Record error handling overhead
perfMonitor.recordErrorHandlingOverhead(45);

// Get performance snapshot
const snapshot = perfMonitor.getCurrentSnapshot();
```

### 5. AlertManager

**Purpose:** Alert thresholds and escalation policies with comprehensive notification system

**Key Features:**
- Supports multiple alert types (error_rate, response_time, resource_usage, mcp_server_down, user_impact)
- Configurable alert rules with conditions, thresholds, and time windows
- Multi-level escalation policies with delay and notification channels
- Alert deduplication, acknowledgment, resolution, and suppression
- Statistics tracking and alert lifecycle management

**Alert Types:**
- `ERROR_RATE`: High error rates detected
- `RESPONSE_TIME`: Slow response times
- `RESOURCE_USAGE`: High CPU/memory usage
- `MCP_SERVER_DOWN`: MCP server unavailable
- `USER_IMPACT`: Significant user experience degradation
- `PERFORMANCE_DEGRADATION`: System performance issues
- `SYSTEM_FAILURE`: Critical system failures

**Usage:**
```typescript
const alertManager = new AlertManager(metricsCollector);

// Add alert rule
alertManager.addAlertRule({
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

// Create manual alert
const alert = alertManager.createAlert({
  type: AlertType.SYSTEM_FAILURE,
  severity: AlertSeverity.CRITICAL,
  title: 'System Critical Failure',
  description: 'Multiple components failing',
  source: 'monitoring_system',
  metrics: { error_count: 50 },
  tags: { component: 'mcp_servers' }
});

// Acknowledge alert
alertManager.acknowledgeAlert(alert.id, 'operator123');
```

### 6. DashboardProvider

**Purpose:** Real-time dashboard integration with configurable widgets and historical analysis

**Key Features:**
- Provides real-time data streams and historical analysis
- Configurable widgets with multiple visualization types
- Data aggregation and time-series bucketing
- Export/import dashboard configurations
- Widget refresh management and caching

**Widget Types:**
- `metric`: Single metric display
- `chart`: Line/bar/pie charts
- `table`: Tabular data
- `alert`: Alert status display
- `status`: System status indicators

**Usage:**
```typescript
const dashboardProvider = new DashboardProvider(
  metricsCollector, mcpHealthMonitor, uxMonitor, perfMonitor, alertManager
);

// Start dashboard
dashboardProvider.start();

// Add widget
dashboardProvider.updateWidget({
  id: 'error_rate_chart',
  type: 'chart',
  title: 'Error Rate Over Time',
  position: { x: 0, y: 0, width: 6, height: 4 },
  config: {
    dataSource: 'metrics',
    visualization: {
      type: 'line',
      options: { color: 'red' }
    },
    query: {
      metric: 'error_count',
      timeRange: '24h',
      aggregation: 'sum'
    }
  }
});

// Get real-time data
const realTimeData = dashboardProvider.getRealTimeData();
```

### 7. MonitoringOrchestrator

**Purpose:** Central coordinator for all monitoring components with unified configuration and lifecycle management

**Key Features:**
- Unified configuration and lifecycle management
- Health status calculation across all components
- Error and operation recording with automatic metric distribution
- System-wide health checks and critical state detection
- Metrics export for external monitoring systems

**Usage:**
```typescript
import { createMonitoringSystem } from './src/monitoring';

const monitoring = createMonitoringSystem({
  enabled: true,
  components: {
    metrics: true,
    mcpHealth: true,
    userExperience: true,
    performance: true,
    alerts: true,
    dashboard: true
  },
  mcpServers: ['jenkins-server', 'ai-server'],
  alerting: {
    enabled: true,
    channels: ['slack', 'email']
  },
  dashboard: {
    enabled: true,
    port: 3001
  }
});

// Initialize and start
await monitoring.initialize();
await monitoring.start();

// Record events
monitoring.recordError({
  category: ErrorCategory.MCP_TOOL,
  severity: ErrorSeverity.HIGH,
  message: 'Tool execution failed',
  operation: 'jenkins_deploy'
});

monitoring.recordOperation({
  name: 'slack_message_processing',
  duration: 1500,
  success: true,
  userId: 'user123'
});

// Get system health
const health = monitoring.getHealthStatus();
console.log(`System Health: ${health.overall} (${health.score}/100)`);

// Get comprehensive snapshot
const snapshot = monitoring.getSnapshot();
console.log(`Errors: ${snapshot.metrics.totalErrors}, Response Time: ${snapshot.metrics.avgResponseTime}ms`);

// Export metrics for external systems
const exportedMetrics = monitoring.getMetricsForExport();
```

## Configuration

### Default Configuration

```typescript
const defaultConfig = {
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
};
```

### Performance Thresholds

```typescript
const performanceThresholds = {
  cpu: { warning: 70, critical: 90 },           // CPU percentage
  memory: { warning: 80, critical: 95 },        // Memory percentage
  eventLoopDelay: { warning: 100, critical: 500 }, // Milliseconds
  responseTime: { warning: 5000, critical: 15000 }, // Milliseconds
  errorHandlingOverhead: { warning: 50, critical: 200 } // Milliseconds
};
```

### Alert Rules Configuration

```typescript
const alertRules = [
  {
    id: 'high_error_rate',
    name: 'High Error Rate',
    type: AlertType.ERROR_RATE,
    condition: {
      metric: 'error.error_count',
      operator: '>',
      threshold: 10,
      timeWindow: 5,
      evaluationInterval: 60
    },
    severity: AlertSeverity.WARNING,
    escalationPolicy: 'default'
  },
  {
    id: 'mcp_server_down',
    name: 'MCP Server Unavailable',
    type: AlertType.MCP_SERVER_DOWN,
    condition: {
      metric: 'mcp_health.mcp_server_health',
      operator: '<',
      threshold: 50,
      timeWindow: 2,
      evaluationInterval: 30
    },
    severity: AlertSeverity.CRITICAL,
    escalationPolicy: 'urgent'
  }
];
```

## Testing

### Test Scripts

```bash
# Unit tests for individual components
npm run test:monitoring

# Manual interactive testing
npm run test:monitoring:manual

# Performance benchmarking
npm run test:monitoring:performance

# Real-world scenario simulation
npm run test:monitoring:scenarios

# Run all monitoring tests
npm run test:monitoring:all
```

### Unit Tests

Located in `tests/unit/monitoring/`:
- `MetricsCollector.test.ts` - Metrics collection and querying
- `MCPHealthMonitor.test.ts` - Health monitoring and status transitions

### Integration Tests

Located in `tests/integration/monitoring/`:
- `MonitoringOrchestrator.test.ts` - Full system integration testing

### Manual Testing Scripts

Located in `scripts/`:
- `test-monitoring.ts` - Interactive testing with real data
- `test-monitoring-performance.ts` - Performance benchmarking
- `test-monitoring-scenarios.ts` - Real-world failure simulation

### Performance Benchmarks

**Target Performance:**
- Error recording: <1ms average latency
- Concurrent throughput: >1000 operations/second
- Memory usage: <100MB growth under load
- System health calculation: <10ms

**Test Results Format:**
```
📈 Error Recording:
   Total Time: 1000.00ms
   Avg Time: 0.850ms
   Min Time: 0.234ms
   Max Time: 5.678ms
   Throughput: 1176 ops/sec
   ✅ EXCELLENT (<1ms avg)

🧠 Memory Usage:
   Initial Heap: 45.23 MB
   Final Heap: 87.45 MB
   Memory Growth: 42.22 MB
   ✅ EXCELLENT (<50MB growth)
```

## Event System

### Event Types

The monitoring system emits comprehensive events for integration:

**MetricsCollector Events:**
- `metric:recorded` - New metric recorded
- `metrics:aggregated` - Periodic aggregation completed
- `metrics:cleaned` - Old metrics cleaned up

**MCPHealthMonitor Events:**
- `monitoring:started` - Health monitoring started
- `server:added` - New server added to monitoring
- `server:status_changed` - Server health status changed
- `health:check_completed` - Health check completed

**UserExperienceMonitor Events:**
- `interaction:started` - User interaction started
- `interaction:completed` - User interaction completed
- `error:impact_recorded` - Error impact on user recorded
- `satisfaction:recorded` - User satisfaction feedback recorded
- `ux:cleanup_completed` - Old UX data cleaned up

**PerformanceMonitor Events:**
- `monitoring:started` - Performance monitoring started
- `performance:snapshot` - Performance snapshot taken
- `performance:alert` - Performance threshold exceeded

**AlertManager Events:**
- `alert:created` - New alert created
- `alert:acknowledged` - Alert acknowledged
- `alert:resolved` - Alert resolved
- `alert:escalated` - Alert escalated
- `notification:sent` - Notification sent

**MonitoringOrchestrator Events:**
- `monitoring:initialized` - System initialized
- `monitoring:started` - Monitoring started
- `health:check` - System health check completed
- `config:updated` - Configuration updated

### Event Handlers

```typescript
const monitoring = createMonitoringSystem();

// Listen for critical alerts
monitoring.on('alert:created', (alert) => {
  if (alert.severity === 'critical') {
    console.log(`🚨 CRITICAL ALERT: ${alert.title}`);
    // Send to external alerting system
  }
});

// Monitor system health changes
monitoring.on('health:check', (health) => {
  if (health.overall !== 'healthy') {
    console.log(`⚠️ System Health: ${health.overall} (${health.score}/100)`);
  }
});

// Track MCP server issues
monitoring.on('mcp:status_changed', (event) => {
  if (event.currentStatus === 'unhealthy') {
    console.log(`🔴 MCP Server ${event.serverId} is unhealthy`);
  }
});
```

## Integration Examples

### Basic Integration

```typescript
import { createMonitoringSystem } from './src/monitoring';
import { logger } from './src/utils/logger';

// Initialize monitoring
const monitoring = createMonitoringSystem({
  mcpServers: ['jenkins-prod', 'ai-gpt4'],
  alerting: { enabled: true, channels: ['slack'] }
});

await monitoring.initialize();
await monitoring.start();

// Integrate with existing error handling
export function handleError(error: any, context: any) {
  // Record error in monitoring system
  monitoring.recordError({
    category: error.category || ErrorCategory.SYSTEM,
    severity: error.severity || ErrorSeverity.MEDIUM,
    message: error.message,
    operation: context.operation,
    userId: context.userId,
    sessionId: context.sessionId,
    context: {
      ...context,
      stack: error.stack,
      timestamp: Date.now()
    }
  });

  // Continue with existing error handling
  logger.error('Error occurred', { error, context });
}

// Integrate with operation tracking
export async function executeOperation(name: string, operation: () => Promise<any>, context: any) {
  const startTime = Date.now();
  let success = false;
  
  try {
    const result = await operation();
    success = true;
    return result;
  } catch (error) {
    handleError(error, { ...context, operation: name });
    throw error;
  } finally {
    // Record operation metrics
    monitoring.recordOperation({
      name,
      duration: Date.now() - startTime,
      success,
      userId: context.userId,
      context
    });
  }
}
```

### Slack Integration

```typescript
import { App } from '@slack/bolt';

const app = new App({ /* slack config */ });

// Monitor Slack command processing
app.command('/deploy', async ({ command, ack, respond }) => {
  const userId = command.user_id;
  const sessionId = `slack_${Date.now()}`;
  
  // Start monitoring user interaction
  monitoring.startInteraction({
    userId,
    sessionId,
    interactionType: 'slack_command_deploy',
    startTime: new Date(),
    context: { 
      command: command.text,
      channel: command.channel_id 
    }
  });

  try {
    await ack();
    
    // Execute deployment
    const result = await executeDeployment(command.text);
    
    // Complete successful interaction
    monitoring.completeInteraction(userId, sessionId, 'slack_command_deploy', {
      success: true,
      context: { result }
    });
    
    await respond(`Deployment successful: ${result.jobUrl}`);
    
  } catch (error) {
    // Complete failed interaction
    monitoring.completeInteraction(userId, sessionId, 'slack_command_deploy', {
      success: false,
      error: {
        category: ErrorCategory.MCP_TOOL,
        severity: ErrorSeverity.HIGH,
        message: error.message,
        recoverable: true
      }
    });
    
    await respond(`Deployment failed: ${error.message}`);
  }
});
```

### External Monitoring Integration

```typescript
// Export metrics to Prometheus/Grafana
setInterval(() => {
  const metrics = monitoring.getMetricsForExport();
  
  // Send to external monitoring
  Object.entries(metrics).forEach(([key, value]) => {
    prometheusRegistry.gauge(key).set(value);
  });
}, 60000); // Every minute

// Export to custom monitoring system
setInterval(async () => {
  const snapshot = monitoring.getSnapshot();
  
  await externalMonitoring.sendMetrics({
    timestamp: snapshot.timestamp,
    systemHealth: snapshot.systemHealth.score,
    errorRate: snapshot.metrics.errorRate,
    responseTime: snapshot.metrics.avgResponseTime,
    activeAlerts: snapshot.alerts.active,
    mcpServerHealth: snapshot.mcpServers.healthy / snapshot.mcpServers.total
  });
}, 30000); // Every 30 seconds
```

## Troubleshooting

### Common Issues

**1. High Memory Usage**
- Check retention periods: `retentionDays`, `retentionPeriod`
- Verify cleanup jobs are running
- Monitor `maxMetrics` configuration

**2. Performance Degradation**
- Disable unnecessary components in configuration
- Reduce monitoring frequency: `checkInterval`, `evaluationInterval`
- Check `aggregationInterval` setting

**3. Missing Alerts**
- Verify alert rules are enabled
- Check threshold configuration
- Ensure notification channels are configured

**4. Inaccurate Health Scores**
- Review threshold configurations
- Check component health calculation logic
- Verify data collection is working

### Debug Mode

```typescript
const monitoring = createMonitoringSystem({
  // ... other config
});

// Enable debug logging
monitoring.on('error', (error) => {
  console.error('Monitoring error:', error);
});

monitoring.on('metric:recorded', (metric) => {
  console.debug('Metric recorded:', metric);
});

monitoring.on('alert:created', (alert) => {
  console.log('Alert created:', alert);
});
```

### Health Checks

```bash
# Check system health via API
curl http://localhost:3001/health

# Check monitoring status
npm run test:monitoring:manual

# Verify performance
npm run test:monitoring:performance
```

## File Structure

```
src/monitoring/
├── index.ts                    # Main exports
├── MetricsCollector.ts         # Core metrics collection
├── MCPHealthMonitor.ts         # MCP server monitoring
├── UserExperienceMonitor.ts    # UX impact tracking
├── PerformanceMonitor.ts       # Performance monitoring
├── AlertManager.ts             # Alert management
├── DashboardProvider.ts        # Dashboard integration
└── MonitoringOrchestrator.ts   # Central coordinator

tests/
├── unit/monitoring/
│   ├── MetricsCollector.test.ts
│   └── MCPHealthMonitor.test.ts
└── integration/monitoring/
    └── MonitoringOrchestrator.test.ts

scripts/
├── test-monitoring.ts          # Manual testing
├── test-monitoring-performance.ts # Performance tests
└── test-monitoring-scenarios.ts   # Scenario simulation

docs/
└── MONITORING_SYSTEM.md       # This documentation
```

## Version History

**v1.0.0** (Commit: 8e58d15)
- Initial implementation of comprehensive monitoring system
- All core components implemented and tested
- Full TypeScript support
- Comprehensive test suite
- Real-world scenario testing
- Performance benchmarking

## Support

For questions or issues with the monitoring system:

1. Check this documentation
2. Run the test suite: `npm run test:monitoring:all`
3. Check system health: `npm run test:monitoring:manual`
4. Review the implementation in `src/monitoring/`
5. Consult the Task Master system for implementation details

The monitoring system was implemented as part of **Task #6.5** in the enhanced error handling project and provides enterprise-grade observability for the Slack AI Agent Service.