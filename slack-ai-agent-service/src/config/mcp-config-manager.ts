/**
 * Runtime MCP Configuration Management System
 * Handles dynamic loading, validation, and hot-reloading of MCP server configurations
 */

import fs from 'fs/promises';
import path from 'path';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import {
  EnhancedMCPConfig,
  MCPServerConfig,
  MCPConfigChangeEvent,
  MCPConfigValidationResult,
  MCP_CONFIG_DEFAULTS,
} from './mcp-interfaces';
import {
  validateEnhancedMCPConfig,
  validateMCPServerConfig,
  createDefaultMCPServerConfig,
} from './mcp-validation';

/**
 * Configuration manager events
 */
export interface MCPConfigManagerEvents {
  'config-loaded': (config: EnhancedMCPConfig) => void;
  'config-changed': (event: MCPConfigChangeEvent) => void;
  'config-error': (error: Error) => void;
  'server-added': (serverId: string, config: MCPServerConfig) => void;
  'server-removed': (serverId: string) => void;
  'server-updated': (serverId: string, newConfig: MCPServerConfig, oldConfig: MCPServerConfig) => void;
}

/**
 * MCP Configuration Manager
 * Provides runtime management of MCP server configurations with hot-reloading,
 * validation, and secure credential handling.
 */
export class MCPConfigManager extends EventEmitter {
  private config: EnhancedMCPConfig | null = null;
  private configPath: string;
  private watcher: fs.FileSystemWatcher | null = null;
  private lastModified: Date | null = null;
  private reloadTimeout: NodeJS.Timeout | null = null;

  constructor(configPath: string) {
    super();
    this.configPath = path.resolve(configPath);
    logger().info('MCP Configuration Manager initialized', { configPath: this.configPath });
  }

  /**
   * Load and validate configuration from file
   */
  async loadConfig(): Promise<EnhancedMCPConfig> {
    try {
      logger().info('Loading MCP configuration', { path: this.configPath });

      // Check if file exists
      try {
        await fs.access(this.configPath);
      } catch (error) {
        logger().warn('Configuration file not found, creating default', { path: this.configPath });
        await this.createDefaultConfig();
      }

      // Read and parse configuration
      const fileContent = await fs.readFile(this.configPath, 'utf-8');
      const rawConfig = JSON.parse(fileContent);

      // Validate configuration
      const validation = validateEnhancedMCPConfig(rawConfig);
      if (!validation.valid) {
        const errorMessage = validation.errors.map(e => `${e.path}: ${e.message}`).join('\n');
        throw new Error(`Configuration validation failed:\n${errorMessage}`);
      }

      // Log warnings if any
      if (validation.warnings.length > 0) {
        const warningMessage = validation.warnings.map(w => `${w.path}: ${w.message}`).join('\n');
        logger().warn('Configuration warnings:\n' + warningMessage);
      }

      this.config = validation.config!;
      this.lastModified = new Date();

      // Process environment variable substitution
      await this.processEnvironmentSubstitution();

      // Start watching for changes if enabled
      if (this.config.watchConfigFile) {
        await this.startWatching();
      }

      logger().info('MCP configuration loaded successfully', {
        servers: Object.keys(this.config.servers).length,
        enabledServers: Object.values(this.config.servers).filter(s => s.enabled).length,
      });

      this.emit('config-loaded', this.config);
      return this.config;

    } catch (error) {
      logger().error('Failed to load MCP configuration', { error, path: this.configPath });
      this.emit('config-error', error as Error);
      throw error;
    }
  }

  /**
   * Create default configuration file
   */
  private async createDefaultConfig(): Promise<void> {
    const defaultConfig: EnhancedMCPConfig = {
      configFile: this.configPath,
      watchConfigFile: true,
      globalTimeout: 30000,
      maxConcurrentConnections: 10,
      allowedPaths: ['/usr/local/bin', '/opt/homebrew/bin', './node_modules/.bin'],
      processTimeout: 30000,
      allowRelativePaths: process.env.NODE_ENV === 'development',
      security: { ...MCP_CONFIG_DEFAULTS.security },
      registry: { ...MCP_CONFIG_DEFAULTS.registry },
      servers: {},
      stats: {
        totalOperations: 0,
        totalFailures: 0,
      },
    };

    // Add default Jenkins server if available
    if (process.env.JENKINS_MCP_SERVER_PATH) {
      defaultConfig.servers.jenkins = createDefaultMCPServerConfig('jenkins', {
        name: 'Jenkins CI/CD',
        description: 'Manage Jenkins jobs and builds',
        command: 'node',
        args: [process.env.JENKINS_MCP_SERVER_PATH],
        env: {
          JENKINS_URL: '${JENKINS_URL}',
          JENKINS_USERNAME: '${JENKINS_USERNAME}',
          JENKINS_API_TOKEN: '${JENKINS_API_TOKEN}',
        },
        capabilities: ['build', 'deployment', 'ci-cd'],
        tags: ['jenkins', 'ci', 'cd'],
        priority: 80,
      });
    }

    // Ensure directory exists
    await fs.mkdir(path.dirname(this.configPath), { recursive: true });

    // Write default configuration
    await fs.writeFile(this.configPath, JSON.stringify(defaultConfig, null, 2), 'utf-8');
    logger().info('Created default MCP configuration', { path: this.configPath });
  }

