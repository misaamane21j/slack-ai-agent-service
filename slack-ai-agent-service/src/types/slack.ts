export interface SlackEvent {
  type: string;
  channel: string;
  user: string;
  text: string;
  ts: string;
  thread_ts?: string;
}

export interface SlackMessage {
  channel: string;
  text: string;
  thread_ts?: string;
  user?: string;
}

export interface SlackThreadContext {
  messages: SlackMessage[];
  participants: string[];
}

export interface ThreadContextFilterOptions {
  maxMessages?: number;
  timeWindowHours?: number;
  excludeSystemMessages?: boolean;
  excludeBotMessages?: boolean;
  includeReactions?: boolean;
  relevanceScoring?: boolean;
  prioritizeRecentMessages?: boolean;
  prioritizeUserMentions?: boolean;
}

export interface FilteredMessage {
  originalMessage: any;
  relevanceScore: number;
  messageType: 'user' | 'bot' | 'system';
  timestamp: Date;
  hasUserMentions: boolean;
  hasReactions: boolean;
  isThreadReply: boolean;
}

export interface RateLimitInfo {
  isLimited: boolean;
  currentRequests: number;
  maxRequests: number;
  resetTimeSeconds: number;
  resetTime: Date;
}

export interface UserActivityMetrics {
  userId: string;
  requestCount: number;
  lastRequestTime: Date;
  averageInterval: number;
  suspiciousScore: number;
  isBlocked: boolean;
  blockReason?: string;
  blockExpiresAt?: Date;
}

export interface ActivityAlert {
  userId: string;
  alertType: 'rapid_requests' | 'unusual_volume' | 'bot_behavior' | 'pattern_anomaly';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  details: any;
  timestamp: Date;
  acknowledged: boolean;
}