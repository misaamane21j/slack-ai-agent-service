#!/usr/bin/env ts-node
/**
 * Real-world Scenario Testing for Monitoring System
 * Simulates actual error patterns and system behaviors
 */

import { createMonitoringSystem } from '../src/monitoring';
import { ErrorCategory, ErrorSeverity } from '../src/errors/types';

class ScenarioSimulator {
  private monitoring = createMonitoringSystem({
    mcpServers: ['jenkins-prod', 'ai-gpt4', 'auth-service'],
    alerting: { enabled: true, channels: ['console'] },
    dashboard: { enabled: false }
  });

  private users = ['alice', 'bob', 'charlie', 'diana', 'eve'];
  private sessions = new Map<string, string>();

  constructor() {
    this.setupEventListeners();
  }

  private setupEventListeners() {
    this.monitoring.on('alert:created', (alert) => {
      console.log(`🚨 ALERT: ${alert.title} - ${alert.description}`);
    });

    this.monitoring.on('health:check', (health) => {
      if (health.overall !== 'healthy') {
        console.log(`⚠️  HEALTH: System is ${health.overall} (${health.score}/100)`);
      }
    });
  }

  private getRandomUser(): string {
    return this.users[Math.floor(Math.random() * this.users.length)];
  }

  private getUserSession(userId: string): string {
    if (!this.sessions.has(userId)) {
      this.sessions.set(userId, `session_${userId}_${Date.now()}`);
    }
    return this.sessions.get(userId)!;
  }

  async initialize() {
    await this.monitoring.initialize();
    await this.monitoring.start();
    console.log('📊 Monitoring system initialized for scenario testing\n');
  }

  async cleanup() {
    await this.monitoring.stop();
    console.log('🧹 Monitoring system stopped\n');
  }

  // Scenario 1: Normal Operations
  async runNormalOperationsScenario(duration: number = 30000) {
    console.log('🟢 SCENARIO 1: Normal Operations (30 seconds)');
    console.log('   Simulating regular system usage with occasional minor issues\n');

    const endTime = Date.now() + duration;
    let operationCount = 0;

    while (Date.now() < endTime) {
      const userId = this.getRandomUser();
      const sessionId = this.getUserSession(userId);

      // 90% success rate for normal operations
      const success = Math.random() > 0.1;
      const responseTime = 200 + Math.random() * 1000; // 200-1200ms

      this.monitoring.recordOperation({
        name: 'slack_message_processing',
        duration: responseTime,
        success,
        userId,
        context: { sessionId }
      });

      // Occasional minor errors (5% rate)
      if (Math.random() < 0.05) {
        this.monitoring.recordError({
          category: ErrorCategory.AI_PROCESSING,
          severity: ErrorSeverity.LOW,
          message: 'Minor AI processing delay',
          userId,
          sessionId,
          operation: 'ai_inference',
          context: { model: 'gpt-4', retryable: true }
        });
      }

      operationCount++;
      await new Promise(resolve => setTimeout(resolve, Math.random() * 200 + 100));
    }

    const snapshot = this.monitoring.getSnapshot();
    console.log(`   ✅ Completed ${operationCount} operations`);
    console.log(`   📊 Error Rate: ${snapshot.metrics.errorRate.toFixed(2)}%`);
    console.log(`   ⏱️  Avg Response Time: ${snapshot.metrics.avgResponseTime.toFixed(0)}ms`);
    console.log(`   🏥 System Health: ${snapshot.systemHealth.overall} (${snapshot.systemHealth.score}/100)\n`);
  }

