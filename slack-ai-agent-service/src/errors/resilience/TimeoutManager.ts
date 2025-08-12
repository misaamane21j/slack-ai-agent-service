/**
 * Timeout Manager with Resource Cleanup
 * Manages operation timeouts and ensures proper resource cleanup
 */

import { EnhancedErrorContext } from '../context/ErrorContext';

export interface TimeoutConfig {
  operationTimeout: number;        // Individual operation timeout
  globalTimeout: number;           // Global operation timeout
  cleanupTimeout: number;          // Cleanup operation timeout
  gracePeriod: number;            // Grace period before force cleanup
  enableResourceTracking: boolean; // Track and cleanup resources
  autoCleanup: boolean;           // Auto cleanup on timeout
}

export interface ResourceHandle {
  id: string;
  type: 'connection' | 'stream' | 'timer' | 'process' | 'memory' | 'file' | 'custom';
  resource: any;
  cleanup: () => Promise<void> | void;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  lastAccessed: Date;
}

export interface TimeoutResult<T = any> {
  success: boolean;
  result?: T;
  error?: Error;
  timedOut: boolean;
  timeoutType?: 'operation' | 'global' | 'cleanup';
  executionTime: number;
  resourcesCreated: number;
  resourcesCleaned: number;
  cleanupErrors: Error[];
}

export interface ActiveOperation {
  id: string;
  startTime: Date;
  operation: Promise<any>;
  context: EnhancedErrorContext;
  resources: Set<string>;
  timeoutHandle?: NodeJS.Timeout;
  globalTimeoutHandle?: NodeJS.Timeout;
  abortController?: AbortController;
}

export class TimeoutManager {
  private config: TimeoutConfig;
  private activeOperations: Map<string, ActiveOperation> = new Map();
  private resourceRegistry: Map<string, ResourceHandle> = new Map();
  private cleanupQueue: Array<{ resourceId: string; priority: number; scheduledAt: Date }> = [];
  private globalTimeoutHandle?: NodeJS.Timeout;
  private cleanupInterval?: NodeJS.Timeout;
  private metrics: {
    totalOperations: number;
    timedOutOperations: number;
    resourcesCreated: number;
    resourcesCleaned: number;
    cleanupErrors: number;
    averageCleanupTime: number;
  } = {
    totalOperations: 0,
    timedOutOperations: 0,
    resourcesCreated: 0,
    resourcesCleaned: 0,
    cleanupErrors: 0,
    averageCleanupTime: 0
  };

  constructor(config: Partial<TimeoutConfig> = {}) {
    this.config = {
      operationTimeout: 30000,      // 30 seconds
      globalTimeout: 300000,        // 5 minutes
      cleanupTimeout: 5000,         // 5 seconds
      gracePeriod: 1000,           // 1 second
      enableResourceTracking: true,
      autoCleanup: true,
      ...config
    };

    if (this.config.autoCleanup) {
      this.startCleanupScheduler();
    }
  }

  /**
   * Execute operation with timeout and resource management
   */
  async executeWithTimeout<T>(
    operationId: string,
    operation: (signal?: AbortSignal) => Promise<T>,
    context: EnhancedErrorContext,
    customConfig?: Partial<TimeoutConfig>
  ): Promise<TimeoutResult<T>> {
    const effectiveConfig = { ...this.config, ...customConfig };
    const startTime = Date.now();
    const abortController = new AbortController();
    const resources = new Set<string>();
    
    // Register active operation
    const activeOperation: ActiveOperation = {
      id: operationId,
      startTime: new Date(),
      operation: operation(abortController.signal),
      context,
      resources,
      abortController
    };

    this.activeOperations.set(operationId, activeOperation);
    this.metrics.totalOperations++;

    try {
      // Set up operation timeout
      const operationTimeoutPromise = this.createTimeoutPromise(
        effectiveConfig.operationTimeout,
        'operation',
        operationId
      );

      // Set up global timeout if configured
      const globalTimeoutPromise = effectiveConfig.globalTimeout 
        ? this.createTimeoutPromise(effectiveConfig.globalTimeout, 'global', operationId)
        : new Promise<never>(() => {}); // Never-resolving promise

      // Race between operation and timeouts
      const result = await Promise.race([
        activeOperation.operation,
        operationTimeoutPromise,
        globalTimeoutPromise
      ]);

      // Operation completed successfully
      const executionTime = Date.now() - startTime;
      
      // Clean up operation
      await this.cleanupOperation(operationId, false);

      return {
        success: true,
        result: result as T,
        timedOut: false,
        executionTime,
        resourcesCreated: resources.size,
        resourcesCleaned: resources.size,
        cleanupErrors: []
      };

    } catch (error) {
      const executionTime = Date.now() - startTime;
      const isTimeoutError = error instanceof Error && error.message.includes('timeout');
      
      if (isTimeoutError) {
        this.metrics.timedOutOperations++;
        abortController.abort('Operation timed out');
      }

      // Clean up operation and resources
      const cleanupResult = await this.cleanupOperation(operationId, true);

      return {
        success: false,
        error: error as Error,
        timedOut: isTimeoutError,
        timeoutType: this.extractTimeoutType(error as Error),
        executionTime,
        resourcesCreated: resources.size,
        resourcesCleaned: cleanupResult.resourcesCleaned,
        cleanupErrors: cleanupResult.cleanupErrors
      };
    }
  }

