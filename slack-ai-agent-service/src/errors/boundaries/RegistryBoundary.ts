/**
 * Registry Boundary - Prevents tool discovery issues from breaking the entire system
 * Isolates MCP tool registry failures and provides fallback tool discovery mechanisms
 */

import { ErrorBoundary, BoundaryType, BoundaryConfig, BoundaryResult } from './ErrorBoundary';
import { EnhancedErrorContext, ProcessingStage } from '../context/ErrorContext';
import { PreservationReason, PreservationPriority } from '../context/ContextPreserver';
import { RecoveryStrategyManager } from '../recovery/RecoveryStrategy';
import { ContextPreserver } from '../context/ContextPreserver';

export interface RegistryConfig extends BoundaryConfig {
  maxRegistryFailures: number;
  cacheExpirationMs: number;
  enableOfflineMode: boolean;
  fallbackRegistryEndpoints: string[];
  toolDiscoveryTimeoutMs: number;
}

export interface RegistryResult<T = any> extends BoundaryResult<T> {
  registrySource: 'primary' | 'cache' | 'fallback' | 'offline';
  toolsFound: number;
  registryLatency: number;
  cacheHit: boolean;
  offlineModeEnabled: boolean;
}

export interface ToolRegistryEntry {
  name: string;
  version: string;
  capabilities: string[];
  endpoint: string;
  lastSeen: Date;
  status: 'available' | 'degraded' | 'unavailable';
  metadata: Record<string, any>;
}

export interface RegistryCache {
  tools: ToolRegistryEntry[];
  lastUpdated: Date;
  source: string;
  ttl: number;
}

export class RegistryBoundary extends ErrorBoundary {
  private registryCache: Map<string, RegistryCache> = new Map();
  private offlineTools: ToolRegistryEntry[] = [];
  private registryConfig: RegistryConfig;
  private currentRegistrySource: string = 'primary';
  private registryFailureCount: number = 0;

  constructor(
    config: Partial<RegistryConfig> = {},
    recoveryManager?: RecoveryStrategyManager,
    contextPreserver?: ContextPreserver
  ) {
    const registryConfig: RegistryConfig = {
      maxErrorsBeforeDegradation: 2,
      maxErrorsBeforeIsolation: 4,
      recoveryTimeoutMs: 10000,
      isolationDurationMs: 300000, // 5 minutes
      enableAutoRecovery: true,
      escalationThreshold: 6,
      maxRegistryFailures: 3,
      cacheExpirationMs: 600000, // 10 minutes
      enableOfflineMode: true,
      fallbackRegistryEndpoints: [],
      toolDiscoveryTimeoutMs: 5000,
      ...config
    };

    super(BoundaryType.REGISTRY, registryConfig, recoveryManager, contextPreserver);
    this.registryConfig = registryConfig;
    this.initializeOfflineTools();
  }

  /**
   * Discover tools through the registry with boundary protection
   */
  async discoverTools(
    query?: string,
    context?: EnhancedErrorContext
  ): Promise<RegistryResult<ToolRegistryEntry[]>> {
    const startTime = Date.now();

    // Create discovery operation
    const discoveryOperation = () => this.performToolDiscovery(query);

    // Create fallback operation
    const fallbackOperation = () => this.performFallbackDiscovery(query);

    // Create context if not provided
    const discoveryContext = context || this.createDiscoveryContext(query);

    // Execute within boundary
    const result = await this.execute(discoveryOperation, discoveryContext, fallbackOperation);
    const registryLatency = Date.now() - startTime;

    // Determine source and cache status
    const registrySource = this.determineRegistrySource(result);
    const cacheHit = this.wasCacheHit(result);

    return {
      ...result,
      registrySource,
      toolsFound: Array.isArray(result.result) ? result.result.length : 0,
      registryLatency,
      cacheHit,
      offlineModeEnabled: this.isOfflineModeActive()
    };
  }

