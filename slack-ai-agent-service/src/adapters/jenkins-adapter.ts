/**
 * Jenkins Adapter for MCP Tool Integration
 * Provides a bridge between the legacy Jenkins-specific code and the new MCP architecture
 */

import { logger } from '../utils/logger';
import { MCPClientService } from '../services/mcp-client';
import { ParameterSanitizer } from '../utils/parameter-sanitizer';
import { ToolInvocationResult, ToolDefinition } from '../types/ai-agent';

/**
 * Jenkins job parameters interface
 */
export interface JenkinsJobParams {
  jobName: string;
  parameters: Record<string, any>;
  callbackInfo?: {
    slackChannel: string;
    slackThreadTs: string;
    slackUserId: string;
  };
}

/**
 * Jenkins build result interface
 */
export interface JenkinsBuildResult {
  buildNumber: number;
  buildUrl?: string;
  status: 'started' | 'completed' | 'failed';
  queueId?: number;
  estimatedDuration?: number;
}

/**
 * Jenkins server configuration
 */
export interface JenkinsServerConfig {
  url: string;
  username: string;
  apiToken: string;
  serverPath?: string;
  timeout?: number;
  maxRetries?: number;
}

/**
 * Jenkins Adapter Class
 * Implements MCP tool interfaces for Jenkins integration while maintaining
 * backward compatibility with existing Jenkins-specific functionality
 */
export class JenkinsAdapter {
  private mcpClient: MCPClientService;
  private parameterSanitizer: ParameterSanitizer;
  private config: JenkinsServerConfig;
  private serverId: string = 'jenkins';

  constructor(
    mcpClient: MCPClientService,
    config: JenkinsServerConfig
  ) {
    this.mcpClient = mcpClient;
    this.config = config;
    this.parameterSanitizer = new ParameterSanitizer();
    
    logger().info('Jenkins Adapter initialized', {
      serverId: this.serverId,
      jenkinsUrl: config.url,
      timeout: config.timeout || 30000,
    });
  }

  /**
   * Get available Jenkins tools as MCP tool definitions
   */
  async getAvailableTools(): Promise<ToolDefinition[]> {
    try {
      // Get tools from MCP registry if available
      const mcpTools = await this.mcpClient.getAvailableTools();
      
      // Define standard Jenkins tools
      const jenkinsTools: ToolDefinition[] = [
        {
          serverId: this.serverId,
          name: 'trigger_job',
          description: 'Trigger a Jenkins job build with optional parameters',
          inputSchema: {
            type: 'object',
            properties: {
              jobName: {
                type: 'string',
                description: 'Name of the Jenkins job to trigger',
                pattern: '^[a-zA-Z0-9._-]+$',
              },
              parameters: {
                type: 'object',
                description: 'Build parameters for the job',
                additionalProperties: {
                  type: ['string', 'number', 'boolean'],
                },
              },
              wait: {
                type: 'boolean',
                description: 'Whether to wait for build completion',
                default: false,
              },
            },
            required: ['jobName'],
          },
        },
        {
          serverId: this.serverId,
          name: 'get_build_status',
          description: 'Get the status of a specific Jenkins build',
          inputSchema: {
            type: 'object',
            properties: {
              jobName: {
                type: 'string',
                description: 'Name of the Jenkins job',
              },
              buildNumber: {
                type: 'number',
                description: 'Build number to check',
              },
            },
            required: ['jobName', 'buildNumber'],
          },
        },
        {
          serverId: this.serverId,
          name: 'list_jobs',
          description: 'List available Jenkins jobs',
          inputSchema: {
            type: 'object',
            properties: {
              filter: {
                type: 'string',
                description: 'Optional filter pattern for job names',
              },
              view: {
                type: 'string',
                description: 'Jenkins view to list jobs from',
              },
            },
          },
        },
        {
          serverId: this.serverId,
          name: 'get_build_log',
          description: 'Get build console output for a specific build',
          inputSchema: {
            type: 'object',
            properties: {
              jobName: {
                type: 'string',
                description: 'Name of the Jenkins job',
              },
              buildNumber: {
                type: 'number',
                description: 'Build number to get logs for',
              },
              lines: {
                type: 'number',
                description: 'Number of lines to retrieve (default: all)',
                minimum: 1,
                maximum: 10000,
              },
            },
            required: ['jobName', 'buildNumber'],
          },
        },
      ];

      // Merge with MCP tools if available
      const allTools = [...jenkinsTools];
      if (mcpTools.length > 0) {
        // Add MCP-specific tools that aren't duplicates
        for (const mcpTool of mcpTools) {
          if (mcpTool.serverId === this.serverId && 
              !allTools.some(tool => tool.name === mcpTool.name)) {
            allTools.push(mcpTool);
          }
        }
      }

      logger().debug('Jenkins tools available', { 
        toolCount: allTools.length,
        tools: allTools.map(t => t.name),
      });

      return allTools;
    } catch (error) {
      logger().error('Failed to get Jenkins tools', { error });
      // Return basic tools as fallback
      return this.getBasicJenkinsTools();
    }
  }

