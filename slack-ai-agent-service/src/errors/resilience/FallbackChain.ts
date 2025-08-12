/**
 * Tool Fallback Chain System
 * Implements primary -> secondary -> basic response patterns for robust tool execution
 */

import { EnhancedErrorContext } from '../context/ErrorContext';
import { RecoveryResult } from '../recovery/RecoveryStrategy';

export enum FallbackLevel {
  PRIMARY = 'PRIMARY',
  SECONDARY = 'SECONDARY',
  TERTIARY = 'TERTIARY', 
  BASIC = 'BASIC',
  EMERGENCY = 'EMERGENCY'
}

export interface FallbackStep {
  level: FallbackLevel;
  toolName: string;
  action: string;
  timeout: number;
  retryAttempts: number;
  metadata?: Record<string, unknown>;
}

export interface FallbackChainConfig {
  maxChainLength: number;
  fallbackTimeout: number;
  enableEmergencyFallback: boolean;
  preserveUserContext: boolean;
  logFallbackUsage: boolean;
}

export interface FallbackResult<T = any> {
  success: boolean;
  result?: T;
  error?: Error;
  usedLevel: FallbackLevel;
  toolUsed: string;
  actionUsed: string;
  executionTime: number;
  fallbacksAttempted: FallbackStep[];
  emergencyFallbackUsed: boolean;
}

export interface ToolCapability {
  name: string;
  actions: string[];
  reliability: number; // 0-1 score
  avgResponseTime: number;
  lastFailureTime?: Date;
  capabilities: string[];
  fallbackPriority: number;
}

export class FallbackChain {
  private config: FallbackChainConfig;
  private toolCapabilities: Map<string, ToolCapability> = new Map();
  private chainHistory: Array<{
    timestamp: Date;
    originalTool: string;
    finalTool: string;
    success: boolean;
    fallbackLevel: FallbackLevel;
  }> = [];

  constructor(config: Partial<FallbackChainConfig> = {}) {
    this.config = {
      maxChainLength: 5,
      fallbackTimeout: 30000,
      enableEmergencyFallback: true,
      preserveUserContext: true,
      logFallbackUsage: true,
      ...config
    };
  }

  /**
   * Execute operation with fallback chain protection
   */
  async executeWithFallback<T>(
    primaryTool: string,
    action: string,
    operation: (tool: string, action: string) => Promise<T>,
    context: EnhancedErrorContext,
    userIntent?: string
  ): Promise<FallbackResult<T>> {
    const startTime = Date.now();
    const fallbackChain = this.buildFallbackChain(primaryTool, action, userIntent);
    const fallbacksAttempted: FallbackStep[] = [];
    let lastError: Error | undefined;

    for (const step of fallbackChain) {
      try {
        fallbacksAttempted.push(step);
        
        // Execute with timeout
        const result = await this.executeWithTimeout(
          () => operation(step.toolName, step.action),
          step.timeout
        );

        // Record successful execution
        this.recordFallbackSuccess(primaryTool, step.toolName, step.level);

        return {
          success: true,
          result,
          usedLevel: step.level,
          toolUsed: step.toolName,
          actionUsed: step.action,
          executionTime: Date.now() - startTime,
          fallbacksAttempted,
          emergencyFallbackUsed: step.level === FallbackLevel.EMERGENCY
        };

      } catch (error) {
        lastError = error as Error;
        this.recordFallbackFailure(step.toolName, step.level, error as Error);
        
        // Continue to next fallback
        continue;
      }
    }

    // All fallbacks failed, try emergency fallback if enabled
    if (this.config.enableEmergencyFallback) {
      try {
        const emergencyResult = await this.executeEmergencyFallback(userIntent || action, context);
        
        return {
          success: true,
          result: emergencyResult as T,
          usedLevel: FallbackLevel.EMERGENCY,
          toolUsed: 'emergency_responder',
          actionUsed: 'basic_response',
          executionTime: Date.now() - startTime,
          fallbacksAttempted,
          emergencyFallbackUsed: true
        };
      } catch (emergencyError) {
        lastError = emergencyError as Error;
      }
    }

    // Complete failure
    return {
      success: false,
      error: lastError || new Error('All fallback options exhausted'),
      usedLevel: FallbackLevel.PRIMARY,
      toolUsed: primaryTool,
      actionUsed: action,
      executionTime: Date.now() - startTime,
      fallbacksAttempted,
      emergencyFallbackUsed: false
    };
  }