  /**
   * Get a specific tool from registry with caching
   */
  async getTool(
    toolName: string,
    context?: EnhancedErrorContext
  ): Promise<RegistryResult<ToolRegistryEntry | null>> {
    const startTime = Date.now();

    // Check cache first
    const cachedTool = this.getToolFromCache(toolName);
    if (cachedTool) {
      return {
        success: true,
        result: cachedTool,
        boundaryState: this.state,
        registrySource: 'cache',
        toolsFound: 1,
        registryLatency: Date.now() - startTime,
        cacheHit: true,
        fallbackUsed: false,
        isolationTriggered: false,
        offlineModeEnabled: false
      };
    }

    // Create tool lookup operation
    const lookupOperation = () => this.performToolLookup(toolName);
    const fallbackOperation = () => this.performFallbackToolLookup(toolName);

    const lookupContext = context || this.createToolLookupContext(toolName);
    const result = await this.execute(lookupOperation, lookupContext, fallbackOperation);
    const registryLatency = Date.now() - startTime;

    // Cache successful result
    if (result.success && result.result) {
      this.cacheToolResult(toolName, result.result);
    }

    return {
      ...result,
      registrySource: this.determineRegistrySource(result),
      toolsFound: result.result ? 1 : 0,
      registryLatency,
      cacheHit: false,
      offlineModeEnabled: this.isOfflineModeActive()
    };
  }

  protected shouldPreserveContext(context: EnhancedErrorContext): boolean {
    // Preserve context for registry operations
    return context.executionState?.processingStage === ProcessingStage.TOOL_DISCOVERY ||
           context.operation?.operationName?.includes('registry') ||
           context.operation?.operationName?.includes('discovery');
  }

  protected preserveExecutionContext(context: EnhancedErrorContext): string {
    const userState = {
      conversationId: context.userIntent?.conversationId || 'registry_operation',
      threadId: context.executionState?.threadId || 'registry',
      userId: context.userIntent?.userId || 'system',
      originalMessage: context.userIntent?.originalMessage || 'tool discovery',
      parsedIntent: context.userIntent?.parsedIntent || 'discover_tools',
      confidence: context.userIntent?.confidence || 1.0,
      fallbackOptions: ['cached_tools', 'offline_tools']
    };

    const operationState = {
      operationId: context.operation?.operationId || context.correlationId,
      stage: ProcessingStage.TOOL_DISCOVERY,
      phase: context.operation?.phase || 'discovery',
      completedSteps: ['registry_connection'],
      partialResults: { discoveredTools: [] },
      toolSelections: [],
      retryCount: 0,
      maxRetries: 2
    };

    const systemState = {
      activeConnections: ['registry'],
      resourcesAcquired: ['registry_connection'],
      temporaryData: { registryQuery: context.additionalContext },
      processingMetrics: {
        startTime: context.timestamp,
        processingDuration: 0,
        memoryUsage: context.systemContext?.memoryUsage || 0,
        networkCalls: 1
      }
    };

    return this.contextPreserver.preserve(
      context,
      userState,
      operationState,
      systemState,
      {
        priority: PreservationPriority.MEDIUM,
        reason: PreservationReason.ERROR_RECOVERY,
        tags: ['registry', 'tool_discovery']
      }
    );
  }

  protected getFallbackOperation<T>(
    originalOperation: () => Promise<T>,
    context: EnhancedErrorContext
  ): (() => Promise<T>) | undefined {
    return async () => {
      // Try cache first
      const cachedResult = this.getCachedTools();
      if (cachedResult.length > 0) {
        return cachedResult as T;
      }

      // Try fallback registry endpoints
      if (this.registryConfig.fallbackRegistryEndpoints.length > 0) {
        return this.tryFallbackRegistries() as T;
      }

      // Use offline mode
      if (this.registryConfig.enableOfflineMode) {
        return this.getOfflineTools() as T;
      }

      throw new Error('No fallback options available for registry');
    };
  }

  /**
   * Perform tool discovery from primary registry
   */
  private async performToolDiscovery(query?: string): Promise<ToolRegistryEntry[]> {
    // Simulate registry API call
    await new Promise(resolve => setTimeout(resolve, 100));

    // Simulate random failures based on boundary state
    if (this.shouldSimulateFailure()) {
      throw new Error('Registry connection failed');
    }

    // Return mock tools for simulation
    const mockTools: ToolRegistryEntry[] = [
      {
        name: 'jenkins',
        version: '1.0.0',
        capabilities: ['build', 'deploy', 'test'],
        endpoint: 'http://jenkins.example.com',
        lastSeen: new Date(),
        status: 'available',
        metadata: { type: 'ci_cd' }
      },
      {
        name: 'github',
        version: '2.1.0',
        capabilities: ['repository', 'issues', 'pull_requests'],
        endpoint: 'https://api.github.com',
        lastSeen: new Date(),
        status: 'available',
        metadata: { type: 'version_control' }
      }
    ];

    // Filter by query if provided
    if (query) {
      return mockTools.filter(tool => 
        tool.name.includes(query.toLowerCase()) ||
        tool.capabilities.some(cap => cap.includes(query.toLowerCase()))
      );
    }

    // Cache the results
    this.cacheRegistryResult('primary', mockTools);

    return mockTools;
  }

