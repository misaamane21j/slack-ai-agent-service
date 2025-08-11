# Slack AI Agent Service - Generic MCP Tool Integration Refactor Plan

## 🎯 Goals
1. **Tool-agnostic AI agent** that can work with any MCP server
2. **Dynamic tool discovery** from connected MCP servers  
3. **Intent-based tool selection** by AI
4. **Generic fallback responses** when no tools match
5. **Configuration-driven** MCP server management

## 📋 Refactor Plan

### Phase 1: New Architecture Components

#### 1.1 Enhanced AI Response Interface
```typescript
// src/types/ai-agent.ts
export interface AIAgentResponse {
  intent: 'tool_invocation' | 'clarification_needed' | 'general_conversation';
  confidence: number;
  tool?: {
    serverId: string;      // 'jenkins', 'github', 'database'
    toolName: string;      // 'trigger_jenkins_job', 'create_issue'
    parameters: Record<string, any>;
  };
  message?: string;        // Response when no tool needed
  reasoning?: string;      // Why this tool was chosen
}
```

#### 1.2 MCP Registry System
```typescript
// src/services/mcp-registry.ts
export interface MCPServerConfig {
  id: string;
  name: string;
  description: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  enabled: boolean;
}

export class MCPRegistryService {
  private servers: Map<string, MCPServerConfig>;
  private clients: Map<string, MCPClientWrapper>;
  
  loadFromConfig(mcpConfig: MCPConfig): void
  discoverTools(): Promise<ToolDefinition[]>
  getServer(serverId: string): MCPServerConfig
  invoketool(serverId: string, toolName: string, params: any): Promise<any>
}
```

#### 1.3 Generic MCP Client Wrapper
```typescript
// src/services/mcp-client-wrapper.ts
export class MCPClientWrapper {
  private client: Client;
  private transport: StdioClientTransport;
  
  async connect(config: MCPServerConfig): Promise<void>
  async discoverTools(): Promise<ToolDefinition[]>
  async invokeTool(toolName: string, parameters: any): Promise<any>
  async disconnect(): Promise<void>
}
```

#### 1.4 Enhanced AI Processor
```typescript
// src/services/ai-agent-processor.ts
export class AIAgentProcessorService {
  constructor(
    private mcpRegistry: MCPRegistryService,
    private anthropic: Anthropic
  ) {}
  
  async processMessage(message: string, context: string[]): Promise<AIAgentResponse>
  private async analyzeIntent(message: string, availableTools: ToolDefinition[]): Promise<AIAgentResponse>
  private buildToolSelectionPrompt(message: string, tools: ToolDefinition[]): string
}
```

### Phase 2: Configuration System

#### 2.1 MCP Configuration File
```json
// src/config/mcp-servers.json
{
  "servers": {
    "jenkins": {
      "id": "jenkins", 
      "name": "Jenkins CI/CD",
      "description": "Manage Jenkins jobs and builds",
      "command": "node",
      "args": ["../jenkins-mcp-server/dist/index.js"],
      "env": {
        "JENKINS_URL": "${JENKINS_URL}",
        "JENKINS_USERNAME": "${JENKINS_USERNAME}",
        "JENKINS_API_TOKEN": "${JENKINS_API_TOKEN}"
      },
      "enabled": true
    },
    "github": {
      "id": "github",
      "name": "GitHub Integration", 
      "description": "Manage GitHub repositories and issues",
      "command": "docker",
      "args": ["run", "-i", "--rm", "ghcr.io/github/github-mcp-server"],
      "env": {
        "GITHUB_TOKEN": "${GITHUB_TOKEN}"
      },
      "enabled": false
    }
  }
}
```

#### 2.2 Updated Environment Configuration
```typescript
// src/config/interfaces.ts
export interface EnvironmentConfig {
  // ... existing config ...
  mcp: {
    configFile: string;           // Path to mcp-servers.json
    connectionTimeout: number;    // Connection timeout per server
    maxConcurrentConnections: number;
  };
}
```

### Phase 3: AI Processing Logic

#### 3.1 Enhanced AI Prompts
```typescript
// src/prompts/tool-selection.ts
export const TOOL_SELECTION_PROMPT = `
You are an AI agent that can invoke various tools to help users.

Available Tools:
{{AVAILABLE_TOOLS}}

User Message: {{USER_MESSAGE}}
Context: {{CONTEXT}}

Analyze the user's intent and respond with JSON:

If the message requires a specific tool:
{
  "intent": "tool_invocation",
  "confidence": 0.9,
  "tool": {
    "serverId": "jenkins",
    "toolName": "trigger_jenkins_job", 
    "parameters": {"jobName": "deploy-app", "version": "1.2.3"}
  },
  "reasoning": "User wants to deploy an application"
}

