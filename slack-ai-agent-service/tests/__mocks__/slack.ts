// Mock Slack API responses and events for tests
import { SlackEvent, SlackMessage, SlackUser } from '../../src/types/slack';

export const mockSlackUser: SlackUser = {
  id: 'U123456789',
  name: 'testuser',
  real_name: 'Test User',
  is_bot: false
};

export const mockSlackMessage: SlackMessage = {
  type: 'message',
  channel: 'C123456789',
  user: mockSlackUser.id,
  text: 'Hello <@U987654321> please run the deploy job',
  ts: '1234567890.123456',
  thread_ts: undefined
};

export const mockSlackThreadMessage: SlackMessage = {
  ...mockSlackMessage,
  thread_ts: '1234567890.123456',
  text: 'Follow up message in thread'
};

export const mockSlackEvent: SlackEvent = {
  type: 'app_mention',
  event: mockSlackMessage,
  event_id: 'Ev123456789',
  event_time: 1234567890,
  team_id: 'T123456789'
};

// Mock Slack Web API responses
export const mockConversationRepliesResponse = {
  ok: true,
  messages: [
    mockSlackMessage,
    mockSlackThreadMessage,
    {
      type: 'message',
      channel: 'C123456789',
      user: 'U987654321',
      text: 'Sure, I can help with that deployment',
      ts: '1234567891.123456',
      thread_ts: '1234567890.123456'
    }
  ],
  has_more: false,
  response_metadata: {
    next_cursor: ''
  }
};

export const mockSlackWebClient = {
  conversations: {
    replies: jest.fn().mockResolvedValue(mockConversationRepliesResponse)
  },
  chat: {
    postMessage: jest.fn().mockResolvedValue({
      ok: true,
      ts: '1234567892.123456'
    }),
    postEphemeral: jest.fn().mockResolvedValue({
      ok: true
    })
  },
  users: {
    info: jest.fn().mockResolvedValue({
      ok: true,
      user: mockSlackUser
    })
  }
};

// Mock Slack request signature verification
export const mockSlackRequest = {
  headers: {
    'x-slack-signature': 'v0=test_signature',
    'x-slack-request-timestamp': '1234567890'
  },
  body: JSON.stringify({
    token: 'test_verification_token',
    team_id: 'T123456789',
    event: mockSlackEvent
  }),
  rawBody: Buffer.from('test_raw_body')
};

// Helper functions for creating test data
export function createMockSlackMessage(overrides: Partial<SlackMessage> = {}): SlackMessage {
  return {
    ...mockSlackMessage,
    ...overrides
  };
}

export function createMockSlackEvent(messageOverrides: Partial<SlackMessage> = {}): SlackEvent {
  return {
    ...mockSlackEvent,
    event: createMockSlackMessage(messageOverrides)
  };
}

export function createMockThreadContext(messageCount: number = 3): SlackMessage[] {
  const messages: SlackMessage[] = [mockSlackMessage];
  
  for (let i = 1; i < messageCount; i++) {
    messages.push({
      ...mockSlackMessage,
      text: `Thread message ${i}`,
      ts: `123456789${i}.123456`,
      thread_ts: mockSlackMessage.ts,
      user: i % 2 === 0 ? mockSlackUser.id : 'U987654321'
    });
  }
  
  return messages;
}