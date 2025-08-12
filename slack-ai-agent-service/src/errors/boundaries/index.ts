/**
 * Error Boundaries for MCP Integration
 * Export all boundary types and utilities
 */

import { BoundaryType, BoundaryState, ErrorBoundary, BoundaryMetrics } from './ErrorBoundary';
import { ToolExecutionBoundary } from './ToolExecutionBoundary';
import { RegistryBoundary } from './RegistryBoundary';
import { AIProcessingBoundary } from './AIProcessingBoundary';
import { ConfigurationBoundary } from './ConfigurationBoundary';
import { SlackResponseBoundary } from './SlackResponseBoundary';

// Base boundary types
export {
  ErrorBoundary,
  BoundaryType,
  BoundaryState,
  BoundaryMetrics,
  BoundaryConfig,
  BoundaryResult
} from './ErrorBoundary';

// Tool Execution Boundary
export {
  ToolExecutionBoundary,
  ToolExecutionConfig,
  ToolExecutionResult,
  ToolMetadata
} from './ToolExecutionBoundary';

// Registry Boundary
export {
  RegistryBoundary,
  RegistryConfig,
  RegistryResult,
  ToolRegistryEntry,
  RegistryCache
} from './RegistryBoundary';

// AI Processing Boundary
export {
  AIProcessingBoundary,
  AIProcessingConfig,
  AIProcessingResult,
  AIResponse,
  ProcessingContext
} from './AIProcessingBoundary';

// Configuration Boundary
export {
  ConfigurationBoundary,
  ConfigurationBoundaryConfig,
  ConfigurationResult,
  ConfigurationChange,
  ConfigurationSnapshot
} from './ConfigurationBoundary';

// Slack Response Boundary
export {
  SlackResponseBoundary,
  SlackResponseConfig,
  SlackResponseResult,
  SlackResponse,
  ResponseDeliveryContext
} from './SlackResponseBoundary';

/**
 * Boundary Manager - Coordinates all error boundaries
 */
export class BoundaryManager {
  private boundaries: Map<BoundaryType, ErrorBoundary> = new Map();

  constructor() {
    this.initializeBoundaries();
  }

  /**
   * Initialize all error boundaries with default configurations
   */
  private initializeBoundaries(): void {
    // Tool Execution Boundary
    this.boundaries.set(
      BoundaryType.TOOL_EXECUTION,
      new ToolExecutionBoundary({
        maxErrorsBeforeDegradation: 2,
        maxErrorsBeforeIsolation: 4,
        toolTimeoutMs: 10000,
        enableToolFallback: true
      })
    );

    // Registry Boundary
    this.boundaries.set(
      BoundaryType.REGISTRY,
      new RegistryBoundary({
        maxErrorsBeforeDegradation: 2,
        maxErrorsBeforeIsolation: 4,
        enableOfflineMode: true,
        cacheExpirationMs: 600000
      })
    );

    // AI Processing Boundary
    this.boundaries.set(
      BoundaryType.AI_PROCESSING,
      new AIProcessingBoundary({
        maxErrorsBeforeDegradation: 3,
        maxErrorsBeforeIsolation: 5,
        enableSimplifiedFallback: true,
        maxProcessingTimeMs: 15000
      })
    );

    // Configuration Boundary
    this.boundaries.set(
      BoundaryType.CONFIGURATION,
      new ConfigurationBoundary({
        maxErrorsBeforeDegradation: 2,
        maxErrorsBeforeIsolation: 3,
        enableConfigValidation: true,
        enableConfigRollback: true
      })
    );

    // Slack Response Boundary
    this.boundaries.set(
      BoundaryType.SLACK_RESPONSE,
      new SlackResponseBoundary({
        maxErrorsBeforeDegradation: 2,
        maxErrorsBeforeIsolation: 4,
        enableFallbackMessages: true,
        enableDirectMessageFallback: true
      })
    );
  }

