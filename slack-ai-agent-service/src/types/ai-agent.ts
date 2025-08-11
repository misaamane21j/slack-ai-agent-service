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

export interface ToolDefinition {
  serverId: string;
  name: string;
  description: string;
  inputSchema: Record<string, any>;
  outputSchema?: Record<string, any>;
}

export interface ToolInvocationResult {
  success: boolean;
  data?: any;
  error?: string;
  executionTime?: number;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  sanitized?: Record<string, any>;
}