If the message is unclear or doesn't match any tools:
{
  "intent": "clarification_needed",
  "confidence": 0.8,
  "message": "I can help you with Jenkins builds, GitHub issues, or database queries. What specifically would you like to do?",
  "reasoning": "User request is too general"
}

If the message is general conversation:
{
  "intent": "general_conversation", 
  "confidence": 0.7,
  "message": "Hello! I'm here to help you with various automation tasks.",
  "reasoning": "Greeting or general conversation"
}
`;
```

### Phase 4: Updated Slack Bot Service

#### 4.1 Refactored Message Handler
```typescript
// src/services/slack-bot.ts
export class SlackBotService {
  constructor(
    private app: App,
    private aiProcessor: AIAgentProcessorService,
    private mcpRegistry: MCPRegistryService,
    private notificationService: NotificationService
  ) {}

  private async handleAppMention(event: SlackEvent): Promise<void> {
    // 1. Add thinking reaction
    await this.addReaction(event, 'thinking_face');
    
    // 2. Get thread context
    const context = await this.getThreadContext(event);
    
    // 3. Process with AI (now tool-agnostic)
    const aiResponse = await this.aiProcessor.processMessage(
      event.slackEvent.text, 
      context
    );
    
    // 4. Handle based on intent
    switch (aiResponse.intent) {
      case 'tool_invocation':
        await this.handleToolInvocation(event, aiResponse);
        break;
      case 'clarification_needed':
      case 'general_conversation':
        await this.handleDirectResponse(event, aiResponse);
        break;
    }
  }
  
  private async handleToolInvocation(event: SlackEvent, response: AIAgentResponse): Promise<void> {
    try {
      // Security validation
      const validation = await this.validateToolInvocation(response.tool);
      if (!validation.valid) {
        await this.sendMessage(event, `Security validation failed: ${validation.errors.join(', ')}`);
        return;
      }
      
      // Invoke tool via registry
      const result = await this.mcpRegistry.invokeToolSafely(
        response.tool.serverId,
        response.tool.toolName, 
        response.tool.parameters
      );
      
      // Send result to user
      await this.sendToolResult(event, response.tool, result);
      
    } catch (error) {
      await this.handleToolError(event, response.tool, error);
    }
  }
}
```

### Phase 5: Implementation Steps

#### Step 1: Create New Interfaces and Types
- [ ] Create `src/types/ai-agent.ts`
- [ ] Update `src/types/mcp.ts` with generic definitions
- [ ] Create `src/types/tool-definition.ts`

#### Step 2: Implement MCP Registry System  
- [ ] Create `src/services/mcp-registry.ts`
- [ ] Create `src/services/mcp-client-wrapper.ts`
- [ ] Update `src/config/environment.ts` for MCP config

#### Step 3: Refactor AI Processor
- [ ] Rename `ai-processor.ts` → `ai-agent-processor.ts`
- [ ] Implement tool discovery and selection logic
- [ ] Create prompt templates for tool selection
- [ ] Add JSON extraction with fallback parsing

#### Step 4: Update Slack Bot Service
- [ ] Refactor `handleAppMention` for generic tool handling
- [ ] Add tool validation and security checks
- [ ] Implement generic response formatting
- [ ] Add error handling for failed tool invocations

#### Step 5: Configuration and Testing
- [ ] Create `src/config/mcp-servers.json` template
- [ ] Update environment validation
- [ ] Add comprehensive logging for tool discovery/invocation
- [ ] Create tests for each component

#### Step 6: Network Security Implementation
- [ ] Implement IP whitelisting middleware (`src/middleware/ip-whitelist.ts`)
- [ ] Add security configuration interface and validation
- [ ] Implement rate limiting for connection protection  
- [ ] Add TLS/encryption enforcement options
- [ ] Create firewall configuration documentation
- [ ] Add security event logging and monitoring
- [ ] Implement CIDR range validation utilities
- [ ] Create security testing suite for IP filtering

### Phase 6: Network Security and IP Whitelisting

#### 6.1 IP Whitelisting Implementation
```typescript
// src/middleware/ip-whitelist.ts
export class IPWhitelistMiddleware {
  private allowedIPs: Set<string>;
  private allowedCIDRs: string[];
  
  constructor(config: SecurityConfig) {
    this.allowedIPs = new Set(config.ipWhitelist.allowedIPs);
    this.allowedCIDRs = config.ipWhitelist.allowedCIDRs;
  }
  
  validateConnection(req: any): boolean {
    const clientIP = this.getClientIP(req);
    return this.isIPAllowed(clientIP);
  }
  
  private isIPAllowed(ip: string): boolean {
    // Check explicit IP whitelist
    if (this.allowedIPs.has(ip)) return true;
    
    // Check CIDR ranges
    return this.allowedCIDRs.some(cidr => this.isIPInCIDR(ip, cidr));
  }
}
```