  /**
   * Register a resource for tracking and cleanup
   */
  registerResource(
    resourceId: string,
    type: ResourceHandle['type'],
    resource: any,
    cleanup: () => Promise<void> | void,
    operationId?: string,
    metadata?: Record<string, unknown>
  ): void {
    if (!this.config.enableResourceTracking) return;

    const handle: ResourceHandle = {
      id: resourceId,
      type,
      resource,
      cleanup,
      metadata,
      createdAt: new Date(),
      lastAccessed: new Date()
    };

    this.resourceRegistry.set(resourceId, handle);
    this.metrics.resourcesCreated++;

    // Associate with active operation if provided
    if (operationId && this.activeOperations.has(operationId)) {
      this.activeOperations.get(operationId)!.resources.add(resourceId);
    }
  }

  /**
   * Unregister and cleanup a specific resource
   */
  async unregisterResource(resourceId: string): Promise<boolean> {
    const handle = this.resourceRegistry.get(resourceId);
    if (!handle) return false;

    try {
      await this.cleanupSingleResource(handle);
      this.resourceRegistry.delete(resourceId);
      this.metrics.resourcesCleaned++;
      return true;
    } catch (error) {
      this.metrics.cleanupErrors++;
      console.error(`Failed to cleanup resource ${resourceId}:`, error);
      return false;
    }
  }

  /**
   * Schedule resource cleanup
   */
  scheduleResourceCleanup(resourceId: string, priority: number = 0, delay: number = 0): void {
    const scheduledAt = new Date(Date.now() + delay);
    
    this.cleanupQueue.push({
      resourceId,
      priority,
      scheduledAt
    });

    // Sort by priority (higher first) then by scheduled time
    this.cleanupQueue.sort((a, b) => {
      if (a.priority !== b.priority) {
        return b.priority - a.priority;
      }
      return a.scheduledAt.getTime() - b.scheduledAt.getTime();
    });
  }

  /**
   * Create timeout promise that rejects after specified time
   */
  private createTimeoutPromise(timeoutMs: number, type: string, operationId: string): Promise<never> {
    return new Promise((_, reject) => {
      const timeoutHandle = setTimeout(() => {
        reject(new Error(`${type} timeout (${timeoutMs}ms) exceeded for operation ${operationId}`));
      }, timeoutMs);

      // Store timeout handle for cleanup
      const operation = this.activeOperations.get(operationId);
      if (operation) {
        if (type === 'operation') {
          operation.timeoutHandle = timeoutHandle;
        } else if (type === 'global') {
          operation.globalTimeoutHandle = timeoutHandle;
        }
      }
    });
  }

  /**
   * Extract timeout type from error
   */
  private extractTimeoutType(error: Error): 'operation' | 'global' | 'cleanup' | undefined {
    const message = error.message.toLowerCase();
    if (message.includes('operation timeout')) return 'operation';
    if (message.includes('global timeout')) return 'global';
    if (message.includes('cleanup timeout')) return 'cleanup';
    return undefined;
  }

  /**
   * Cleanup operation and associated resources
   */
  private async cleanupOperation(
    operationId: string,
    isError: boolean
  ): Promise<{ resourcesCleaned: number; cleanupErrors: Error[] }> {
    const operation = this.activeOperations.get(operationId);
    if (!operation) {
      return { resourcesCleaned: 0, cleanupErrors: [] };
    }

    const cleanupErrors: Error[] = [];
    let resourcesCleaned = 0;

    try {
      // Clear timeout handles
      if (operation.timeoutHandle) {
        clearTimeout(operation.timeoutHandle);
      }
      if (operation.globalTimeoutHandle) {
        clearTimeout(operation.globalTimeoutHandle);
      }

      // Abort operation if it's an error cleanup
      if (isError && operation.abortController) {
        operation.abortController.abort('Cleanup initiated due to error');
      }

      // Cleanup associated resources
      const resourceCleanupPromises = Array.from(operation.resources).map(async (resourceId) => {
        try {
          const success = await this.unregisterResource(resourceId);
          if (success) resourcesCleaned++;
        } catch (error) {
          cleanupErrors.push(error as Error);
        }
      });

      // Wait for all cleanups with timeout
      await this.executeWithCleanupTimeout(
        () => Promise.all(resourceCleanupPromises),
        this.config.cleanupTimeout
      );

    } catch (error) {
      cleanupErrors.push(error as Error);
    } finally {
      // Remove from active operations
      this.activeOperations.delete(operationId);
    }

    return { resourcesCleaned, cleanupErrors };
  }