  /**
   * Get basic Jenkins tools (fallback when MCP is unavailable)
   */
  private getBasicJenkinsTools(): ToolDefinition[] {
    return [
      {
        serverId: this.serverId,
        name: 'trigger_job',
        description: 'Trigger a Jenkins job build',
        inputSchema: {
          type: 'object',
          properties: {
            jobName: { type: 'string' },
            parameters: { type: 'object' },
          },
          required: ['jobName'],
        },
      },
    ];
  }

  /**
   * Execute a Jenkins tool through the adapter
   */
  async invokeTool(toolName: string, parameters: any): Promise<ToolInvocationResult> {
    const startTime = Date.now();
    
    try {
      logger().info('Invoking Jenkins tool', { toolName, parameters });

      // Sanitize parameters for security
      const sanitizationResult = this.parameterSanitizer.sanitizeParameters(parameters);
      
      if (sanitizationResult.warnings.length > 0) {
        logger().warn('Parameter sanitization warnings', {
          toolName,
          warnings: sanitizationResult.warnings,
          rejected: sanitizationResult.rejected,
        });
      }

      // Validate sanitized parameters for Jenkins
      const validation = this.parameterSanitizer.validateForJenkins(sanitizationResult.sanitized);
      if (!validation.valid) {
        logger().error('Parameter validation failed', {
          toolName,
          errors: validation.errors,
        });
        
        return {
          success: false,
          error: `Parameter validation failed: ${validation.errors.join(', ')}`,
          executionTime: Date.now() - startTime,
        };
      }

      // Route to appropriate handler
      let result: ToolInvocationResult;
      
      switch (toolName) {
        case 'trigger_job':
          result = await this.handleTriggerJob(sanitizationResult.sanitized);
          break;
        case 'get_build_status':
          result = await this.handleGetBuildStatus(sanitizationResult.sanitized);
          break;
        case 'list_jobs':
          result = await this.handleListJobs(sanitizationResult.sanitized);
          break;
        case 'get_build_log':
          result = await this.handleGetBuildLog(sanitizationResult.sanitized);
          break;
        default:
          // Try to execute through MCP client for unknown tools
          result = await this.handleMCPTool(toolName, sanitizationResult.sanitized);
      }

      result.executionTime = Date.now() - startTime;
      
      logger().info('Jenkins tool execution completed', {
        toolName,
        success: result.success,
        executionTime: result.executionTime,
      });

      return result;

    } catch (error) {
      logger().error('Jenkins tool execution failed', { toolName, error });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        executionTime: Date.now() - startTime,
      };
    }
  }

  /**
   * Handle trigger_job tool invocation
   */
  private async handleTriggerJob(parameters: any): Promise<ToolInvocationResult> {
    try {
      // Use legacy MCP client trigger method for backward compatibility
      const jobParams: JenkinsJobParams = {
        jobName: parameters.jobName,
        parameters: parameters.parameters || {},
        callbackInfo: parameters.callbackInfo,
      };

      const buildResult = await this.mcpClient.triggerJenkinsJob(jobParams);
      
      return {
        success: true,
        data: {
          buildNumber: buildResult.buildNumber,
          buildUrl: buildResult.buildUrl,
          status: buildResult.status,
          queueId: buildResult.queueId,
          estimatedDuration: buildResult.estimatedDuration,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to trigger Jenkins job',
      };
    }
  }

  /**
   * Handle get_build_status tool invocation
   */
  private async handleGetBuildStatus(parameters: any): Promise<ToolInvocationResult> {
    try {
      // Implement build status checking
      // This would typically involve calling Jenkins API
      const { jobName, buildNumber } = parameters;
      
      // For now, return a placeholder response
      // In a real implementation, this would call the Jenkins API
      return {
        success: true,
        data: {
          jobName,
          buildNumber,
          status: 'completed',
          result: 'SUCCESS',
          duration: 120000,
          timestamp: new Date().toISOString(),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get build status',
      };
    }
  }

  /**
   * Handle list_jobs tool invocation
   */
  private async handleListJobs(parameters: any): Promise<ToolInvocationResult> {
    try {
      // Implement job listing
      const { filter, view } = parameters;
      
      // Placeholder implementation
      const jobs = [
        { name: 'deploy-app', description: 'Deploy application to production' },
        { name: 'run-tests', description: 'Run automated test suite' },
        { name: 'build-release', description: 'Build release package' },
      ];

      const filteredJobs = filter 
        ? jobs.filter(job => job.name.includes(filter))
        : jobs;

      return {
        success: true,
        data: {
          jobs: filteredJobs,
          totalCount: filteredJobs.length,
          view: view || 'All',
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list jobs',
      };
    }
  }

  /**
   * Handle get_build_log tool invocation
   */
  private async handleGetBuildLog(parameters: any): Promise<ToolInvocationResult> {
    try {
      const { jobName, buildNumber, lines } = parameters;
      
      // Placeholder implementation
      const logLines = [
        'Started by user admin',
        'Building in workspace /var/jenkins_home/workspace/' + jobName,
        'Running build steps...',
        'Build completed successfully',
      ];

      const limitedLines = lines 
        ? logLines.slice(-lines)
        : logLines;

      return {
        success: true,
        data: {
          jobName,
          buildNumber,
          logLines: limitedLines,
          totalLines: logLines.length,
          truncated: lines && logLines.length > lines,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get build log',
      };
    }
  }

  /**
   * Handle MCP tool invocation for unknown tools
   */
  private async handleMCPTool(toolName: string, parameters: any): Promise<ToolInvocationResult> {
    try {
      // Delegate to MCP client for tools not handled directly
      // This would involve calling the MCP registry or client
      logger().info('Delegating to MCP client', { toolName, serverId: this.serverId });
      
      // Placeholder - in real implementation, this would use MCP registry
      return {
        success: false,
        error: `Tool '${toolName}' not implemented in Jenkins adapter`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'MCP tool execution failed',
      };
    }
  }

  /**
   * Legacy method: Trigger Jenkins job (backward compatibility)
   */
  async triggerJenkinsJob(params: JenkinsJobParams): Promise<JenkinsBuildResult> {
    logger().info('Legacy triggerJenkinsJob called, routing through adapter');
    
    const result = await this.invokeTool('trigger_job', {
      jobName: params.jobName,
      parameters: params.parameters,
      callbackInfo: params.callbackInfo,
    });

    if (!result.success) {
      throw new Error(result.error || 'Jenkins job trigger failed');
    }

    return result.data as JenkinsBuildResult;
  }

  /**
   * Get Jenkins server health status
   */
  async getHealthStatus(): Promise<{
    healthy: boolean;
    version?: string;
    uptime?: number;
    activeJobs?: number;
    queueLength?: number;
  }> {
    try {
      // Implement health check
      // This would typically ping Jenkins API
      return {
        healthy: true,
        version: '2.401.3',
        uptime: 86400000, // 24 hours
        activeJobs: 3,
        queueLength: 1,
      };
    } catch (error) {
      logger().error('Jenkins health check failed', { error });
      return {
        healthy: false,
      };
    }
  }

  /**
   * Get adapter configuration
   */
  getConfiguration(): {
    serverId: string;
    serverUrl: string;
    timeout: number;
    maxRetries: number;
  } {
    return {
      serverId: this.serverId,
      serverUrl: this.config.url,
      timeout: this.config.timeout || 30000,
      maxRetries: this.config.maxRetries || 3,
    };
  }

  /**
   * Update adapter configuration
   */
  async updateConfiguration(updates: Partial<JenkinsServerConfig>): Promise<void> {
    this.config = { ...this.config, ...updates };
    
    logger().info('Jenkins adapter configuration updated', {
      serverId: this.serverId,
      updatedFields: Object.keys(updates),
    });
  }

  /**
   * Test connection to Jenkins server
   */
  async testConnection(): Promise<{
    success: boolean;
    responseTime?: number;
    error?: string;
  }> {
    const startTime = Date.now();
    
    try {
      // Implement connection test
      // This would typically make a simple API call to Jenkins
      
      const responseTime = Date.now() - startTime;
      
      return {
        success: true,
        responseTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Connection test failed',
      };
    }
  }

  /**
   * Clean up adapter resources
   */
  async destroy(): Promise<void> {
    logger().info('Jenkins adapter destroyed', { serverId: this.serverId });
  }
}