export interface MCPServerConfig {
  id: string;
  name: string;
  description: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  enabled: boolean;
  timeout?: number;
  maxRetries?: number;
}

export interface MCPConfig {
  servers: Record<string, MCPServerConfig>;
}

export interface MCPServerStatus {
  serverId: string;
  connected: boolean;
  lastConnected?: Date;
  lastError?: string;
  toolCount: number;
}

import { ToolDefinition } from './ai-agent';

export interface MCPToolDiscovery {
  serverId: string;
  tools: ToolDefinition[];
  discoveredAt: Date;
}