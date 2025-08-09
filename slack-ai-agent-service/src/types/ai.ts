export interface AIResponse {
  jobName: string;
  parameters: Record<string, any>;
  confidence: number;
}

export interface AIProcessingContext {
  message: string;
  threadContext: string[];
  userId: string;
  channel: string;
}