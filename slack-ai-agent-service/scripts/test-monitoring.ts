#!/usr/bin/env ts-node
/**
 * Manual Testing Script for Monitoring System
 * Run with: npx ts-node scripts/test-monitoring.ts
 */

import { createMonitoringSystem } from '../src/monitoring';
import { ErrorCategory, ErrorSeverity } from '../src/errors/types';

async function testMonitoringSystem() {
  console.log('🚀 Starting Monitoring System Test\n');

  // Create monitoring system
  const monitoring = createMonitoringSystem({
    mcpServers: ['jenkins-test', 'ai-test'],
    alerting: {
      enabled: true,
      channels: ['console']
    },
    dashboard: {
      enabled: false // Keep disabled for testing
    }
  });

  // Set up event listeners
  monitoring.on('alert:created', (alert) => {
    console.log(`🚨 ALERT CREATED: ${alert.title} (${alert.severity})`);
    console.log(`   Description: ${alert.description}`);
    console.log(`   Source: ${alert.source}\n`);
  });

  monitoring.on('health:check', (health) => {
    console.log(`❤️  HEALTH CHECK: Overall ${health.overall} (${health.score}/100)`);
    console.log(`   Components: ${JSON.stringify(health.components, null, 2)}\n`);
  });

  monitoring.on('mcp:status_changed', (event) => {
    console.log(`🔄 MCP STATUS: ${event.serverId} changed from ${event.previousStatus} to ${event.currentStatus}`);
  });

  try {
    // Initialize and start
    console.log('📊 Initializing monitoring system...');
    await monitoring.initialize();
    
    console.log('▶️  Starting monitoring...');
    await monitoring.start();

    // Test 1: Record various errors
    console.log('\n🧪 TEST 1: Recording different types of errors');
    
    const errorTests = [
      {
        category: ErrorCategory.MCP_TOOL,
        severity: ErrorSeverity.HIGH,
        message: 'Jenkins job execution failed',
        userId: 'user123',
        sessionId: 'session456',
        operation: 'trigger_job',
        context: { toolType: 'jenkins', jobName: 'deploy-prod' }
      },
      {
        category: ErrorCategory.AI_PROCESSING,
        severity: ErrorSeverity.MEDIUM,
        message: 'AI model timeout',
        operation: 'ai_analysis',
        context: { model: 'claude-3', timeout: 30000 }
      },
      {
        category: ErrorCategory.CONFIGURATION,
        severity: ErrorSeverity.LOW,
        message: 'Invalid configuration parameter',
        operation: 'config_validation',
        context: { parameter: 'timeout_ms' }
      }
    ];

    for (const error of errorTests) {
      monitoring.recordError(error);
      console.log(`   ✅ Recorded ${error.severity} ${error.category} error`);
    }

    // Test 2: Record operations
    console.log('\n🧪 TEST 2: Recording operation performance');
    
    const operations = [
      { name: 'slack_message_processing', duration: 150, success: true },
      { name: 'mcp_tool_execution', duration: 2500, success: true },
      { name: 'ai_model_inference', duration: 8000, success: false },
      { name: 'user_authentication', duration: 50, success: true }
    ];

    for (const op of operations) {
      monitoring.recordOperation(op);
      console.log(`   ✅ Recorded ${op.name}: ${op.duration}ms (${op.success ? 'success' : 'failed'})`);
    }

    // Test 3: Get system snapshot
    console.log('\n🧪 TEST 3: System snapshot');
    const snapshot = monitoring.getSnapshot();
    
    console.log('📈 METRICS SNAPSHOT:');
    console.log(`   Total Errors: ${snapshot.metrics.totalErrors}`);
    console.log(`   Error Rate: ${snapshot.metrics.errorRate.toFixed(2)}%`);
    console.log(`   Avg Response Time: ${snapshot.metrics.avgResponseTime.toFixed(0)}ms`);
    console.log(`   Active Users: ${snapshot.metrics.activeUsers}`);
    
    console.log('🏥 SYSTEM HEALTH:');
    console.log(`   Overall: ${snapshot.systemHealth.overall} (${snapshot.systemHealth.score}/100)`);
    console.log(`   MCP Servers: ${snapshot.mcpServers.healthy}/${snapshot.mcpServers.total} healthy`);
    console.log(`   Alerts: ${snapshot.alerts.active} active (${snapshot.alerts.critical} critical)`);

    // Test 4: Stress test to trigger alerts
    console.log('\n🧪 TEST 4: Stress testing to trigger alerts');
    
    for (let i = 0; i < 15; i++) {
      monitoring.recordError({
        category: ErrorCategory.MCP_TOOL,
        severity: ErrorSeverity.CRITICAL,
        message: `Critical system failure ${i}`,
        operation: 'stress_test',
        context: { iteration: i }
      });
    }
    
    console.log('   ✅ Recorded 15 critical errors to trigger alerts');

    // Test 5: Export metrics
    console.log('\n🧪 TEST 5: Export metrics for external systems');
    const exportedMetrics = monitoring.getMetricsForExport();
    
    console.log('📤 EXPORTED METRICS:');
    Object.entries(exportedMetrics).forEach(([key, value]) => {
      console.log(`   ${key}: ${typeof value === 'number' ? value.toFixed(2) : value}`);
    });

    // Test 6: Health status
    console.log('\n🧪 TEST 6: Health status check');
    const health = monitoring.getHealthStatus();
    
    console.log('🏥 DETAILED HEALTH STATUS:');
    console.log(`   Overall Status: ${health.overall}`);
    console.log(`   Health Score: ${health.score}/100`);
    console.log('   Component Health:');
    Object.entries(health.components).forEach(([component, status]) => {
      console.log(`     ${component}: ${status}`);
    });

    // Wait for some async operations
    console.log('\n⏳ Waiting for background processes...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Final snapshot
    const finalSnapshot = monitoring.getSnapshot();
    console.log('\n📊 FINAL SNAPSHOT:');
    console.log(`   System Health: ${finalSnapshot.systemHealth.overall} (${finalSnapshot.systemHealth.score}/100)`);
    console.log(`   Total Errors: ${finalSnapshot.metrics.totalErrors}`);
    console.log(`   Active Alerts: ${finalSnapshot.alerts.active}`);

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    // Cleanup
    console.log('\n🧹 Cleaning up...');
    await monitoring.stop();
    console.log('✅ Test completed successfully!');
    
    process.exit(0);
  }
}

// Handle process signals
process.on('SIGINT', () => {
  console.log('\n👋 Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n👋 Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

// Run the test
if (require.main === module) {
  testMonitoringSystem().catch(console.error);
}

export { testMonitoringSystem };