#!/usr/bin/env ts-node
/**
 * Performance Testing Script for Monitoring System
 * Tests the overhead and scalability of the monitoring system
 */

import { createMonitoringSystem } from '../src/monitoring';
import { ErrorCategory, ErrorSeverity } from '../src/errors/types';

interface PerformanceResult {
  operation: string;
  totalTime: number;
  avgTime: number;
  minTime: number;
  maxTime: number;
  throughput: number;
  memoryUsed: number;
}

async function measurePerformance(
  operation: string,
  testFunction: () => void | Promise<void>,
  iterations: number = 1000
): Promise<PerformanceResult> {
  const times: number[] = [];
  const initialMemory = process.memoryUsage().heapUsed;
  
  console.log(`⚡ Testing ${operation} (${iterations} iterations)...`);
  
  // Warmup
  for (let i = 0; i < 10; i++) {
    await testFunction();
  }
  
  // Actual test
  for (let i = 0; i < iterations; i++) {
    const start = process.hrtime.bigint();
    await testFunction();
    const end = process.hrtime.bigint();
    times.push(Number(end - start) / 1000000); // Convert to milliseconds
  }
  
  const finalMemory = process.memoryUsage().heapUsed;
  const totalTime = times.reduce((sum, time) => sum + time, 0);
  
  return {
    operation,
    totalTime,
    avgTime: totalTime / iterations,
    minTime: Math.min(...times),
    maxTime: Math.max(...times),
    throughput: iterations / (totalTime / 1000), // operations per second
    memoryUsed: finalMemory - initialMemory
  };
}