  /**
   * Register a tool with its capabilities
   */
  registerTool(tool: ToolCapability): void {
    this.toolCapabilities.set(tool.name, tool);
  }

  /**
   * Build fallback chain for given tool and action
   */
  private buildFallbackChain(primaryTool: string, action: string, userIntent?: string): FallbackStep[] {
    const chain: FallbackStep[] = [];

    // Primary tool (original request)
    chain.push({
      level: FallbackLevel.PRIMARY,
      toolName: primaryTool,
      action,
      timeout: 10000,
      retryAttempts: 1
    });

    // Find secondary tools that can handle the same action
    const compatibleTools = this.findCompatibleTools(action, [primaryTool]);
    
    // Secondary fallback (best alternative tool)
    if (compatibleTools.length > 0) {
      const secondaryTool = compatibleTools[0];
      chain.push({
        level: FallbackLevel.SECONDARY,
        toolName: secondaryTool.name,
        action,
        timeout: 8000,
        retryAttempts: 1
      });
    }

    // Tertiary fallback (second best alternative)
    if (compatibleTools.length > 1) {
      const tertiaryTool = compatibleTools[1];
      chain.push({
        level: FallbackLevel.TERTIARY,
        toolName: tertiaryTool.name,
        action,
        timeout: 6000,
        retryAttempts: 1
      });
    }

    // Basic fallback (generic tool with simplified action)
    const basicTool = this.findBasicFallbackTool(action);
    if (basicTool) {
      chain.push({
        level: FallbackLevel.BASIC,
        toolName: basicTool.name,
        action: this.simplifyAction(action),
        timeout: 5000,
        retryAttempts: 2
      });
    }

    // Limit chain length
    return chain.slice(0, this.config.maxChainLength);
  }

  /**
   * Find tools compatible with given action
   */
  private findCompatibleTools(action: string, excludeTools: string[] = []): ToolCapability[] {
    const compatible: ToolCapability[] = [];

    for (const [toolName, capability] of this.toolCapabilities) {
      if (excludeTools.includes(toolName)) continue;
      
      // Check if tool supports the action or similar actions
      if (capability.actions.includes(action) || 
          this.hasCompatibleAction(capability.actions, action)) {
        compatible.push(capability);
      }
    }

    // Sort by reliability and priority
    return compatible.sort((a, b) => {
      const reliabilityDiff = b.reliability - a.reliability;
      if (Math.abs(reliabilityDiff) > 0.1) return reliabilityDiff;
      
      return a.fallbackPriority - b.fallbackPriority;
    });
  }

  /**
   * Check if actions are compatible
   */
  private hasCompatibleAction(supportedActions: string[], requestedAction: string): boolean {
    // Simple similarity check - in real implementation this would be more sophisticated
    const requestedWords = requestedAction.toLowerCase().split('_');
    
    return supportedActions.some(action => {
      const actionWords = action.toLowerCase().split('_');
      const commonWords = requestedWords.filter(word => actionWords.includes(word));
      return commonWords.length > 0;
    });
  }

  /**
   * Find basic fallback tool for emergency situations
   */
  private findBasicFallbackTool(action: string): ToolCapability | undefined {
    // Look for tools marked as basic fallbacks
    const basicTools = Array.from(this.toolCapabilities.values())
      .filter(tool => tool.capabilities.includes('basic_fallback'))
      .sort((a, b) => b.reliability - a.reliability);

    return basicTools[0];
  }

  /**
   * Simplify action for basic fallback tools
   */
  private simplifyAction(action: string): string {
    const actionMap: Record<string, string> = {
      'trigger_job': 'basic_build',
      'deploy_application': 'basic_deploy',
      'run_tests': 'basic_test',
      'send_notification': 'basic_notify',
      'create_issue': 'basic_log',
      'query_database': 'basic_query'
    };

    return actionMap[action] || 'basic_operation';
  }

  /**
   * Execute emergency fallback when all tools fail
   */
  private async executeEmergencyFallback(userIntent: string, context: EnhancedErrorContext): Promise<any> {
    // Emergency fallback provides a basic response acknowledging the request
    await new Promise(resolve => setTimeout(resolve, 100)); // Minimal delay
    
    return {
      status: 'emergency_fallback',
      message: `I'm currently experiencing technical difficulties but I've noted your request: "${userIntent}". I'll try to help you as soon as systems are restored.`,
      userIntent,
      timestamp: new Date(),
      fallbackType: 'emergency',
      contextPreserved: this.config.preserveUserContext,
      correlationId: context.correlationId
    };
  }

