/**
 * Error handling types and interfaces for the Slack AI Agent Service
 */

export enum ErrorSeverity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL'
}

export interface ErrorContext {
  timestamp: Date;
  operation: string;
  userId?: string;
  toolName?: string;
  serverId?: string;
  severity: ErrorSeverity;
  additionalContext?: Record<string, unknown>;
}

export interface RecoverySuggestion {
  action: string;
  description: string;
  automated: boolean;
}

export interface ErrorMetadata {
  errorId: string;
  correlationId?: string;
  userAgent?: string;
  requestId?: string;
  sessionId?: string;
}

export enum ErrorCategory {
  MCP_TOOL = 'MCP_TOOL',
  AI_PROCESSING = 'AI_PROCESSING',
  CONFIGURATION = 'CONFIGURATION',
  DEPENDENCY_INJECTION = 'DEPENDENCY_INJECTION',
  SECURITY = 'SECURITY',
  NETWORK = 'NETWORK',
  VALIDATION = 'VALIDATION'
}