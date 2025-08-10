import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { getConfig } from '../config/environment';
import { logger } from '../utils/logger';
import { JenkinsJobRequest, JenkinsJobResult } from '../types/jenkins';
import { validateJenkinsPath, validateSpawnArguments } from '../config/security';

export class MCPClientService {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;

  async initialize(): Promise<void> {
    try {
      const config = getConfig();
      
      // Validate Jenkins server path
      const isPathValid = validateJenkinsPath(config.mcp.jenkinsServerPath, {
        allowedPaths: config.mcp.allowedPaths,
        requireExecutable: true,
        allowRelativePaths: config.mcp.allowRelativePaths,
      });
      
      if (!isPathValid) {
        throw new Error('Jenkins server path validation failed: path is not secure or not in allowed directory');
      }
      
      // Validate spawn arguments
      const command = 'node';
      const args = [config.mcp.jenkinsServerPath];
      
      if (!validateSpawnArguments(command, args)) {
        throw new Error('Jenkins server spawn arguments validation failed: arguments contain unsafe patterns');
      }
      
      // Create secure transport with enhanced options
      this.transport = new StdioClientTransport({
        command,
        args,
        // Security-focused environment (minimal inheritance)
        env: {
          NODE_ENV: config.app.nodeEnv,
          PATH: process.env.PATH || '/usr/bin:/bin',
        },
        // Enhanced security options are handled by the SDK's spawn call
        // Additional security constraints would be applied at OS level
        cwd: process.cwd(),
        stderr: 'pipe', // Capture stderr for security monitoring
      });

      this.client = new Client({
        name: 'slack-ai-agent',
        version: '1.0.0',
      }, {
        capabilities: {},
      });

      // Set up timeout for connection
      const connectTimeout = setTimeout(() => {
        logger().error('MCP client connection timeout');
        this.disconnect();
      }, config.mcp.processTimeout);

      await this.client.connect(this.transport);
      clearTimeout(connectTimeout);
      
      logger().info('MCP client connected to Jenkins server with enhanced security', {
        path: config.mcp.jenkinsServerPath,
        timeout: config.mcp.processTimeout,
        allowRelativePaths: config.mcp.allowRelativePaths,
      });
    } catch (error) {
      logger().error('Failed to initialize MCP client:', error);
      throw error;
    }
  }

  async triggerJenkinsJob(request: JenkinsJobRequest): Promise<JenkinsJobResult> {
    if (!this.client) {
      await this.initialize();
    }

    try {
      const response = await this.client!.callTool({
        name: 'trigger_jenkins_job',
        arguments: request as Record<string, unknown>,
      });

      const content = response.content as any[];
      return content[0] as JenkinsJobResult;
    } catch (error) {
      logger().error('Failed to trigger Jenkins job:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.client && this.transport) {
      await this.client.close();
      await this.transport.close();
      this.client = null;
      this.transport = null;
    }
  }
}