#### 6.2 Enhanced Security Configuration
```typescript
// src/config/interfaces.ts - Updated SecurityConfig
export interface SecurityConfig {
  ipWhitelist: {
    enabled: boolean;
    allowedIPs: string[];        // Explicit IP addresses
    allowedCIDRs: string[];      // CIDR ranges (10.0.0.0/8)
    blockUnknown: boolean;       // Block non-whitelisted IPs
    logBlocked: boolean;         // Log blocked attempts
  };
  rateLimit: {
    enabled: boolean;
    windowMs: number;            // Rate limit window
    maxRequests: number;         // Max requests per window
    skipWhitelisted: boolean;    // Skip rate limit for whitelisted IPs
  };
  encryption: {
    requireTLS: boolean;         // Force HTTPS/WSS
    minTLSVersion: string;       // Minimum TLS version
  };
  firewall: {
    enableApplicationLevel: boolean;  // App-level IP filtering
    enableNetworkLevel: boolean;      // Firewall rule suggestions
    enableReverseProxy: boolean;      // Nginx/proxy configuration
  };
}
```

#### 6.3 Environment Variables for Security
```bash
# IP Security Configuration
IP_WHITELIST_ENABLED=true
ALLOWED_IPS=52.1.1.1,54.2.2.2,3.3.3.3
ALLOWED_CIDRS=10.0.0.0/8,192.168.0.0/16,172.16.0.0/12
BLOCK_UNKNOWN_IPS=true
LOG_BLOCKED_ATTEMPTS=true

# Rate Limiting
RATE_LIMIT_ENABLED=true
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100
RATE_LIMIT_SKIP_WHITELISTED=true

# TLS/Encryption
REQUIRE_TLS=true
MIN_TLS_VERSION=1.2

# Firewall Options
ENABLE_APP_LEVEL_FILTERING=true
ENABLE_NETWORK_LEVEL_FILTERING=false
ENABLE_REVERSE_PROXY=false
```

#### 6.4 Multi-Layer Security Architecture
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Slack User    │    │  Slack Servers  │    │  Our Network    │
│                 │───▶│  (WebSocket)    │───▶│   Firewall      │
│ @bot command    │    │  Socket Mode    │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                                        │
                                                        ▼
                               ┌─────────────────────────────────┐
                               │     REVERSE PROXY (Optional)    │
                               │     • Nginx with IP filtering   │
                               │     • SSL termination          │
                               │     • Rate limiting            │
                               └─────────────────────────────────┘
                                                        │
                                                        ▼
                               ┌─────────────────────────────────┐
                               │     SLACK AI AGENT SERVICE     │
                               │     • Application-level IP     │
                               │       filtering middleware     │
                               │     • Connection validation    │
                               │     • Security logging         │
                               └─────────────────────────────────┘
```

#### 6.5 Security Implementation Priority
1. **Network Firewall** (Highest priority - blocks at network level)
2. **Application IP Filtering** (High priority - validates connections)
3. **Rate Limiting** (Medium priority - prevents abuse)
4. **TLS Enforcement** (Medium priority - encrypts traffic)
5. **Reverse Proxy** (Low priority - additional layer)


## 🎯 Benefits of This Refactor

1. **🔧 Tool Agnostic** - Works with any MCP server
2. **🚀 Scalable** - Easy to add new tools via configuration  
3. **🛡️ Secure** - Centralized validation, IP whitelisting, and multi-layer security
4. **🧠 Intelligent** - AI chooses appropriate tools based on context
5. **💬 User Friendly** - Clear responses when tools aren't needed
6. **📊 Observable** - Comprehensive logging for debugging
7. **🔒 Network Secure** - IP whitelisting, rate limiting, and firewall integration
8. **🌐 Enterprise Ready** - Multi-layer security suitable for corporate environments
9. **🔍 Monitoring** - Security event logging and blocked connection tracking
10. **⚡ Performance** - Efficient IP validation with CIDR support

## 🚧 Implementation Priority

**High Priority:** Steps 1-3 (Core architecture)
**Medium Priority:** Steps 4-5 (Integration and testing)  
**Medium Priority:** Step 6 (Network security and IP whitelisting)

**Note:** Migration strategy removed - this is a new application with no production users, so we can implement the generic MCP architecture directly without backward compatibility concerns.

## 📋 TaskMaster Integration

This plan will be broken down into TaskMaster tasks and subtasks for implementation tracking and progress monitoring.

## 🏗️ Updated Architecture Diagram

See `architecture-diagram.md` for the updated system architecture reflecting these changes.