  /**
   * Cleanup single resource with error handling
   */
  private async cleanupSingleResource(handle: ResourceHandle): Promise<void> {
    const startTime = Date.now();
    
    try {
      // Execute cleanup with timeout
      await this.executeWithCleanupTimeout(
        () => handle.cleanup(),
        this.config.cleanupTimeout
      );

      // Update cleanup time metrics
      const cleanupTime = Date.now() - startTime;
      this.updateCleanupTimeMetrics(cleanupTime);

    } catch (error) {
      console.error(`Resource cleanup failed for ${handle.id} (${handle.type}):`, error);
      throw error;
    }
  }

  /**
   * Execute cleanup operation with timeout
   */
  private async executeWithCleanupTimeout<T>(
    operation: () => Promise<T> | T,
    timeoutMs: number
  ): Promise<T> {
    return Promise.race([
      Promise.resolve(operation()),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Cleanup timeout exceeded')), timeoutMs)
      )
    ]);
  }

  /**
   * Start cleanup scheduler for background resource management
   */
  private startCleanupScheduler(): void {
    this.cleanupInterval = setInterval(async () => {
      await this.processCleanupQueue();
      await this.cleanupStaleResources();
    }, 5000); // Run every 5 seconds
  }

  /**
   * Process scheduled cleanup queue
   */
  private async processCleanupQueue(): Promise<void> {
    const now = Date.now();
    const toProcess = this.cleanupQueue.filter(item => 
      item.scheduledAt.getTime() <= now
    );

    // Remove processed items from queue
    this.cleanupQueue = this.cleanupQueue.filter(item => 
      item.scheduledAt.getTime() > now
    );

    // Process cleanup items
    for (const item of toProcess) {
      try {
        await this.unregisterResource(item.resourceId);
      } catch (error) {
        console.error(`Scheduled cleanup failed for resource ${item.resourceId}:`, error);
      }
    }
  }

  /**
   * Cleanup stale resources that haven't been accessed recently
   */
  private async cleanupStaleResources(): Promise<void> {
    const staleThreshold = Date.now() - 300000; // 5 minutes
    const staleResources: string[] = [];

    for (const [resourceId, handle] of this.resourceRegistry) {
      if (handle.lastAccessed.getTime() < staleThreshold) {
        staleResources.push(resourceId);
      }
    }

    // Cleanup stale resources
    for (const resourceId of staleResources) {
      this.scheduleResourceCleanup(resourceId, -1); // Low priority
    }
  }

  /**
   * Update cleanup time metrics
   */
  private updateCleanupTimeMetrics(cleanupTime: number): void {
    const alpha = 0.1; // Exponential moving average factor
    this.metrics.averageCleanupTime = 
      this.metrics.averageCleanupTime * (1 - alpha) + cleanupTime * alpha;
  }

  /**
   * Force cleanup all active operations
   */
  async forceCleanupAll(): Promise<{
    operationsCleaned: number;
    resourcesCleaned: number;
    errors: Error[];
  }> {
    const errors: Error[] = [];
    let operationsCleaned = 0;
    let resourcesCleaned = 0;

    // Cleanup all active operations
    const operationIds = Array.from(this.activeOperations.keys());
    for (const operationId of operationIds) {
      try {
        const result = await this.cleanupOperation(operationId, true);
        operationsCleaned++;
        resourcesCleaned += result.resourcesCleaned;
        errors.push(...result.cleanupErrors);
      } catch (error) {
        errors.push(error as Error);
      }
    }

    // Cleanup remaining resources
    const resourceIds = Array.from(this.resourceRegistry.keys());
    for (const resourceId of resourceIds) {
      try {
        const success = await this.unregisterResource(resourceId);
        if (success) resourcesCleaned++;
      } catch (error) {
        errors.push(error as Error);
      }
    }

    return { operationsCleaned, resourcesCleaned, errors };
  }

  /**
   * Get current metrics
   */
  getMetrics(): typeof this.metrics {
    return { ...this.metrics };
  }

  /**
   * Get active operations count
   */
  getActiveOperationsCount(): number {
    return this.activeOperations.size;
  }

  /**
   * Get registered resources count
   */
  getRegisteredResourcesCount(): number {
    return this.resourceRegistry.size;
  }

  /**
   * Get resource information
   */
  getResourceInfo(resourceId: string): ResourceHandle | undefined {
    return this.resourceRegistry.get(resourceId);
  }

  /**
   * Get all resource types and counts
   */
  getResourceSummary(): Record<string, number> {
    const summary: Record<string, number> = {};
    
    for (const handle of this.resourceRegistry.values()) {
      summary[handle.type] = (summary[handle.type] || 0) + 1;
    }
    
    return summary;
  }

  /**
   * Update resource last accessed time
   */
  touchResource(resourceId: string): void {
    const handle = this.resourceRegistry.get(resourceId);
    if (handle) {
      handle.lastAccessed = new Date();
    }
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<TimeoutConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Shutdown timeout manager and cleanup all resources
   */
  async shutdown(): Promise<void> {
    // Clear cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Force cleanup all resources
    await this.forceCleanupAll();
  }
}