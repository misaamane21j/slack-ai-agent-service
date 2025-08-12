# Monitoring System Quick Reference

## 🚀 Quick Start

```bash
# Install and test
npm install
npm run test:monitoring:all

# Start monitoring in your app
npm run test:monitoring:manual
```

## 📊 Basic Usage

```typescript
import { createMonitoringSystem } from './src/monitoring';

// Initialize
const monitoring = createMonitoringSystem({
  mcpServers: ['jenkins-server', 'ai-server']
});
await monitoring.initialize();
await monitoring.start();

// Record events
monitoring.recordError({
  category: ErrorCategory.MCP_TOOL,
  severity: ErrorSeverity.HIGH,
  message: 'Jenkins job failed',
  operation: 'deploy'
});

monitoring.recordOperation({
  name: 'slack_command',
  duration: 1500,
  success: true,
  userId: 'user123'
});

// Get status
const health = monitoring.getHealthStatus();
console.log(`Health: ${health.overall} (${health.score}/100)`);
```

## 🧪 Testing Commands

```bash
# Unit + Integration tests
npm run test:monitoring

# Interactive manual testing  
npm run test:monitoring:manual

# Performance benchmarks
npm run test:monitoring:performance

# Real-world scenarios
npm run test:monitoring:scenarios

# All tests
npm run test:monitoring:all
```

## 📈 Key Metrics

**Error Recording Performance:**
- Target: <1ms average latency
- Throughput: >1000 ops/sec

**System Health:**
- 0-100 score across all components
- Real-time health status calculation

**Memory Usage:**
- Target: <100MB growth under load
- Automatic cleanup and retention

## 🚨 Alert Types

- `ERROR_RATE` - High error rates
- `RESPONSE_TIME` - Slow responses  
- `RESOURCE_USAGE` - High CPU/memory
- `MCP_SERVER_DOWN` - Server outages
- `USER_IMPACT` - UX degradation
- `SYSTEM_FAILURE` - Critical failures

## 🔧 Component Overview

| Component | Purpose | Key Features |
|-----------|---------|--------------|
| **MetricsCollector** | Data collection | Error/performance/UX metrics |
| **MCPHealthMonitor** | Server health | Availability, response times |
| **UserExperienceMonitor** | UX impact | Satisfaction, abandonment risk |
| **PerformanceMonitor** | System performance | CPU, memory, latency |
| **AlertManager** | Alerting | Rules, escalation, notifications |
| **DashboardProvider** | Visualization | Real-time dashboards |
| **MonitoringOrchestrator** | Coordination | Central management |

## 🎯 Health Status Levels

- **HEALTHY** (80-100): Normal operation
- **DEGRADED** (60-79): Some issues, still functional
- **UNHEALTHY** (20-59): Significant problems
- **CRITICAL** (0-19): Severe issues, immediate attention

## ⚡ Performance Targets

```
✅ Error Recording: <1ms avg
✅ Concurrent Ops: >1000/sec  
✅ Memory Growth: <100MB
✅ Health Calc: <10ms
✅ System Uptime: >99.9%
```

## 🔍 Quick Troubleshooting

**High Memory?**
- Check `retentionDays` config
- Verify cleanup is running

**Missing Alerts?** 
- Check alert rule `enabled: true`
- Verify thresholds

**Poor Performance?**
- Reduce `checkInterval`
- Disable unused components

**Health Score Issues?**
- Review threshold configs
- Check data collection

## 📁 File Locations

```
src/monitoring/           # Core implementation
tests/*/monitoring/       # Test suites  
scripts/test-monitoring*  # Testing scripts
docs/MONITORING_SYSTEM.md # Full documentation
```

## 🆘 Support

1. Read full docs: `docs/MONITORING_SYSTEM.md`
2. Run tests: `npm run test:monitoring:all`
3. Check implementation: `src/monitoring/`
4. Task #6.5 details in Task Master

---
*Monitoring System v1.0.0 - Comprehensive observability for Slack AI Agent Service*