  /**
   * Perform fallback tool discovery
   */
  private async performFallbackDiscovery(query?: string): Promise<ToolRegistryEntry[]> {
    // Try cache first
    const cachedTools = this.getCachedTools();
    if (cachedTools.length > 0) {
      return query ? 
        cachedTools.filter(tool => tool.name.includes(query.toLowerCase())) :
        cachedTools;
    }

    // Try offline tools
    return this.getOfflineTools();
  }

  /**
   * Perform tool lookup from primary registry
   */
  private async performToolLookup(toolName: string): Promise<ToolRegistryEntry | null> {
    await new Promise(resolve => setTimeout(resolve, 50));

    if (this.shouldSimulateFailure()) {
      throw new Error(`Tool lookup failed for ${toolName}`);
    }

    // Mock tool lookup
    const mockTool: ToolRegistryEntry = {
      name: toolName,
      version: '1.0.0',
      capabilities: ['mock_capability'],
      endpoint: `http://${toolName}.example.com`,
      lastSeen: new Date(),
      status: 'available',
      metadata: { type: 'mock_tool' }
    };

    return mockTool;
  }

  /**
   * Perform fallback tool lookup
   */
  private async performFallbackToolLookup(toolName: string): Promise<ToolRegistryEntry | null> {
    // Check cache
    const cachedTool = this.getToolFromCache(toolName);
    if (cachedTool) {
      return cachedTool;
    }

    // Check offline tools
    return this.offlineTools.find(tool => tool.name === toolName) || null;
  }

  /**
   * Initialize offline tools for fallback
   */
  private initializeOfflineTools(): void {
    this.offlineTools = [
      {
        name: 'basic_jenkins',
        version: '0.9.0',
        capabilities: ['build'],
        endpoint: 'offline',
        lastSeen: new Date(),
        status: 'available',
        metadata: { type: 'offline_fallback' }
      },
      {
        name: 'simple_notification',
        version: '1.0.0',
        capabilities: ['notify'],
        endpoint: 'offline',
        lastSeen: new Date(),
        status: 'available',
        metadata: { type: 'offline_fallback' }
      }
    ];
  }

  /**
   * Cache registry result
   */
  private cacheRegistryResult(source: string, tools: ToolRegistryEntry[]): void {
    const cache: RegistryCache = {
      tools,
      lastUpdated: new Date(),
      source,
      ttl: this.registryConfig.cacheExpirationMs
    };

    this.registryCache.set(source, cache);
  }

  /**
   * Cache individual tool result
   */
  private cacheToolResult(toolName: string, tool: ToolRegistryEntry): void {
    const existingCache = this.registryCache.get('tools') || {
      tools: [],
      lastUpdated: new Date(),
      source: 'individual_lookup',
      ttl: this.registryConfig.cacheExpirationMs
    };

    // Update or add tool
    const toolIndex = existingCache.tools.findIndex(t => t.name === toolName);
    if (toolIndex >= 0) {
      existingCache.tools[toolIndex] = tool;
    } else {
      existingCache.tools.push(tool);
    }

    existingCache.lastUpdated = new Date();
    this.registryCache.set('tools', existingCache);
  }

  /**
   * Get cached tools
   */
  private getCachedTools(): ToolRegistryEntry[] {
    const cache = this.registryCache.get('primary');
    if (!cache || this.isCacheExpired(cache)) {
      return [];
    }
    return cache.tools;
  }

  /**
   * Get tool from cache
   */
  private getToolFromCache(toolName: string): ToolRegistryEntry | null {
    for (const cache of this.registryCache.values()) {
      if (!this.isCacheExpired(cache)) {
        const tool = cache.tools.find(t => t.name === toolName);
        if (tool) return tool;
      }
    }
    return null;
  }