  /**
   * Execute operation with timeout
   */
  private async executeWithTimeout<T>(operation: () => Promise<T>, timeoutMs: number): Promise<T> {
    return Promise.race([
      operation(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Fallback operation timeout')), timeoutMs)
      )
    ]);
  }

  /**
   * Record successful fallback execution
   */
  private recordFallbackSuccess(originalTool: string, usedTool: string, level: FallbackLevel): void {
    if (!this.config.logFallbackUsage) return;

    this.chainHistory.push({
      timestamp: new Date(),
      originalTool,
      finalTool: usedTool,
      success: true,
      fallbackLevel: level
    });

    // Update tool reliability
    const tool = this.toolCapabilities.get(usedTool);
    if (tool) {
      tool.reliability = Math.min(1.0, tool.reliability + 0.01);
    }

    // Keep only last 100 records
    if (this.chainHistory.length > 100) {
      this.chainHistory.shift();
    }
  }

  /**
   * Record fallback failure
   */
  private recordFallbackFailure(toolName: string, level: FallbackLevel, error: Error): void {
    if (!this.config.logFallbackUsage) return;

    // Update tool reliability
    const tool = this.toolCapabilities.get(toolName);
    if (tool) {
      tool.reliability = Math.max(0.0, tool.reliability - 0.05);
      tool.lastFailureTime = new Date();
    }
  }

  /**
   * Get fallback chain statistics
   */
  getFallbackStats(): {
    totalExecutions: number;
    successRate: number;
    emergencyFallbackUsage: number;
    mostReliableTools: string[];
    averageFallbackLevel: number;
  } {
    if (this.chainHistory.length === 0) {
      return {
        totalExecutions: 0,
        successRate: 0,
        emergencyFallbackUsage: 0,
        mostReliableTools: [],
        averageFallbackLevel: 0
      };
    }

    const successful = this.chainHistory.filter(h => h.success);
    const emergencyUsage = this.chainHistory.filter(h => h.fallbackLevel === FallbackLevel.EMERGENCY);

    const toolReliability = Array.from(this.toolCapabilities.entries())
      .sort(([, a], [, b]) => b.reliability - a.reliability)
      .slice(0, 5)
      .map(([name]) => name);

    const levelValues = {
      [FallbackLevel.PRIMARY]: 1,
      [FallbackLevel.SECONDARY]: 2,
      [FallbackLevel.TERTIARY]: 3,
      [FallbackLevel.BASIC]: 4,
      [FallbackLevel.EMERGENCY]: 5
    };

    const averageLevel = this.chainHistory.reduce((sum, h) => 
      sum + levelValues[h.fallbackLevel], 0) / this.chainHistory.length;

    return {
      totalExecutions: this.chainHistory.length,
      successRate: successful.length / this.chainHistory.length,
      emergencyFallbackUsage: emergencyUsage.length,
      mostReliableTools: toolReliability,
      averageFallbackLevel: averageLevel
    };
  }

  /**
   * Update tool capabilities based on performance
   */
  updateToolPerformance(toolName: string, responseTime: number, success: boolean): void {
    const tool = this.toolCapabilities.get(toolName);
    if (!tool) return;

    // Update average response time with exponential moving average
    const alpha = 0.1;
    tool.avgResponseTime = tool.avgResponseTime * (1 - alpha) + responseTime * alpha;

    // Update reliability
    if (success) {
      tool.reliability = Math.min(1.0, tool.reliability + 0.005);
    } else {
      tool.reliability = Math.max(0.0, tool.reliability - 0.02);
      tool.lastFailureTime = new Date();
    }
  }

  /**
   * Get recommended fallback chain for preview
   */
  getRecommendedChain(primaryTool: string, action: string): FallbackStep[] {
    return this.buildFallbackChain(primaryTool, action);
  }

  /**
   * Clear fallback history
   */
  clearHistory(): void {
    this.chainHistory = [];
  }

  /**
   * Get all registered tools
   */
  getRegisteredTools(): ToolCapability[] {
    return Array.from(this.toolCapabilities.values());
  }
}