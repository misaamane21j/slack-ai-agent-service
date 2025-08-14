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