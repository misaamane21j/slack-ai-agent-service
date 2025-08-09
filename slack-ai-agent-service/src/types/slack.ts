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