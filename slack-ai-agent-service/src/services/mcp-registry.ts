import fs from 'fs/promises';
import path from 'path';
import { MCPServerConfig, MCPConfig, MCPServerStatus, MCPToolDiscovery } from '../types/mcp';
import { ToolDefinition, ToolInvocationResult } from '../types/ai-agent';
import { MCPClientWrapper } from './mcp-client-wrapper';
import { logger } from '../utils/logger';
import { getConfig } from '../config/environment';

export class MCPRegistryService {
  private servers = new Map<string, MCPServerConfig>();
  private clients = new Map<string, MCPClientWrapper>();
  private toolCache = new Map<string, ToolDefinition[]>();
  private serverStatus = new Map<string, MCPServerStatus>();
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      const config = getConfig();
      await this.loadFromConfig(config.mcp.configFile);
      this.initialized = true;
      
      logger().info('MCP Registry initialized successfully', {
        serverCount: this.servers.size,
        enabledServers: Array.from(this.servers.values()).filter(s => s.enabled).length
      });
    } catch (error) {
      logger().error('Failed to initialize MCP Registry', { error });
      throw error;
    }
  }

  async loadFromConfig(configPath: string): Promise<void> {
    try {
      // Resolve path relative to project root
      const fullPath = path.resolve(configPath);
      const configData = await fs.readFile(fullPath, 'utf-8');
      const mcpConfig: MCPConfig = JSON.parse(configData);

      // Clear existing servers
      await this.disconnectAll();
      this.servers.clear();
      this.serverStatus.clear();
      this.toolCache.clear();

      // Load server configurations
      for (const [serverId, serverConfig] of Object.entries(mcpConfig.servers)) {
        if (!this.validateServerConfig(serverConfig)) {
          logger().warn(`Invalid server configuration for: ${serverId}`, { serverConfig });
          continue;
        }

        // Substitute environment variables
        const processedConfig = this.processEnvironmentVariables(serverConfig);
        this.servers.set(serverId, processedConfig);
        
        // Initialize server status
        this.serverStatus.set(serverId, {
          serverId,
          connected: false,
          toolCount: 0,
          lastError: undefined
        });

        logger().debug(`Loaded server configuration: ${serverId}`, {
          serverId,
          enabled: processedConfig.enabled,
          command: processedConfig.command
        });
      }

      logger().info(`Loaded ${this.servers.size} server configurations from: ${configPath}`, {
        configPath,
        serverIds: Array.from(this.servers.keys())
      });

    } catch (error) {
      logger().error(`Failed to load MCP configuration from: ${configPath}`, { error });
      throw new Error(`Failed to load MCP configuration: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private validateServerConfig(config: MCPServerConfig): boolean {
    const required = ['id', 'name', 'description', 'command', 'args'];
    const missing = required.filter(field => !config[field as keyof MCPServerConfig]);
    
    if (missing.length > 0) {
      logger().warn(`Server configuration missing required fields: ${missing.join(', ')}`, { config });
      return false;
    }

    if (!Array.isArray(config.args)) {
      logger().warn('Server configuration args must be an array', { config });
      return false;
    }

    return true;
  }

  private processEnvironmentVariables(config: MCPServerConfig): MCPServerConfig {
    const processed = { ...config };

    // Process env object
    if (processed.env) {
      const processedEnv: Record<string, string> = {};
      for (const [key, value] of Object.entries(processed.env)) {
        if (typeof value === 'string' && value.startsWith('${') && value.endsWith('}')) {
          const envVar = value.slice(2, -1);
          const envValue = process.env[envVar];
          if (!envValue) {
            logger().warn(`Environment variable not found: ${envVar}`, { serverId: config.id });
          }
          processedEnv[key] = envValue || '';
        } else {
          processedEnv[key] = value;
        }
      }
      processed.env = processedEnv;
    }

    return processed;
  }

  async connectToServer(serverId: string): Promise<void> {
    const config = this.servers.get(serverId);
    if (!config) {
      throw new Error(`Server not found: ${serverId}`);
    }

    if (!config.enabled) {
      throw new Error(`Server is disabled: ${serverId}`);
    }

    // Check if already connected
    const existingClient = this.clients.get(serverId);
    if (existingClient && existingClient.connected) {
      return;
    }

    try {
      const client = new MCPClientWrapper(config);
      await client.connect();
      
      this.clients.set(serverId, client);
      this.updateServerStatus(serverId, {
        connected: true,
        lastConnected: new Date(),
        lastError: undefined
      });

      logger().info(`Successfully connected to server: ${serverId}`, { serverId });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Connection failed';
      this.updateServerStatus(serverId, {
        connected: false,
        lastError: errorMessage
      });
      throw error;
    }
  }

  async disconnectFromServer(serverId: string): Promise<void> {
    const client = this.clients.get(serverId);
    if (!client) {
      return;
    }

    try {
      await client.disconnect();
      this.clients.delete(serverId);
      this.toolCache.delete(serverId);
      this.updateServerStatus(serverId, {
        connected: false,
        toolCount: 0
      });

      logger().info(`Successfully disconnected from server: ${serverId}`, { serverId });

    } catch (error) {
      logger().warn(`Error disconnecting from server: ${serverId}`, { error });
    }
  }

  async disconnectAll(): Promise<void> {
    const disconnectPromises = Array.from(this.clients.keys()).map(
      serverId => this.disconnectFromServer(serverId).catch(error => 
        logger().warn(`Failed to disconnect from server: ${serverId}`, { error })
      )
    );

    await Promise.all(disconnectPromises);
    logger().info('Disconnected from all MCP servers');
  }

  async discoverAllTools(): Promise<ToolDefinition[]> {
    const enabledServers = Array.from(this.servers.values()).filter(s => s.enabled);
    const discoveryPromises = enabledServers.map(server => 
      this.discoverServerTools(server.id).catch(error => {
        logger().warn(`Tool discovery failed for server: ${server.id}`, { error });
        return [];
      })
    );

    const toolArrays = await Promise.all(discoveryPromises);
    const allTools = toolArrays.flat();

    logger().info(`Discovered ${allTools.length} tools across ${enabledServers.length} servers`, {
      totalTools: allTools.length,
      serverCount: enabledServers.length
    });

    return allTools;
  }

  async discoverServerTools(serverId: string): Promise<ToolDefinition[]> {
    // Check cache first
    const cached = this.toolCache.get(serverId);
    if (cached) {
      return [...cached];
    }

    // Ensure server is connected
    await this.connectToServer(serverId);

    const client = this.clients.get(serverId);
    if (!client) {
      throw new Error(`No client available for server: ${serverId}`);
    }

    try {
      const tools = await client.discoverTools();
      this.toolCache.set(serverId, tools);
      this.updateServerStatus(serverId, { toolCount: tools.length });
      
      return [...tools];

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Tool discovery failed';
      this.updateServerStatus(serverId, { lastError: errorMessage });
      throw error;
    }
  }

  async invokeToolSafely(serverId: string, toolName: string, parameters: any): Promise<ToolInvocationResult> {
    try {
      // Ensure server is connected and tools are discovered
      await this.connectToServer(serverId);
      await this.discoverServerTools(serverId);

      const client = this.clients.get(serverId);
      if (!client) {
        return {
          success: false,
          error: `No client available for server: ${serverId}`,
          executionTime: 0
        };
      }

      return await client.invokeTool(toolName, parameters);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Tool invocation failed';
      return {
        success: false,
        error: errorMessage,
        executionTime: 0
      };
    }
  }

  // Status and monitoring methods
  getServerStatus(serverId: string): MCPServerStatus | undefined {
    return this.serverStatus.get(serverId);
  }

  getAllServerStatus(): MCPServerStatus[] {
    return Array.from(this.serverStatus.values());
  }

  getServer(serverId: string): MCPServerConfig | undefined {
    const config = this.servers.get(serverId);
    return config ? { ...config } : undefined;
  }

  getAllServers(): MCPServerConfig[] {
    return Array.from(this.servers.values()).map(s => ({ ...s }));
  }

  getEnabledServers(): MCPServerConfig[] {
    return this.getAllServers().filter(s => s.enabled);
  }

  getCachedTools(serverId?: string): ToolDefinition[] {
    if (serverId) {
      return [...(this.toolCache.get(serverId) || [])];
    }

    // Return all cached tools
    return Array.from(this.toolCache.values()).flat();
  }

  private updateServerStatus(serverId: string, updates: Partial<MCPServerStatus>): void {
    const current = this.serverStatus.get(serverId);
    if (current) {
      this.serverStatus.set(serverId, { ...current, ...updates });
    }
  }

  // Cleanup
  async destroy(): Promise<void> {
    await this.disconnectAll();
    this.servers.clear();
    this.clients.clear();
    this.toolCache.clear();
    this.serverStatus.clear();
    this.initialized = false;
    
    logger().info('MCP Registry destroyed and cleaned up');
  }
}