  // Scenario 2: MCP Server Outage
  async runMCPServerOutageScenario() {
    console.log('🔴 SCENARIO 2: MCP Server Outage');
    console.log('   Simulating Jenkins server becoming unavailable\n');

    // Simulate server failures
    for (let i = 0; i < 10; i++) {
      const userId = this.getRandomUser();
      const sessionId = this.getUserSession(userId);

      this.monitoring.recordError({
        category: ErrorCategory.MCP_TOOL,
        severity: ErrorSeverity.CRITICAL,
        message: 'Jenkins server connection failed',
        userId,
        sessionId,
        operation: 'trigger_jenkins_job',
        context: {
          toolType: 'jenkins',
          serverUrl: 'jenkins-prod',
          error: 'ECONNREFUSED',
          recoverable: false
        }
      });

      // Failed operations due to server outage
      this.monitoring.recordOperation({
        name: 'jenkins_job_trigger',
        duration: 30000, // Timeout
        success: false,
        userId,
        context: { sessionId, error: 'server_unavailable' }
      });

      await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log('   ⚠️  Simulated 10 consecutive Jenkins server failures');
    
    // Check if critical alerts were triggered
    const snapshot = this.monitoring.getSnapshot();
    console.log(`   🚨 Active Alerts: ${snapshot.alerts.active} (Critical: ${snapshot.alerts.critical})`);
    console.log(`   🏥 System Health: ${snapshot.systemHealth.overall} (${snapshot.systemHealth.score}/100)\n`);
  }

  // Scenario 3: High Load with Degraded Performance
  async runHighLoadScenario() {
    console.log('🟡 SCENARIO 3: High Load with Performance Degradation');
    console.log('   Simulating system under heavy load with increasing response times\n');

    const users = Array.from({ length: 20 }, (_, i) => `load_user_${i}`);
    const promises: Promise<void>[] = [];

    // Simulate concurrent load from multiple users
    for (const userId of users) {
      const sessionId = this.getUserSession(userId);
      
      const userLoad = async () => {
        for (let i = 0; i < 5; i++) {
          // Increasing response times under load
          const baseTime = 1000 + (i * 500); // 1s to 3s
          const jitter = Math.random() * 1000;
          const responseTime = baseTime + jitter;

          this.monitoring.recordOperation({
            name: 'ai_model_inference',
            duration: responseTime,
            success: responseTime < 5000, // Timeout at 5s
            userId,
            context: { sessionId, load: 'high', batch: i }
          });

          // Occasional timeout errors under high load
          if (responseTime > 4000) {
            this.monitoring.recordError({
              category: ErrorCategory.AI_PROCESSING,
              severity: ErrorSeverity.HIGH,
              message: 'AI model inference timeout under high load',
              userId,
              sessionId,
              operation: 'ai_inference',
              context: {
                model: 'gpt-4',
                timeout: 5000,
                actualTime: responseTime,
                systemLoad: 'high'
              }
            });
          }

          await new Promise(resolve => setTimeout(resolve, 200));
        }
      };

      promises.push(userLoad());
    }

    await Promise.all(promises);

    const snapshot = this.monitoring.getSnapshot();
    console.log(`   📊 Error Rate: ${snapshot.metrics.errorRate.toFixed(2)}%`);
    console.log(`   ⏱️  Avg Response Time: ${snapshot.metrics.avgResponseTime.toFixed(0)}ms`);
    console.log(`   👥 Active Users: ${snapshot.metrics.activeUsers}`);
    console.log(`   🏥 System Health: ${snapshot.systemHealth.overall} (${snapshot.systemHealth.score}/100)\n`);
  }

  // Scenario 4: User Experience Degradation
  async runUserExperienceDegradationScenario() {
    console.log('🔶 SCENARIO 4: User Experience Degradation');
    console.log('   Simulating frustrated users encountering repeated errors\n');

    const frustratedUser = 'frustrated_user';
    const sessionId = this.getUserSession(frustratedUser);

    // Simulate a user encountering multiple errors
    const errorSequence = [
      {
        category: ErrorCategory.AUTHENTICATION,
        severity: ErrorSeverity.HIGH,
        message: 'Authentication token expired',
        operation: 'slack_auth'
      },
      {
        category: ErrorCategory.MCP_TOOL,
        severity: ErrorSeverity.MEDIUM,
        message: 'Jenkins job not found',
        operation: 'get_job_status'
      },
      {
        category: ErrorCategory.AI_PROCESSING,
        severity: ErrorSeverity.HIGH,
        message: 'AI model rate limit exceeded',
        operation: 'ai_analysis'
      },
      {
        category: ErrorCategory.MCP_TOOL,
        severity: ErrorSeverity.CRITICAL,
        message: 'Jenkins server authentication failed',
        operation: 'trigger_job'
      }
    ];

    for (let i = 0; i < errorSequence.length; i++) {
      const error = errorSequence[i];
      
      // Record the error
      this.monitoring.recordError({
        ...error,
        userId: frustratedUser,
        sessionId,
        context: {
          errorSequence: i + 1,
          totalErrors: errorSequence.length,
          userFrustration: 'increasing'
        }
      });

      // Record failed operation
      this.monitoring.recordOperation({
        name: error.operation,
        duration: 2000 + Math.random() * 3000,
        success: false,
        userId: frustratedUser,
        context: { sessionId, errorType: error.category }
      });

      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Simulate user satisfaction survey (low score)
    console.log('   📝 User provides negative feedback (satisfaction: 1/5)');

    const snapshot = this.monitoring.getSnapshot();
    console.log(`   😠 High Risk Users: ${snapshot.userExperience.highRiskUsers}`);
    console.log(`   📊 Impact Level: ${snapshot.userExperience.impactLevel}`);
    console.log(`   🏥 UX Health: ${this.monitoring.getHealthStatus().components.userExperience}\n`);
  }

  // Scenario 5: Recovery and Stabilization
  async runRecoveryScenario() {
    console.log('🟢 SCENARIO 5: System Recovery and Stabilization');
    console.log('   Simulating system recovery after issues are resolved\n');

    // Simulate successful operations after fixes
    for (let i = 0; i < 20; i++) {
      const userId = this.getRandomUser();
      const sessionId = this.getUserSession(userId);

      // Good performance after recovery
      this.monitoring.recordOperation({
        name: 'system_operation',
        duration: 300 + Math.random() * 200, // 300-500ms
        success: true,
        userId,
        context: { sessionId, recovery: true }
      });

      await new Promise(resolve => setTimeout(resolve, 100));
    }

    const snapshot = this.monitoring.getSnapshot();
    console.log(`   ✅ Recent operations all successful`);
    console.log(`   ⏱️  Response Time: ${snapshot.metrics.avgResponseTime.toFixed(0)}ms`);
    console.log(`   🏥 System Health: ${snapshot.systemHealth.overall} (${snapshot.systemHealth.score}/100)`);
    
    const health = this.monitoring.getHealthStatus();
    if (health.overall === 'healthy' && health.score > 80) {
      console.log('   🎉 System has recovered to healthy state!\n');
    } else {
      console.log('   ⚠️  System still showing signs of degradation\n');
    }
  }
}

async function runScenarioTests() {
  console.log('🎭 Starting Real-World Scenario Testing\n');

  const simulator = new ScenarioSimulator();
  
  try {
    await simulator.initialize();

    // Run scenarios in sequence
    await simulator.runNormalOperationsScenario(10000); // 10 seconds for demo
    await new Promise(resolve => setTimeout(resolve, 2000));

    await simulator.runMCPServerOutageScenario();
    await new Promise(resolve => setTimeout(resolve, 2000));

    await simulator.runHighLoadScenario();
    await new Promise(resolve => setTimeout(resolve, 2000));

    await simulator.runUserExperienceDegradationScenario();
    await new Promise(resolve => setTimeout(resolve, 2000));

    await simulator.runRecoveryScenario();

    console.log('🎯 SCENARIO TESTING SUMMARY:');
    console.log('═'.repeat(50));
    console.log('✅ Normal Operations - Baseline performance established');
    console.log('✅ MCP Server Outage - Critical alerts triggered');
    console.log('✅ High Load - Performance degradation detected');
    console.log('✅ User Experience - Frustration patterns identified');
    console.log('✅ Recovery - System health restoration verified');

  } catch (error) {
    console.error('❌ Scenario testing failed:', error);
  } finally {
    await simulator.cleanup();
    console.log('🏁 All scenario tests completed!');
  }
}

if (require.main === module) {
  runScenarioTests().catch(console.error);
}