  /**
   * Process environment variable substitution in server configurations
   */
  private async processEnvironmentSubstitution(): Promise<void> {
    if (!this.config) return;

    for (const [serverId, serverConfig] of Object.entries(this.config.servers)) {
      if (serverConfig.security.useEnvSubstitution) {
        for (const [key, value] of Object.entries(serverConfig.env)) {
          if (typeof value === 'string' && value.includes('${')) {
            try {
              const substituted = value.replace(/\$\{([^}]+)\}/g, (match, varName) => {
                const envValue = process.env[varName];
                if (envValue === undefined) {
                  logger().warn('Environment variable not found', { 
                    serverId, 
                    key, 
                    varName 
                  });
                  return match; // Keep original if not found
                }
                return envValue;
              });
              serverConfig.env[key] = substituted;
            } catch (error) {
              logger().error('Error processing environment substitution', {
                serverId,
                key,
                error,
              });
            }
          }
        }
      }
    }
  }

  /**
   * Start watching configuration file for changes
   */
  private async startWatching(): Promise<void> {
    if (this.watcher) {
      this.watcher.close();
    }

    try {
      const { watch } = await import('chokidar');
      this.watcher = watch(this.configPath, {
        persistent: true,
        ignoreInitial: true,
      });

      this.watcher.on('change', () => this.handleConfigChange());
      this.watcher.on('error', (error) => {
        logger().error('Configuration file watcher error', { error });
        this.emit('config-error', error);
      });

      logger().info('Started watching configuration file', { path: this.configPath });
    } catch (error) {
      logger().warn('Failed to start configuration file watcher', { error });
    }
  }

  /**
   * Handle configuration file changes
   */
  private handleConfigChange(): void {
    // Debounce rapid changes
    if (this.reloadTimeout) {
      clearTimeout(this.reloadTimeout);
    }

    this.reloadTimeout = setTimeout(async () => {
      try {
        logger().info('Configuration file changed, reloading...');
        const previousConfig = this.config;
        await this.loadConfig();

        // Emit change events for specific servers
        if (previousConfig && this.config) {
          this.detectAndEmitChanges(previousConfig, this.config);
        }

        const event: MCPConfigChangeEvent = {
          type: 'config_reloaded',
          timestamp: new Date(),
          source: 'file_watch',
        };
        this.emit('config-changed', event);

      } catch (error) {
        logger().error('Failed to reload configuration', { error });
        this.emit('config-error', error as Error);
      }
    }, 1000);
  }

  /**
   * Detect and emit specific change events
   */
  private detectAndEmitChanges(oldConfig: EnhancedMCPConfig, newConfig: EnhancedMCPConfig): void {
    const oldServerIds = new Set(Object.keys(oldConfig.servers));
    const newServerIds = new Set(Object.keys(newConfig.servers));

    // Detect added servers
    for (const serverId of newServerIds) {
      if (!oldServerIds.has(serverId)) {
        const event: MCPConfigChangeEvent = {
          type: 'server_added',
          serverId,
          newConfig: newConfig.servers[serverId],
          timestamp: new Date(),
          source: 'file_watch',
        };
        this.emit('config-changed', event);
        this.emit('server-added', serverId, newConfig.servers[serverId]);
      }
    }

    // Detect removed servers
    for (const serverId of oldServerIds) {
      if (!newServerIds.has(serverId)) {
        const event: MCPConfigChangeEvent = {
          type: 'server_removed',
          serverId,
          previousConfig: oldConfig.servers[serverId],
          timestamp: new Date(),
          source: 'file_watch',
        };
        this.emit('config-changed', event);
        this.emit('server-removed', serverId);
      }
    }

    // Detect updated servers
    for (const serverId of newServerIds) {
      if (oldServerIds.has(serverId)) {
        const oldServer = oldConfig.servers[serverId];
        const newServer = newConfig.servers[serverId];
        
        if (JSON.stringify(oldServer) !== JSON.stringify(newServer)) {
          const event: MCPConfigChangeEvent = {
            type: 'server_updated',
            serverId,
            previousConfig: oldServer,
            newConfig: newServer,
            timestamp: new Date(),
            source: 'file_watch',
          };
          this.emit('config-changed', event);
          this.emit('server-updated', serverId, newServer, oldServer);
        }
      }
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): EnhancedMCPConfig {
    if (!this.config) {
      throw new Error('Configuration not loaded. Call loadConfig() first.');
    }
    return { ...this.config }; // Return a copy
  }

  /**
   * Get server configuration by ID
   */
  getServerConfig(serverId: string): MCPServerConfig | null {
    if (!this.config) {
      return null;
    }
    const server = this.config.servers[serverId];
    return server ? { ...server } : null; // Return a copy
  }

  /**
   * Get all enabled server configurations
   */
  getEnabledServers(): Record<string, MCPServerConfig> {
    if (!this.config) {
      return {};
    }
    
    const enabled: Record<string, MCPServerConfig> = {};
    for (const [serverId, serverConfig] of Object.entries(this.config.servers)) {
      if (serverConfig.enabled) {
        enabled[serverId] = { ...serverConfig };
      }
    }
    return enabled;
  }

  /**
   * Add or update server configuration
   */
  async addOrUpdateServer(serverId: string, serverConfig: Partial<MCPServerConfig>): Promise<void> {
    if (!this.config) {
      throw new Error('Configuration not loaded');
    }

    const isNew = !this.config.servers[serverId];
    const previousConfig = this.config.servers[serverId];

    // Create full configuration with defaults
    const fullConfig = isNew 
      ? createDefaultMCPServerConfig(serverId, serverConfig)
      : { ...previousConfig, ...serverConfig, lastModified: new Date() };

    // Validate the server configuration
    const validation = validateMCPServerConfig(fullConfig);
    if (!validation.valid) {
      const errorMessage = validation.errors.map(e => `${e.path}: ${e.message}`).join('\n');
      throw new Error(`Server configuration validation failed:\n${errorMessage}`);
    }

    // Update in-memory configuration
    this.config.servers[serverId] = validation.config as MCPServerConfig;

    // Save to file
    await this.saveConfig();

    // Emit events
    const event: MCPConfigChangeEvent = {
      type: isNew ? 'server_added' : 'server_updated',
      serverId,
      previousConfig,
      newConfig: this.config.servers[serverId],
      timestamp: new Date(),
      source: 'api',
    };
    this.emit('config-changed', event);
    
    if (isNew) {
      this.emit('server-added', serverId, this.config.servers[serverId]);
    } else {
      this.emit('server-updated', serverId, this.config.servers[serverId], previousConfig);
    }

    logger().info(`Server configuration ${isNew ? 'added' : 'updated'}`, { serverId });
  }

  /**
   * Remove server configuration
   */
  async removeServer(serverId: string): Promise<void> {
    if (!this.config) {
      throw new Error('Configuration not loaded');
    }

    const previousConfig = this.config.servers[serverId];
    if (!previousConfig) {
      throw new Error(`Server '${serverId}' not found`);
    }

    // Remove from configuration
    delete this.config.servers[serverId];

    // Save to file
    await this.saveConfig();

    // Emit events
    const event: MCPConfigChangeEvent = {
      type: 'server_removed',
      serverId,
      previousConfig,
      timestamp: new Date(),
      source: 'api',
    };
    this.emit('config-changed', event);
    this.emit('server-removed', serverId);

    logger().info('Server configuration removed', { serverId });
  }

  /**
   * Save current configuration to file
   */
  private async saveConfig(): Promise<void> {
    if (!this.config) {
      throw new Error('No configuration to save');
    }

    // Update statistics
    this.config.stats.lastSuccess = new Date();

    // Create backup
    const backupPath = `${this.configPath}.backup`;
    try {
      await fs.copyFile(this.configPath, backupPath);
    } catch (error) {
      logger().warn('Failed to create configuration backup', { error });
    }

    // Write configuration
    await fs.writeFile(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8');
    this.lastModified = new Date();

    logger().debug('Configuration saved to file', { path: this.configPath });
  }

  /**
   * Reload configuration from file
   */
  async reloadConfig(): Promise<EnhancedMCPConfig> {
    logger().info('Manually reloading configuration');
    return await this.loadConfig();
  }

  /**
   * Validate current configuration
   */
  validateConfiguration(): MCPConfigValidationResult {
    if (!this.config) {
      return {
        valid: false,
        errors: [{ path: 'root', message: 'Configuration not loaded', code: 'not_loaded' }],
        warnings: [],
      };
    }

    return validateEnhancedMCPConfig(this.config);
  }

  /**
   * Get configuration statistics
   */
  getStats(): {
    lastModified: Date | null;
    serverCount: number;
    enabledServerCount: number;
    configPath: string;
    isWatching: boolean;
  } {
    return {
      lastModified: this.lastModified,
      serverCount: this.config ? Object.keys(this.config.servers).length : 0,
      enabledServerCount: this.config ? Object.values(this.config.servers).filter(s => s.enabled).length : 0,
      configPath: this.configPath,
      isWatching: this.watcher !== null,
    };
  }

  /**
   * Stop configuration manager and cleanup resources
   */
  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }

    if (this.reloadTimeout) {
      clearTimeout(this.reloadTimeout);
      this.reloadTimeout = null;
    }

    this.removeAllListeners();
    logger().info('MCP Configuration Manager stopped');
  }

  // Type-safe event emitter methods
  on<K extends keyof MCPConfigManagerEvents>(event: K, listener: MCPConfigManagerEvents[K]): this {
    return super.on(event, listener);
  }

  emit<K extends keyof MCPConfigManagerEvents>(event: K, ...args: Parameters<MCPConfigManagerEvents[K]>): boolean {
    return super.emit(event, ...args);
  }
}