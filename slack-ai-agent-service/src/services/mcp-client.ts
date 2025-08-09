import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { getConfig } from '../config/environment';
import { logger } from '../utils/logger';
import { JenkinsJobRequest, JenkinsJobResult } from '../types/jenkins';

export class MCPClientService {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;

  async initialize(): Promise<void> {
    try {
      const config = getConfig();
      this.transport = new StdioClientTransport({
        command: 'node',
        args: [config.mcp.jenkinsServerPath],
      });

      this.client = new Client({
        name: 'slack-ai-agent',
        version: '1.0.0',
      }, {
        capabilities: {},
      });

      await this.client.connect(this.transport);
      logger().info('MCP client connected to Jenkins server');
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