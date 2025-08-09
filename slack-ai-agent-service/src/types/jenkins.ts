export interface JenkinsJobRequest {
  jobName: string;
  parameters: Record<string, any>;
  callbackInfo: {
    slackChannel: string;
    slackThreadTs: string;
    slackUserId: string;
  };
  [key: string]: unknown;
}

export interface JenkinsJobResult {
  buildNumber: number;
  jobName: string;
  status: string;
  queueId?: number;
}

export interface JenkinsJobStatus {
  jobName: string;
  buildNumber: number;
  status: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILURE' | 'ABORTED';
  duration?: number;
  timestamp: number;
}