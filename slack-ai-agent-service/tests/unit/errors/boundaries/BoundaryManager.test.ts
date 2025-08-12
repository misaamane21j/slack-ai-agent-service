/**
 * Unit tests for Boundary Manager
 */

import {
  BoundaryManager,
  BoundaryType,
  BoundaryState,
  ToolExecutionBoundary,
  RegistryBoundary,
  AIProcessingBoundary,
  ConfigurationBoundary,
  SlackResponseBoundary
} from '../../../../src/errors/boundaries';

describe('BoundaryManager', () => {
  let manager: BoundaryManager;

  beforeEach(() => {
    manager = new BoundaryManager();
  });

  describe('initialization', () => {
    it('should initialize all boundary types', () => {
      const states = manager.getAllBoundaryStates();
      
      expect(states[BoundaryType.TOOL_EXECUTION]).toBe(BoundaryState.HEALTHY);
      expect(states[BoundaryType.REGISTRY]).toBe(BoundaryState.HEALTHY);
      expect(states[BoundaryType.AI_PROCESSING]).toBe(BoundaryState.HEALTHY);
      expect(states[BoundaryType.CONFIGURATION]).toBe(BoundaryState.HEALTHY);
      expect(states[BoundaryType.SLACK_RESPONSE]).toBe(BoundaryState.HEALTHY);
    });

    it('should create boundaries with correct types', () => {
      const toolBoundary = manager.getToolExecutionBoundary();
      const registryBoundary = manager.getRegistryBoundary();
      const aiBoundary = manager.getAIProcessingBoundary();
      const configBoundary = manager.getConfigurationBoundary();
      const slackBoundary = manager.getSlackResponseBoundary();

      expect(toolBoundary).toBeInstanceOf(ToolExecutionBoundary);
      expect(registryBoundary).toBeInstanceOf(RegistryBoundary);
      expect(aiBoundary).toBeInstanceOf(AIProcessingBoundary);
      expect(configBoundary).toBeInstanceOf(ConfigurationBoundary);
      expect(slackBoundary).toBeInstanceOf(SlackResponseBoundary);
    });
  });

  describe('boundary access', () => {
    it('should get specific boundary by type', () => {
      const toolBoundary = manager.getBoundary<ToolExecutionBoundary>(BoundaryType.TOOL_EXECUTION);
      expect(toolBoundary).toBeInstanceOf(ToolExecutionBoundary);
    });

    it('should throw error for non-existent boundary type', () => {
      const invalidType = 'INVALID_TYPE' as BoundaryType;
      expect(() => manager.getBoundary(invalidType)).toThrow('Boundary INVALID_TYPE not found');
    });

    it('should provide typed access methods', () => {
      expect(manager.getToolExecutionBoundary()).toBeInstanceOf(ToolExecutionBoundary);
      expect(manager.getRegistryBoundary()).toBeInstanceOf(RegistryBoundary);
      expect(manager.getAIProcessingBoundary()).toBeInstanceOf(AIProcessingBoundary);
      expect(manager.getConfigurationBoundary()).toBeInstanceOf(ConfigurationBoundary);
      expect(manager.getSlackResponseBoundary()).toBeInstanceOf(SlackResponseBoundary);
    });
  });

  describe('state management', () => {
    it('should get all boundary states', () => {
      const states = manager.getAllBoundaryStates();
      
      expect(Object.keys(states)).toHaveLength(5);
      expect(states[BoundaryType.TOOL_EXECUTION]).toBe(BoundaryState.HEALTHY);
      expect(states[BoundaryType.REGISTRY]).toBe(BoundaryState.HEALTHY);
      expect(states[BoundaryType.AI_PROCESSING]).toBe(BoundaryState.HEALTHY);
      expect(states[BoundaryType.CONFIGURATION]).toBe(BoundaryState.HEALTHY);
      expect(states[BoundaryType.SLACK_RESPONSE]).toBe(BoundaryState.HEALTHY);
    });

    it('should get all boundary metrics', () => {
      const metrics = manager.getAllBoundaryMetrics();
      
      expect(Object.keys(metrics)).toHaveLength(5);
      expect(metrics[BoundaryType.TOOL_EXECUTION].errorCount).toBe(0);
      expect(metrics[BoundaryType.REGISTRY].errorCount).toBe(0);
    });

    it('should reset all boundaries', () => {
      // Force some boundaries into different states
      manager.isolateBoundary(BoundaryType.TOOL_EXECUTION);
      manager.isolateBoundary(BoundaryType.REGISTRY);
      
      const statesBefore = manager.getAllBoundaryStates();
      expect(statesBefore[BoundaryType.TOOL_EXECUTION]).toBe(BoundaryState.ISOLATED);
      expect(statesBefore[BoundaryType.REGISTRY]).toBe(BoundaryState.ISOLATED);
      
      manager.resetAllBoundaries();
      
      const statesAfter = manager.getAllBoundaryStates();
      expect(statesAfter[BoundaryType.TOOL_EXECUTION]).toBe(BoundaryState.HEALTHY);
      expect(statesAfter[BoundaryType.REGISTRY]).toBe(BoundaryState.HEALTHY);
    });
  });

  describe('isolation management', () => {
    it('should isolate specific boundary', () => {
      manager.isolateBoundary(BoundaryType.TOOL_EXECUTION, 5000);
      
      const toolBoundary = manager.getToolExecutionBoundary();
      expect(toolBoundary.isIsolated()).toBe(true);
      expect(toolBoundary.getState()).toBe(BoundaryState.ISOLATED);
    });

    it('should detect isolated boundaries', () => {
      expect(manager.hasIsolatedBoundaries()).toBe(false);
      
      manager.isolateBoundary(BoundaryType.AI_PROCESSING);
      
      expect(manager.hasIsolatedBoundaries()).toBe(true);
    });

    it('should get list of isolated boundaries', () => {
      manager.isolateBoundary(BoundaryType.TOOL_EXECUTION);
      manager.isolateBoundary(BoundaryType.CONFIGURATION);
      
      const isolated = manager.getIsolatedBoundaries();
      
      expect(isolated).toHaveLength(2);
      expect(isolated).toContain(BoundaryType.TOOL_EXECUTION);
      expect(isolated).toContain(BoundaryType.CONFIGURATION);
    });

    it('should handle isolation of non-existent boundary gracefully', () => {
      const invalidType = 'INVALID_TYPE' as BoundaryType;
      
      // Should not throw error
      expect(() => manager.isolateBoundary(invalidType)).not.toThrow();
    });
  });

  describe('system health status', () => {
    it('should report healthy status when all boundaries are healthy', () => {
      const health = manager.getSystemHealthStatus();
      
      expect(health.overall).toBe('healthy');
      expect(health.isolatedCount).toBe(0);
      expect(health.degradedCount).toBe(0);
      expect(health.failedCount).toBe(0);
    });

    it('should report degraded status when some boundaries are degraded', () => {
      // Force a boundary into degraded state by simulating errors
      const toolBoundary = manager.getToolExecutionBoundary();
      
      // Access private method to force state change for testing
      (toolBoundary as any).recordError(new Error('Test error'));
      (toolBoundary as any).recordError(new Error('Test error'));
      (toolBoundary as any).updateBoundaryState();
      
      const health = manager.getSystemHealthStatus();
      
      expect(health.overall).toBe('degraded');
      expect(health.degradedCount).toBe(1);
    });

    it('should report critical status when boundaries are isolated', () => {
      manager.isolateBoundary(BoundaryType.TOOL_EXECUTION);
      
      const health = manager.getSystemHealthStatus();
      
      expect(health.overall).toBe('critical');
      expect(health.isolatedCount).toBe(1);
    });

    it('should report critical status when multiple boundaries fail', () => {
      // Force multiple boundaries into failed state
      const toolBoundary = manager.getToolExecutionBoundary();
      const registryBoundary = manager.getRegistryBoundary();
      
      // Simulate escalation threshold errors
      for (let i = 0; i < 7; i++) {
        (toolBoundary as any).recordError(new Error('Test error'));
        (registryBoundary as any).recordError(new Error('Test error'));
      }
      (toolBoundary as any).updateBoundaryState();
      (registryBoundary as any).updateBoundaryState();
      
      const health = manager.getSystemHealthStatus();
      
      expect(health.overall).toBe('critical');
      expect(health.failedCount).toBe(2);
    });

    it('should provide detailed boundary states in health status', () => {
      manager.isolateBoundary(BoundaryType.AI_PROCESSING);
      
      const health = manager.getSystemHealthStatus();
      
      expect(health.details[BoundaryType.AI_PROCESSING]).toBe(BoundaryState.ISOLATED);
      expect(health.details[BoundaryType.TOOL_EXECUTION]).toBe(BoundaryState.HEALTHY);
    });
  });

  describe('boundary interactions', () => {
    it('should allow independent boundary operations', async () => {
      const toolBoundary = manager.getToolExecutionBoundary();
      const registryBoundary = manager.getRegistryBoundary();
      
      // Isolate one boundary
      toolBoundary.isolate();
      
      // Other boundary should remain healthy
      expect(toolBoundary.isIsolated()).toBe(true);
      expect(registryBoundary.isIsolated()).toBe(false);
    });

    it('should maintain boundary independence during failures', () => {
      const toolBoundary = manager.getToolExecutionBoundary();
      const aiBoundary = manager.getAIProcessingBoundary();
      
      // Cause errors in one boundary
      (toolBoundary as any).recordError(new Error('Tool error'));
      (toolBoundary as any).recordError(new Error('Tool error'));
      (toolBoundary as any).updateBoundaryState();
      
      // Other boundary should be unaffected
      expect(toolBoundary.getState()).toBe(BoundaryState.DEGRADED);
      expect(aiBoundary.getState()).toBe(BoundaryState.HEALTHY);
    });
  });

  describe('configuration inheritance', () => {
    it('should initialize boundaries with appropriate default configurations', () => {
      const toolBoundary = manager.getToolExecutionBoundary();
      const aiBoundary = manager.getAIProcessingBoundary();
      
      const toolConfig = toolBoundary.getConfig();
      const aiConfig = aiBoundary.getConfig();
      
      expect(toolConfig.maxErrorsBeforeDegradation).toBe(2);
      expect(aiConfig.maxErrorsBeforeDegradation).toBe(3);
      expect(toolConfig.enableAutoRecovery).toBe(true);
      expect(aiConfig.enableAutoRecovery).toBe(true);
    });

    it('should allow different timeout configurations per boundary', () => {
      const toolBoundary = manager.getToolExecutionBoundary();
      const configBoundary = manager.getConfigurationBoundary();
      
      const toolConfig = toolBoundary.getConfig();
      const configConfig = configBoundary.getConfig();
      
      // Different boundaries should have different timeout configurations
      expect(toolConfig.recoveryTimeoutMs).not.toBe(configConfig.recoveryTimeoutMs);
    });
  });

  describe('memory and performance', () => {
    it('should handle large numbers of boundary state checks efficiently', () => {
      const iterations = 1000;
      const startTime = Date.now();
      
      for (let i = 0; i < iterations; i++) {
        manager.getAllBoundaryStates();
        manager.hasIsolatedBoundaries();
        manager.getSystemHealthStatus();
      }
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      // Should complete quickly (less than 1 second for 1000 iterations)
      expect(duration).toBeLessThan(1000);
    });

    it('should not leak memory during boundary operations', () => {
      const initialStates = manager.getAllBoundaryStates();
      
      // Perform many operations
      for (let i = 0; i < 100; i++) {
        manager.isolateBoundary(BoundaryType.TOOL_EXECUTION);
        manager.resetAllBoundaries();
        manager.getSystemHealthStatus();
      }
      
      const finalStates = manager.getAllBoundaryStates();
      
      // Should return to same state structure
      expect(Object.keys(finalStates)).toEqual(Object.keys(initialStates));
    });
  });

  describe('error handling', () => {
    it('should handle corrupted boundary gracefully', () => {
      // Simulate corrupted boundary by setting to null
      (manager as any).boundaries.set(BoundaryType.TOOL_EXECUTION, null);
      
      expect(() => manager.getToolExecutionBoundary()).toThrow();
    });

    it('should continue functioning when one boundary throws error', () => {
      // Mock a boundary to throw error
      const originalBoundary = manager.getToolExecutionBoundary();
      const mockBoundary = {
        ...originalBoundary,
        getState: jest.fn().mockImplementation(() => {
          throw new Error('Boundary corrupted');
        })
      };
      
      (manager as any).boundaries.set(BoundaryType.TOOL_EXECUTION, mockBoundary);
      
      // Should handle the error and continue with other boundaries
      expect(() => manager.getAllBoundaryStates()).toThrow();
      
      // But other boundaries should still be accessible
      expect(() => manager.getRegistryBoundary()).not.toThrow();
    });
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});