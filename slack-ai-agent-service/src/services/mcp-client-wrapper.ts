import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { MCPServerConfig } from '../types/mcp';
import { ToolDefinition, ToolInvocationResult } from '../types/ai-agent';
import { logger } from '../utils/logger';
import { validateSpawnArguments } from '../config/security';

export class MCPClientWrapper {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private config: MCPServerConfig;
  private isConnected = false;
  private tools: ToolDefinition[] = [];
  private lastError: string | null = null;

  constructor(config: MCPServerConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    if (this.isConnected) {
      throw new Error(`MCP server ${this.config.id} is already connected`);
    }

    try {
      // Validate spawn arguments for security
      if (!validateSpawnArguments(this.config.command, this.config.args)) {
        throw new Error(`Invalid spawn arguments for server ${this.config.id}`);
      }

      // Create transport with timeout
      this.transport = new StdioClientTransport({
        command: this.config.command,
        args: this.config.args,
        env: this.config.env
      });

      // Create client
      this.client = new Client(
        {
          name: `slack-ai-agent-${this.config.id}`,
          version: '1.0.0'
        },
        {
          capabilities: {}
        }
      );

      // Set up connection timeout
      const timeout = this.config.timeout || 30000;
      const connectPromise = this.client.connect(this.transport);
      
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Connection timeout after ${timeout}ms`)), timeout);
      });

      await Promise.race([connectPromise, timeoutPromise]);
      
      this.isConnected = true;
      this.lastError = null;

      logger().info(`MCP client connected to server: ${this.config.id}`, {
        serverId: this.config.id,
        command: this.config.command,
        timeout
      });

    } catch (error) {
      this.lastError = error instanceof Error ? error.message : 'Unknown error';
      logger().error(`Failed to connect to MCP server: ${this.config.id}`, { error });
      throw error;
    }
  }

  async discoverTools(): Promise<ToolDefinition[]> {
    if (!this.client || !this.isConnected) {
      throw new Error(`MCP server ${this.config.id} is not connected`);
    }

    try {
      const response = await this.client.listTools();
      
      this.tools = response.tools.map(tool => ({
        serverId: this.config.id,
        name: tool.name,
        description: tool.description || '',
        inputSchema: tool.inputSchema || {},
        outputSchema: undefined // MCP tools don't typically define output schemas
      }));

      logger().info(`Discovered ${this.tools.length} tools from server: ${this.config.id}`, {
        serverId: this.config.id,
        toolCount: this.tools.length,
        toolNames: this.tools.map(t => t.name)
      });

      return [...this.tools];
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : 'Tool discovery failed';
      logger().error(`Failed to discover tools from server: ${this.config.id}`, { error });
      throw error;
    }
  }

  async invokeTool(toolName: string, parameters: any): Promise<ToolInvocationResult> {
    const startTime = Date.now();

    if (!this.client || !this.isConnected) {
      const executionTime = Date.now() - startTime;
      return {
        success: false,
        error: `MCP server ${this.config.id} is not connected`,
        executionTime
      };
    }

    try {
      // Validate tool exists
      const tool = this.tools.find(t => t.name === toolName);
      if (!tool) {
        throw new Error(`Tool '${toolName}' not found on server ${this.config.id}`);
      }

      logger().debug(`Invoking tool: ${toolName} on server: ${this.config.id}`, {
        serverId: this.config.id,
        toolName,
        parameters
      });

      const response = await this.client.callTool({
        name: toolName,
        arguments: parameters
      });

      const executionTime = Date.now() - startTime;

      logger().info(`Tool invocation successful: ${toolName}`, {
        serverId: this.config.id,
        toolName,
        executionTime,
        success: true
      });

      return {
        success: true,
        data: response.content,
        executionTime
      };

    } catch (error) {
      const executionTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Tool invocation failed';
      this.lastError = errorMessage;

      logger().error(`Tool invocation failed: ${toolName}`, {
        serverId: this.config.id,
        toolName,
        error: errorMessage,
        executionTime
      });

      return {
        success: false,
        error: errorMessage,
        executionTime
      };
    }
  }

  async disconnect(): Promise<void> {
    if (!this.isConnected) {
      return;
    }

    try {
      if (this.client) {
        await this.client.close();
      }
      if (this.transport) {
        await this.transport.close();
      }
    } catch (error) {
      logger().warn(`Error during disconnect for server: ${this.config.id}`, { error });
    } finally {
      this.client = null;
      this.transport = null;
      this.isConnected = false;
      this.tools = [];
      
      logger().info(`MCP client disconnected from server: ${this.config.id}`, {
        serverId: this.config.id
      });
    }
  }

  // Getters for status monitoring
  get connected(): boolean {
    return this.isConnected;
  }

  get serverId(): string {
    return this.config.id;
  }

  get availableTools(): ToolDefinition[] {
    return [...this.tools];
  }

  get lastErrorMessage(): string | null {
    return this.lastError;
  }

  get serverConfig(): MCPServerConfig {
    return { ...this.config };
  }
}