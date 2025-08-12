/**
 * Monitoring and Observability System
 * Provides comprehensive monitoring for error tracking, MCP server health, and user experience impact
 */

// Core monitoring components
export {
  MetricsCollector,
  MetricCategory,
  MetricType,
  type Metric,
  type MetricsSnapshot,
  type MetricsQuery,
  type MetricsFilter
} from './MetricsCollector';

// MCP Server Health Monitoring
export {
  MCPHealthMonitor,
  MCPServerStatus,
  type MCPServerHealth,
  type MCPServerMetrics,
  type HealthCheckResult,
  type PerformanceMetrics
} from './MCPHealthMonitor';

// User Experience Impact Measurement
export {
  UserExperienceMonitor,
  UXImpactLevel,
  type UXMetrics,
  type UserInteraction,
  type ResponseTimeMetrics,
  type UserSatisfactionMetrics
} from './UserExperienceMonitor';

// Performance Impact Analysis
export {
  PerformanceMonitor,
  type PerformanceSnapshot,
  type PerformanceThresholds,
  type ResourceUtilization,
  type LatencyMetrics
} from './PerformanceMonitor';

// Alert System
export {
  AlertManager,
  AlertSeverity,
  AlertType,
  type Alert,
  type AlertRule,
  type AlertThreshold,
  type EscalationPolicy
} from './AlertManager';

// Dashboard Integration
export {
  DashboardProvider,
  type DashboardConfig,
  type DashboardWidget,
  type VisualizationConfig,
  type RealTimeData
} from './DashboardProvider';

// Central monitoring orchestrator
export {
  MonitoringOrchestrator,
  type MonitoringConfig,
  type MonitoringSnapshot,
  type HealthStatus
} from './MonitoringOrchestrator';

// Create a default monitoring instance factory
import { MonitoringOrchestrator, MonitoringConfig } from './MonitoringOrchestrator';

export function createMonitoringSystem(config?: Partial<MonitoringConfig>): MonitoringOrchestrator {
  const defaultConfig: MonitoringConfig = {
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
  
  return new MonitoringOrchestrator({ ...defaultConfig, ...config });
}