  /**
   * Get a specific boundary
   */
  getBoundary<T extends ErrorBoundary>(boundaryType: BoundaryType): T {
    const boundary = this.boundaries.get(boundaryType);
    if (!boundary) {
      throw new Error(`Boundary ${boundaryType} not found`);
    }
    return boundary as T;
  }

  /**
   * Get tool execution boundary
   */
  getToolExecutionBoundary(): ToolExecutionBoundary {
    return this.getBoundary<ToolExecutionBoundary>(BoundaryType.TOOL_EXECUTION);
  }

  /**
   * Get registry boundary
   */
  getRegistryBoundary(): RegistryBoundary {
    return this.getBoundary<RegistryBoundary>(BoundaryType.REGISTRY);
  }

  /**
   * Get AI processing boundary
   */
  getAIProcessingBoundary(): AIProcessingBoundary {
    return this.getBoundary<AIProcessingBoundary>(BoundaryType.AI_PROCESSING);
  }

  /**
   * Get configuration boundary
   */
  getConfigurationBoundary(): ConfigurationBoundary {
    return this.getBoundary<ConfigurationBoundary>(BoundaryType.CONFIGURATION);
  }

  /**
   * Get Slack response boundary
   */
  getSlackResponseBoundary(): SlackResponseBoundary {
    return this.getBoundary<SlackResponseBoundary>(BoundaryType.SLACK_RESPONSE);
  }

  /**
   * Get all boundary states
   */
  getAllBoundaryStates(): Record<BoundaryType, BoundaryState> {
    const states: Record<string, BoundaryState> = {};
    
    for (const [type, boundary] of this.boundaries) {
      states[type] = boundary.getState();
    }
    
    return states as Record<BoundaryType, BoundaryState>;
  }

  /**
   * Get all boundary metrics
   */
  getAllBoundaryMetrics(): Record<BoundaryType, BoundaryMetrics> {
    const metrics: Record<string, BoundaryMetrics> = {};
    
    for (const [type, boundary] of this.boundaries) {
      metrics[type] = boundary.getMetrics();
    }
    
    return metrics as Record<BoundaryType, BoundaryMetrics>;
  }

  /**
   * Reset all boundaries to healthy state
   */
  resetAllBoundaries(): void {
    for (const boundary of this.boundaries.values()) {
      boundary.reset();
    }
  }

  /**
   * Isolate a specific boundary
   */
  isolateBoundary(boundaryType: BoundaryType, durationMs?: number): void {
    const boundary = this.boundaries.get(boundaryType);
    if (boundary) {
      boundary.isolate(durationMs);
    }
  }

  /**
   * Check if any boundaries are isolated
   */
  hasIsolatedBoundaries(): boolean {
    for (const boundary of this.boundaries.values()) {
      if (boundary.isIsolated()) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get isolated boundaries
   */
  getIsolatedBoundaries(): BoundaryType[] {
    const isolated: BoundaryType[] = [];
    
    for (const [type, boundary] of this.boundaries) {
      if (boundary.isIsolated()) {
        isolated.push(type);
      }
    }
    
    return isolated;
  }

  /**
   * Get system health status based on boundary states
   */
  getSystemHealthStatus(): {
    overall: 'healthy' | 'degraded' | 'critical';
    details: Record<BoundaryType, BoundaryState>;
    isolatedCount: number;
    degradedCount: number;
    failedCount: number;
  } {
    const states = this.getAllBoundaryStates();
    const stateValues = Object.values(states);
    
    const isolatedCount = stateValues.filter(s => s === BoundaryState.ISOLATED).length;
    const degradedCount = stateValues.filter(s => s === BoundaryState.DEGRADED).length;
    const failedCount = stateValues.filter(s => s === BoundaryState.FAILED).length;
    
    let overall: 'healthy' | 'degraded' | 'critical';
    
    if (isolatedCount > 0 || failedCount > 1) {
      overall = 'critical';
    } else if (degradedCount > 0 || failedCount > 0) {
      overall = 'degraded';
    } else {
      overall = 'healthy';
    }
    
    return {
      overall,
      details: states,
      isolatedCount,
      degradedCount,
      failedCount
    };
  }
}