/**
 * Integration tests for monitoring and observability during error conditions
 * Validates that monitoring captures error flows correctly
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { MonitoringOrchestrator } from '../../src/monitoring/MonitoringOrchestrator';
import { MetricsCollector } from '../../src/monitoring/MetricsCollector';
import { AlertManager } from '../../src/monitoring/AlertManager';
import { MCPHealthMonitor } from '../../src/monitoring/MCPHealthMonitor';
import { PerformanceMonitor } from '../../src/monitoring/PerformanceMonitor';
import { UserExperienceMonitor } from '../../src/monitoring/UserExperienceMonitor';
import { ToolExecutionBoundary } from '../../src/errors/boundaries/ToolExecutionBoundary';
import { AIProcessingBoundary } from '../../src/errors/boundaries/AIProcessingBoundary';
import { ErrorContextBuilder, ProcessingStage, OperationPhase } from '../../src/errors/context/ErrorContext';
import { ErrorSeverity, RecoveryAction, AlertSeverity } from '../../src/errors/types';
import { MCPToolError, MCPConnectionError } from '../../src/errors/mcp-tool';
import { AIProcessingError } from '../../src/errors/ai-processing';
import { SecurityError } from '../../src/errors/security';

// Don't mock monitoring components - test them directly
jest.useRealTimers();

describe('Monitoring and Error Integration Tests', () => {
  let monitoringOrchestrator: MonitoringOrchestrator;
  let metricsCollector: MetricsCollector;
  let alertManager: AlertManager;
  let mcpHealthMonitor: MCPHealthMonitor;
  let performanceMonitor: PerformanceMonitor;
  let userExperienceMonitor: UserExperienceMonitor;
  let toolBoundary: ToolExecutionBoundary;
  let aiBoundary: AIProcessingBoundary;

  beforeEach(async () => {
    // Initialize real monitoring components
    metricsCollector = new MetricsCollector();
    alertManager = new AlertManager();
    mcpHealthMonitor = new MCPHealthMonitor();
    performanceMonitor = new PerformanceMonitor();
    userExperienceMonitor = new UserExperienceMonitor();
    
    monitoringOrchestrator = new MonitoringOrchestrator();
    
    // Initialize boundaries with monitoring integration
    toolBoundary = new ToolExecutionBoundary();
    aiBoundary = new AIProcessingBoundary();
    
    // Start monitoring
    await monitoringOrchestrator.initialize();
  });

  describe('Error Tracking and Metrics', () => {
    it('should capture complete error lifecycle metrics', async () => {
      // Arrange
      const context = ErrorContextBuilder.create()
        .withSeverity(ErrorSeverity.HIGH)
        .withOperation('error_lifecycle_tracking', OperationPhase.TOOL_INVOCATION)
        .withExecutionState(ProcessingStage.TOOL_EXECUTION)
        .withUserContext('U123456789', 'C123456789', 'T123456789')
        .withConversationMetadata('test-conv', 'test-thread', 'monitor error lifecycle')
        .build();

      const trackableError = new MCPConnectionError('Monitored connection failure', {
        operation: 'lifecycle_test',
        serverName: 'monitoring-test-server',
        timeout: 5000,
        recoveryActions: [RecoveryAction.RETRY_WITH_BACKOFF, RecoveryAction.USE_FALLBACK]
      });

      let attemptCount = 0;
      const monitoredOperation = async () => {
        attemptCount++;
        
        // Start tracking
        const operationId = `lifecycle_${Date.now()}_${attemptCount}`;
        
        if (attemptCount <= 2) {
          // Record error attempt
          monitoringOrchestrator.recordError(trackableError, context);
          throw trackableError;
        }
        
        // Success on third attempt
        monitoringOrchestrator.recordRecovery({
          errorType: 'MCPConnectionError',
          operation: 'lifecycle_test',
          recoveryStrategy: 'retry_with_backoff',
          attempts: attemptCount,
          success: true,
          duration: 150
        });
        
        return 'lifecycle_success';
      };

      const fallbackOperation = async () => {
        monitoringOrchestrator.recordPerformanceMetric({
          operation: 'lifecycle_fallback',
          duration: 50,
          success: true,
          fallbackUsed: true
        });
        return 'fallback_success';
      };

      // Act
      const startTime = Date.now();
      const result = await toolBoundary.execute(monitoredOperation, context, fallbackOperation);
      const endTime = Date.now();

      // Assert
      expect(result.success).toBe(true);
      expect(result.result).toBe('lifecycle_success');
      expect(attemptCount).toBe(3);

      // Verify metrics were collected
      const errorMetrics = metricsCollector.getErrorMetrics();
      expect(errorMetrics.totalErrors).toBeGreaterThan(0);
      expect(errorMetrics.errorsByType.MCPConnectionError).toBeGreaterThan(0);
      
      const performanceMetrics = performanceMonitor.getMetrics();
      expect(performanceMetrics.operations['lifecycle_test']).toBeDefined();
      expect(performanceMetrics.operations['lifecycle_test'].attempts).toBe(3);
      
      // Verify recovery was tracked
      const recoveryMetrics = metricsCollector.getRecoveryMetrics();
      expect(recoveryMetrics.totalRecoveries).toBeGreaterThan(0);
      expect(recoveryMetrics.successfulRecoveries).toBeGreaterThan(0);
    });

    it('should track error patterns and trends', async () => {
      // Arrange
      const baseContext = ErrorContextBuilder.create()
        .withSeverity(ErrorSeverity.MEDIUM)
        .withOperation('pattern_tracking', OperationPhase.TOOL_INVOCATION)
        .withExecutionState(ProcessingStage.TOOL_EXECUTION)
        .build();

      const errorPatterns = [
        new MCPConnectionError('Pattern 1: Network timeout', {
          operation: 'connect',
          serverName: 'server-1',
          recoveryActions: [RecoveryAction.RETRY_WITH_BACKOFF]
        }),
        new MCPToolError('Pattern 2: Tool execution failed', {
          toolName: 'pattern-tool',
          operation: 'execute',
          statusCode: 500,
          recoveryActions: [RecoveryAction.USE_FALLBACK]
        }),
        new AIProcessingError('Pattern 3: AI service unavailable', {
          model: 'pattern-model',
          operation: 'process',
          statusCode: 503,
          recoveryActions: [RecoveryAction.USE_FALLBACK]
        })
      ];

      // Simulate error patterns over time
      const patternOperations = errorPatterns.map((error, index) => async () => {
        monitoringOrchestrator.recordError(error, baseContext);
        throw error;
      });

      const fallback = async () => 'pattern_fallback';

      // Act - Execute patterns multiple times
      const results = [];
      for (let cycle = 0; cycle < 3; cycle++) {
        for (let patternIndex = 0; patternIndex < errorPatterns.length; patternIndex++) {
          const result = await toolBoundary.execute(
            patternOperations[patternIndex],
            baseContext,
            fallback
          );
          results.push({ cycle, patternIndex, result });
          
          // Small delay to simulate real timing
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }

      // Assert
      expect(results.every(r => r.result.fallbackUsed)).toBe(true);
      
      // Verify pattern detection
      const errorMetrics = metricsCollector.getErrorMetrics();
      expect(errorMetrics.errorsByType.MCPConnectionError).toBe(3); // 3 cycles
      expect(errorMetrics.errorsByType.MCPToolError).toBe(3);
      expect(errorMetrics.errorsByType.AIProcessingError).toBe(3);
      
      // Check time-based trends
      const timeBasedMetrics = metricsCollector.getTimeBasedMetrics(Date.now() - 60000, Date.now());
      expect(timeBasedMetrics.totalErrors).toBe(9); // 3 patterns × 3 cycles
    });
  });

  describe('Alert Generation and Management', () => {
    it('should generate appropriate alerts for different error severities', async () => {
      // Arrange
      const criticalContext = ErrorContextBuilder.create()
        .withSeverity(ErrorSeverity.CRITICAL)
        .withOperation('critical_alert_test', OperationPhase.SECURITY_CHECK)
        .withExecutionState(ProcessingStage.SECURITY_VALIDATION)
        .withUserContext('U123456789', 'C123456789', 'T123456789')
        .build();

      const highContext = ErrorContextBuilder.create()
        .withSeverity(ErrorSeverity.HIGH)
        .withOperation('high_alert_test', OperationPhase.TOOL_INVOCATION)
        .withExecutionState(ProcessingStage.TOOL_EXECUTION)
        .build();

      const mediumContext = ErrorContextBuilder.create()
        .withSeverity(ErrorSeverity.MEDIUM)
        .withOperation('medium_alert_test', OperationPhase.AI_INVOCATION)
        .withExecutionState(ProcessingStage.AI_PROCESSING)
        .build();

      const criticalError = new SecurityError('Critical security breach detected', {
        violationType: 'privilege_escalation',
        inputSource: 'user_input',
        blockedCommand: 'rm -rf /',
        recoveryActions: [RecoveryAction.ISOLATE_COMPONENT, RecoveryAction.LOG_INCIDENT]
      });

      const highError = new MCPConnectionError('All MCP servers unreachable', {
        operation: 'connect_all',
        serverName: 'all_servers',
        recoveryActions: [RecoveryAction.USE_FALLBACK]
      });

      const mediumError = new AIProcessingError('AI model degraded performance', {
        model: 'monitoring-model',
        operation: 'process',
        statusCode: 503,
        recoveryActions: [RecoveryAction.USE_FALLBACK]
      });

      // Act
      monitoringOrchestrator.recordError(criticalError, criticalContext);
      monitoringOrchestrator.recordError(highError, highContext);
      monitoringOrchestrator.recordError(mediumError, mediumContext);

      // Wait for alert processing
      await new Promise(resolve => setTimeout(resolve, 100));

      // Assert
      const activeAlerts = alertManager.getActiveAlerts();
      
      const criticalAlert = activeAlerts.find(a => a.severity === AlertSeverity.CRITICAL);
      expect(criticalAlert).toBeDefined();
      expect(criticalAlert?.title).toContain('security breach');
      expect(criticalAlert?.requiresImmediate).toBe(true);

      const highAlert = activeAlerts.find(a => a.severity === AlertSeverity.HIGH);
      expect(highAlert).toBeDefined();
      expect(highAlert?.title).toContain('MCP servers');

      const mediumAlert = activeAlerts.find(a => a.severity === AlertSeverity.MEDIUM);
      expect(mediumAlert).toBeDefined();
      expect(mediumAlert?.title).toContain('AI model');
      expect(mediumAlert?.requiresImmediate).toBe(false);
    });

    it('should manage alert lifecycle and auto-resolution', async () => {
      // Arrange
      const context = ErrorContextBuilder.create()
        .withSeverity(ErrorSeverity.HIGH)
        .withOperation('alert_lifecycle', OperationPhase.TOOL_INVOCATION)
        .withExecutionState(ProcessingStage.TOOL_EXECUTION)
        .build();

      const transientError = new MCPConnectionError('Temporary service outage', {
        operation: 'lifecycle_test',
        serverName: 'lifecycle-server',
        recoveryActions: [RecoveryAction.RETRY_WITH_BACKOFF]
      });

      // Act - Generate alert
      monitoringOrchestrator.recordError(transientError, context);
      await new Promise(resolve => setTimeout(resolve, 50));

      const initialAlerts = alertManager.getActiveAlerts();
      expect(initialAlerts.length).toBeGreaterThan(0);

      const alertId = initialAlerts[0].id;

      // Simulate recovery
      monitoringOrchestrator.recordRecovery({
        errorType: 'MCPConnectionError',
        operation: 'lifecycle_test',
        recoveryStrategy: 'retry_with_backoff',
        attempts: 2,
        success: true,
        duration: 200,
        alertId: alertId
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      // Assert
      const resolvedAlerts = alertManager.getResolvedAlerts();
      const resolvedAlert = resolvedAlerts.find(a => a.id === alertId);
      
      expect(resolvedAlert).toBeDefined();
      expect(resolvedAlert?.resolvedAt).toBeDefined();
      expect(resolvedAlert?.resolvedBy).toBe('auto_recovery');

      const activeAlerts = alertManager.getActiveAlerts();
      expect(activeAlerts.find(a => a.id === alertId)).toBeUndefined();
    });
  });

  describe('Performance Monitoring During Errors', () => {
    it('should track performance impact of error handling', async () => {
      // Arrange
      const context = ErrorContextBuilder.create()
        .withSeverity(ErrorSeverity.MEDIUM)
        .withOperation('performance_impact', OperationPhase.TOOL_INVOCATION)
        .withExecutionState(ProcessingStage.TOOL_EXECUTION)
        .build();

      let operationDurations: number[] = [];
      
      const performanceTestOperation = async () => {
        const startTime = Date.now();
        
        // Simulate processing time
        await new Promise(resolve => setTimeout(resolve, 100));
        
        throw new MCPToolError('Performance test error', {
          toolName: 'performance_tool',
          operation: 'execute',
          recoveryActions: [RecoveryAction.USE_FALLBACK]
        });
      };

      const performanceFallback = async () => {
        const startTime = Date.now();
        await new Promise(resolve => setTimeout(resolve, 50));
        const duration = Date.now() - startTime;
        
        monitoringOrchestrator.recordPerformanceMetric({
          operation: 'performance_fallback',
          duration: duration,
          success: true,
          fallbackUsed: true
        });
        
        return 'performance_fallback_success';
      };

      // Act
      const performanceResults = [];
      for (let i = 0; i < 5; i++) {
        const startTime = Date.now();
        const result = await toolBoundary.execute(performanceTestOperation, context, performanceFallback);
        const endTime = Date.now();
        
        performanceResults.push({
          duration: endTime - startTime,
          fallbackUsed: result.fallbackUsed,
          success: result.success || result.fallbackUsed
        });
      }

      // Assert
      expect(performanceResults.every(r => r.success)).toBe(true);
      expect(performanceResults.every(r => r.fallbackUsed)).toBe(true);
      
      const avgDuration = performanceResults.reduce((sum, r) => sum + r.duration, 0) / performanceResults.length;
      expect(avgDuration).toBeGreaterThan(150); // Should include error processing time
      expect(avgDuration).toBeLessThan(300); // But not excessive
      
      // Verify performance metrics were recorded
      const metrics = performanceMonitor.getMetrics();
      expect(metrics.operations['performance_fallback']).toBeDefined();
      expect(metrics.operations['performance_fallback'].averageDuration).toBeGreaterThan(40);
      expect(metrics.operations['performance_fallback'].averageDuration).toBeLessThan(70);
    });

    it('should monitor resource utilization during error scenarios', async () => {
      // Arrange
      const context = ErrorContextBuilder.create()
        .withSeverity(ErrorSeverity.HIGH)
        .withOperation('resource_monitoring', OperationPhase.TOOL_INVOCATION)
        .withExecutionState(ProcessingStage.TOOL_EXECUTION)
        .build();

      const resourceIntensiveOperation = async () => {
        // Start resource monitoring
        const initialMemory = process.memoryUsage().heapUsed;
        
        // Create memory pressure
        const largeArray = new Array(10000).fill('resource_test_data');
        
        monitoringOrchestrator.recordPerformanceMetric({
          operation: 'resource_monitoring',
          duration: 100,
          success: false,
          memoryUsage: process.memoryUsage().heapUsed - initialMemory,
          resourceIntensive: true
        });
        
        throw new MCPToolError('Resource intensive operation failed', {
          toolName: 'resource_tool',
          operation: 'process_large_data',
          memoryUsage: process.memoryUsage().heapUsed - initialMemory,
          recoveryActions: [RecoveryAction.USE_FALLBACK]
        });
      };

      const lightweightFallback = async () => {
        monitoringOrchestrator.recordPerformanceMetric({
          operation: 'lightweight_fallback',
          duration: 25,
          success: true,
          memoryUsage: process.memoryUsage().heapUsed,
          fallbackUsed: true
        });
        return 'lightweight_success';
      };

      // Act
      const result = await toolBoundary.execute(resourceIntensiveOperation, context, lightweightFallback);

      // Assert
      expect(result.fallbackUsed).toBe(true);
      expect(result.result).toBe('lightweight_success');
      
      const performanceMetrics = performanceMonitor.getMetrics();
      expect(performanceMetrics.operations['resource_monitoring']).toBeDefined();
      expect(performanceMetrics.operations['lightweight_fallback']).toBeDefined();
      
      // Verify resource usage was tracked
      const resourceMetrics = performanceMonitor.getResourceMetrics();
      expect(resourceMetrics.memoryUsage).toBeDefined();
      expect(resourceMetrics.memoryUsage.peak).toBeGreaterThan(0);
    });
  });

  describe('User Experience Monitoring', () => {
    it('should track user experience degradation during errors', async () => {
      // Arrange
      const context = ErrorContextBuilder.create()
        .withSeverity(ErrorSeverity.HIGH)
        .withOperation('user_experience_tracking', OperationPhase.TOOL_INVOCATION)
        .withExecutionState(ProcessingStage.TOOL_EXECUTION)
        .withUserContext('U123456789', 'C123456789', 'T123456789')
        .withConversationMetadata('ux-test', 'ux-thread', 'test user experience monitoring')
        .build();

      const userImpactingError = new MCPConnectionError('User-facing service degraded', {
        operation: 'user_request',
        serverName: 'user-service',
        userImpact: 'high',
        recoveryActions: [RecoveryAction.USE_FALLBACK]
      });

      const uxDegradedFallback = async () => {
        // Record user experience impact
        monitoringOrchestrator.updateUserExperience({
          userId: 'U123456789',
          threadId: 'T123456789',
          operationType: 'user_experience_tracking',
          degradationLevel: 'moderate',
          fallbackUsed: true,
          responseTime: 250,
          userSatisfaction: 'degraded'
        });
        
        return JSON.stringify({
          message: 'Your request is being processed with limited functionality',
          degraded: true,
          estimatedDelay: '30 seconds'
        });
      };

      // Act
      const result = await toolBoundary.execute(
        async () => { throw userImpactingError; },
        context,
        uxDegradedFallback
      );

      // Assert
      expect(result.fallbackUsed).toBe(true);
      const responseData = JSON.parse(result.result as string);
      expect(responseData.degraded).toBe(true);
      
      // Verify user experience was tracked
      const uxMetrics = userExperienceMonitor.getUserMetrics('U123456789');
      expect(uxMetrics.totalInteractions).toBeGreaterThan(0);
      expect(uxMetrics.degradedInteractions).toBeGreaterThan(0);
      expect(uxMetrics.averageResponseTime).toBeGreaterThan(0);
      
      const uxScore = userExperienceMonitor.calculateExperienceScore('U123456789');
      expect(uxScore).toBeLessThan(1.0); // Should be degraded
      expect(uxScore).toBeGreaterThan(0.5); // But not completely broken
    });

    it('should provide user experience insights and recommendations', async () => {
      // Arrange
      const users = ['U111111111', 'U222222222', 'U333333333'];
      const contexts = users.map(userId =>
        ErrorContextBuilder.create()
          .withSeverity(ErrorSeverity.MEDIUM)
          .withOperation('ux_insights', OperationPhase.TOOL_INVOCATION)
          .withExecutionState(ProcessingStage.TOOL_EXECUTION)
          .withUserContext(userId, 'C123456789', 'T123456789')
          .build()
      );

      // Simulate different user experience scenarios
      const scenarios = [
        { error: new MCPToolError('Slow response', { toolName: 'slow_tool', operation: 'execute' }), impact: 'low' },
        { error: new AIProcessingError('AI unavailable', { model: 'main-model', operation: 'process' }), impact: 'high' },
        { error: new MCPConnectionError('Service timeout', { operation: 'connect', serverName: 'main' }), impact: 'medium' }
      ];

      // Act
      for (let i = 0; i < users.length; i++) {
        const scenario = scenarios[i];
        
        await toolBoundary.execute(
          async () => { throw scenario.error; },
          contexts[i],
          async () => {
            monitoringOrchestrator.updateUserExperience({
              userId: users[i],
              threadId: 'T123456789',
              operationType: 'ux_insights',
              degradationLevel: scenario.impact,
              fallbackUsed: true,
              responseTime: 150 + (i * 50),
              userSatisfaction: scenario.impact === 'high' ? 'poor' : 'degraded'
            });
            return `fallback_for_${users[i]}`;
          }
        );
      }

      // Assert
      const globalUXMetrics = userExperienceMonitor.getGlobalMetrics();
      expect(globalUXMetrics.totalUsers).toBe(3);
      expect(globalUXMetrics.affectedUsers).toBe(3);
      
      const insights = userExperienceMonitor.getInsights();
      expect(insights.impactedOperations).toContain('ux_insights');
      expect(insights.recommendations).toBeDefined();
      expect(insights.recommendations.length).toBeGreaterThan(0);
      
      // Check for specific recommendations based on error patterns
      const hasPerformanceRecommendation = insights.recommendations.some(r => 
        r.category === 'performance' || r.description.includes('response time')
      );
      expect(hasPerformanceRecommendation).toBe(true);
    });
  });

  describe('MCP Health Monitoring', () => {
    it('should monitor MCP server health during error conditions', async () => {
      // Arrange
      const mcpServers = ['jenkins-mcp', 'notification-mcp', 'analytics-mcp'];
      const context = ErrorContextBuilder.create()
        .withSeverity(ErrorSeverity.HIGH)
        .withOperation('mcp_health_monitoring', OperationPhase.TOOL_INVOCATION)
        .withExecutionState(ProcessingStage.TOOL_EXECUTION)
        .build();

      // Simulate different MCP server states
      const serverErrors = mcpServers.map(serverName => 
        new MCPConnectionError(`${serverName} health check failed`, {
          operation: 'health_check',
          serverName: serverName,
          healthStatus: 'degraded',
          recoveryActions: [RecoveryAction.MONITOR_HEALTH]
        })
      );

      // Act
      for (let i = 0; i < serverErrors.length; i++) {
        const error = serverErrors[i];
        const serverName = mcpServers[i];
        
        // Record health degradation
        mcpHealthMonitor.recordServerError(serverName, error);
        monitoringOrchestrator.recordError(error, context);
        
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      // Assert
      const healthStatus = mcpHealthMonitor.getOverallHealth();
      expect(healthStatus.status).toBe('degraded');
      expect(healthStatus.healthyServers).toBeLessThan(mcpServers.length);
      expect(healthStatus.degradedServers).toBeGreaterThan(0);
      
      const serverHealth = mcpHealthMonitor.getServerHealth();
      mcpServers.forEach(serverName => {
        expect(serverHealth[serverName]).toBeDefined();
        expect(serverHealth[serverName].status).toBe('degraded');
        expect(serverHealth[serverName].lastError).toBeDefined();
      });
    });

    it('should track MCP server recovery and auto-healing', async () => {
      // Arrange
      const serverName = 'recovery-test-mcp';
      const context = ErrorContextBuilder.create()
        .withSeverity(ErrorSeverity.MEDIUM)
        .withOperation('mcp_recovery_tracking', OperationPhase.TOOL_INVOCATION)
        .withExecutionState(ProcessingStage.TOOL_EXECUTION)
        .build();

      // Simulate server failure
      const serverError = new MCPConnectionError('Server temporarily down', {
        operation: 'connect',
        serverName: serverName,
        recoveryActions: [RecoveryAction.MONITOR_HEALTH, RecoveryAction.RETRY_WITH_BACKOFF]
      });

      // Act - Record failure
      mcpHealthMonitor.recordServerError(serverName, serverError);
      expect(mcpHealthMonitor.getServerHealth()[serverName]?.status).toBe('unhealthy');

      // Simulate recovery
      await new Promise(resolve => setTimeout(resolve, 100));
      
      mcpHealthMonitor.recordServerRecovery(serverName, {
        previousState: 'unhealthy',
        recoveryDuration: 100,
        recoveryMethod: 'auto_healing'
      });

      // Assert
      const recoveredHealth = mcpHealthMonitor.getServerHealth()[serverName];
      expect(recoveredHealth?.status).toBe('healthy');
      expect(recoveredHealth?.lastRecovery).toBeDefined();
      expect(recoveredHealth?.recoveryCount).toBeGreaterThan(0);
      
      const healthHistory = mcpHealthMonitor.getHealthHistory(serverName);
      expect(healthHistory.events.length).toBeGreaterThanOrEqual(2); // Error + Recovery
      expect(healthHistory.events.some(e => e.type === 'error')).toBe(true);
      expect(healthHistory.events.some(e => e.type === 'recovery')).toBe(true);
    });
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await monitoringOrchestrator.shutdown();
  });
});