  /**
   * Check if cache is expired
   */
  private isCacheExpired(cache: RegistryCache): boolean {
    return Date.now() - cache.lastUpdated.getTime() > cache.ttl;
  }

  /**
   * Get offline tools
   */
  private getOfflineTools(): ToolRegistryEntry[] {
    return [...this.offlineTools];
  }

  /**
   * Try fallback registries
   */
  private async tryFallbackRegistries(): Promise<ToolRegistryEntry[]> {
    for (const endpoint of this.registryConfig.fallbackRegistryEndpoints) {
      try {
        // Simulate fallback registry call
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // Return basic tools from fallback
        return [
          {
            name: 'fallback_tool',
            version: '1.0.0',
            capabilities: ['basic_operation'],
            endpoint,
            lastSeen: new Date(),
            status: 'available',
            metadata: { type: 'fallback_registry' }
          }
        ];
      } catch (error) {
        continue; // Try next fallback
      }
    }

    return this.getOfflineTools();
  }

  /**
   * Create discovery context
   */
  private createDiscoveryContext(query?: string): EnhancedErrorContext {
    const context = {
      timestamp: new Date(),
      severity: 'LOW' as const,
      operation: {
        operationId: `discovery_${Date.now()}`,
        operationName: 'tool_discovery',
        phase: 'discovery' as const,
        startTime: new Date()
      },
      executionState: {
        processingStage: ProcessingStage.TOOL_DISCOVERY,
        threadId: 'registry',
        completedSteps: [],
        partialResults: {}
      },
      systemContext: {
        environment: 'development'
      },
      correlationId: `registry_${Date.now()}`,
      additionalContext: { query }
    };

    return context as any;
  }

  /**
   * Create tool lookup context
   */
  private createToolLookupContext(toolName: string): EnhancedErrorContext {
    const context = this.createDiscoveryContext();
    context.operation!.operationName = 'tool_lookup';
    context.additionalContext = { toolName };
    return context;
  }

  /**
   * Determine registry source from result
   */
  private determineRegistrySource(result: BoundaryResult): 'primary' | 'cache' | 'fallback' | 'offline' {
    if (result.fallbackUsed) {
      return 'fallback';
    }
    if (this.isOfflineModeActive()) {
      return 'offline';
    }
    return 'primary';
  }

  /**
   * Check if cache was hit
   */
  private wasCacheHit(result: BoundaryResult): boolean {
    // In a real implementation, this would check if the result came from cache
    return false;
  }

  /**
   * Check if offline mode is active
   */
  private isOfflineModeActive(): boolean {
    return this.registryConfig.enableOfflineMode && 
           this.state === BoundaryState.ISOLATED;
  }

  /**
   * Should simulate failure for testing
   */
  private shouldSimulateFailure(): boolean {
    // Simulate failures based on boundary state
    if (this.state === BoundaryState.DEGRADED) {
      return Math.random() < 0.3; // 30% failure rate when degraded
    }
    if (this.state === BoundaryState.FAILED) {
      return Math.random() < 0.7; // 70% failure rate when failed
    }
    return Math.random() < 0.1; // 10% baseline failure rate
  }

  /**
   * Get registry statistics
   */
  getRegistryStats(): {
    cacheSize: number;
    cacheHitRate: number;
    offlineToolsCount: number;
    lastSuccessfulDiscovery?: Date;
  } {
    const totalTools = Array.from(this.registryCache.values())
      .reduce((sum, cache) => sum + cache.tools.length, 0);

    return {
      cacheSize: totalTools,
      cacheHitRate: 0, // Would be calculated in real implementation
      offlineToolsCount: this.offlineTools.length,
      lastSuccessfulDiscovery: Array.from(this.registryCache.values())
        .map(cache => cache.lastUpdated)
        .sort((a, b) => b.getTime() - a.getTime())[0]
    };
  }

  /**
   * Clear registry cache
   */
  clearCache(): void {
    this.registryCache.clear();
  }

  /**
   * Add offline tool
   */
  addOfflineTool(tool: ToolRegistryEntry): void {
    const existingIndex = this.offlineTools.findIndex(t => t.name === tool.name);
    if (existingIndex >= 0) {
      this.offlineTools[existingIndex] = tool;
    } else {
      this.offlineTools.push(tool);
    }
  }
}