async function testMonitoringPerformance() {
  console.log('🚀 Starting Monitoring Performance Tests\n');

  const monitoring = createMonitoringSystem({
    mcpServers: ['jenkins-perf', 'ai-perf'],
    alerting: { enabled: false }, // Disable for pure performance testing
    dashboard: { enabled: false }
  });

  await monitoring.initialize();
  await monitoring.start();

  const results: PerformanceResult[] = [];

  try {
    // Test 1: Error recording performance
    console.log('🧪 TEST 1: Error Recording Performance');
    const errorRecordingResult = await measurePerformance(
      'Error Recording',
      () => {
        monitoring.recordError({
          category: ErrorCategory.MCP_TOOL,
          severity: ErrorSeverity.MEDIUM,
          message: 'Performance test error',
          operation: 'perf_test',
          userId: `user${Math.floor(Math.random() * 1000)}`,
          context: { timestamp: Date.now() }
        });
      },
      1000
    );
    results.push(errorRecordingResult);

    // Test 2: Operation recording performance
    console.log('🧪 TEST 2: Operation Recording Performance');
    const operationRecordingResult = await measurePerformance(
      'Operation Recording',
      () => {
        monitoring.recordOperation({
          name: 'perf_test_operation',
          duration: Math.floor(Math.random() * 1000) + 100,
          success: Math.random() > 0.1,
          userId: `user${Math.floor(Math.random() * 1000)}`,
          context: { test: true }
        });
      },
      1000
    );
    results.push(operationRecordingResult);

    // Test 3: Snapshot generation performance
    console.log('🧪 TEST 3: Snapshot Generation Performance');
    const snapshotResult = await measurePerformance(
      'Snapshot Generation',
      () => {
        monitoring.getSnapshot();
      },
      100
    );
    results.push(snapshotResult);

    // Test 4: Health status calculation performance
    console.log('🧪 TEST 4: Health Status Calculation Performance');
    const healthStatusResult = await measurePerformance(
      'Health Status Calculation',
      () => {
        monitoring.getHealthStatus();
      },
      100
    );
    results.push(healthStatusResult);

    // Test 5: Concurrent error recording
    console.log('🧪 TEST 5: Concurrent Error Recording');
    const concurrentStart = process.hrtime.bigint();
    const concurrentPromises = Array.from({ length: 100 }, (_, i) =>
      Promise.all(Array.from({ length: 10 }, (_, j) =>
        Promise.resolve().then(() => {
          monitoring.recordError({
            category: ErrorCategory.AI_PROCESSING,
            severity: ErrorSeverity.HIGH,
            message: `Concurrent error ${i}-${j}`,
            operation: 'concurrent_test',
            context: { batch: i, item: j }
          });
        })
      ))
    );
    
    await Promise.all(concurrentPromises);
    const concurrentEnd = process.hrtime.bigint();
    const concurrentTime = Number(concurrentEnd - concurrentStart) / 1000000;
    
    results.push({
      operation: 'Concurrent Error Recording (1000 errors)',
      totalTime: concurrentTime,
      avgTime: concurrentTime / 1000,
      minTime: 0,
      maxTime: 0,
      throughput: 1000 / (concurrentTime / 1000),
      memoryUsed: 0
    });

    // Test 6: Memory usage under load
    console.log('🧪 TEST 6: Memory Usage Under Load');
    const initialMemory = process.memoryUsage();
    
    // Generate load
    for (let i = 0; i < 10000; i++) {
      monitoring.recordError({
        category: ErrorCategory.SYSTEM,
        severity: ErrorSeverity.LOW,
        message: `Load test error ${i}`,
        operation: 'load_test',
        context: { iteration: i, data: 'x'.repeat(100) }
      });
      
      if (i % 1000 === 0) {
        monitoring.recordOperation({
          name: 'load_test_operation',
          duration: Math.random() * 1000,
          success: true,
          context: { batch: Math.floor(i / 1000) }
        });
      }
    }
    
    const finalMemory = process.memoryUsage();
    
    console.log('\n📊 PERFORMANCE RESULTS:');
    console.log('═'.repeat(80));
    
    results.forEach(result => {
      console.log(`\n📈 ${result.operation}:`);
      console.log(`   Total Time: ${result.totalTime.toFixed(2)}ms`);
      console.log(`   Avg Time: ${result.avgTime.toFixed(3)}ms`);
      console.log(`   Min Time: ${result.minTime.toFixed(3)}ms`);
      console.log(`   Max Time: ${result.maxTime.toFixed(3)}ms`);
      console.log(`   Throughput: ${result.throughput.toFixed(0)} ops/sec`);
      if (result.memoryUsed > 0) {
        console.log(`   Memory Used: ${(result.memoryUsed / 1024 / 1024).toFixed(2)} MB`);
      }
    });

    console.log('\n🧠 MEMORY USAGE:');
    console.log(`   Initial Heap: ${(initialMemory.heapUsed / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   Final Heap: ${(finalMemory.heapUsed / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   Memory Growth: ${((finalMemory.heapUsed - initialMemory.heapUsed) / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   RSS: ${(finalMemory.rss / 1024 / 1024).toFixed(2)} MB`);

    // Performance benchmarks
    console.log('\n🎯 PERFORMANCE BENCHMARKS:');
    console.log('═'.repeat(50));
    
    const errorResult = results.find(r => r.operation === 'Error Recording');
    if (errorResult) {
      if (errorResult.avgTime < 1) {
        console.log('   ✅ Error Recording: EXCELLENT (<1ms avg)');
      } else if (errorResult.avgTime < 5) {
        console.log('   ✅ Error Recording: GOOD (<5ms avg)');
      } else {
        console.log('   ⚠️  Error Recording: NEEDS OPTIMIZATION (>5ms avg)');
      }
    }

    const throughputResult = results.find(r => r.operation.includes('Concurrent'));
    if (throughputResult && throughputResult.throughput > 1000) {
      console.log('   ✅ Concurrent Throughput: EXCELLENT (>1000 ops/sec)');
    } else if (throughputResult && throughputResult.throughput > 500) {
      console.log('   ✅ Concurrent Throughput: GOOD (>500 ops/sec)');
    } else {
      console.log('   ⚠️  Concurrent Throughput: NEEDS OPTIMIZATION (<500 ops/sec)');
    }

    const memoryGrowth = (finalMemory.heapUsed - initialMemory.heapUsed) / 1024 / 1024;
    if (memoryGrowth < 50) {
      console.log('   ✅ Memory Usage: EXCELLENT (<50MB growth)');
    } else if (memoryGrowth < 100) {
      console.log('   ✅ Memory Usage: GOOD (<100MB growth)');
    } else {
      console.log('   ⚠️  Memory Usage: NEEDS OPTIMIZATION (>100MB growth)');
    }

  } catch (error) {
    console.error('❌ Performance test failed:', error);
  } finally {
    await monitoring.stop();
    console.log('\n✅ Performance testing completed!');
  }
}

if (require.main === module) {
  testMonitoringPerformance().catch(console.error);
}