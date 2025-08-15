// Test utilities and helper functions
import { jest } from '@jest/globals';
import { setTestEnvironment, clearTestEnvironment } from '../__mocks__/environment';

// Timer management for async tests
export class TestTimers {
  private originalSetTimeout: typeof setTimeout;
  private originalClearTimeout: typeof clearTimeout;
  private originalSetInterval: typeof setInterval;
  private originalClearInterval: typeof clearInterval;

  constructor() {
    this.originalSetTimeout = global.setTimeout;
    this.originalClearTimeout = global.clearTimeout;
    this.originalSetInterval = global.setInterval;
    this.originalClearInterval = global.clearInterval;
  }

  useFakeTimers() {
    jest.useFakeTimers();
  }

  useRealTimers() {
    jest.useRealTimers();
  }

  async advanceTimersByTime(ms: number) {
    jest.advanceTimersByTime(ms);
    await Promise.resolve(); // Allow promises to resolve
  }

  runAllTimers() {
    jest.runAllTimers();
  }

  runOnlyPendingTimers() {
    jest.runOnlyPendingTimers();
  }
}

// Environment management for tests
export class TestEnvironment {
  private originalEnv: Record<string, string | undefined>;

  constructor() {
    this.originalEnv = { ...process.env };
  }

  setEnvironment(envVars: Record<string, string>) {
    setTestEnvironment(envVars);
  }

  clearEnvironment() {
    clearTestEnvironment();
  }

  restoreEnvironment() {
    // Clear current environment
    Object.keys(process.env).forEach(key => {
      if (!this.originalEnv.hasOwnProperty(key)) {
        delete process.env[key];
      }
    });

    // Restore original environment
    Object.entries(this.originalEnv).forEach(([key, value]) => {
      if (value !== undefined) {
        process.env[key] = value;
      } else {
        delete process.env[key];
      }
    });
  }
}

// Mock manager for cleaning up mocks between tests
export class MockManager {
  private mocks: jest.MockedFunction<any>[] = [];

  addMock(mockFn: jest.MockedFunction<any>) {
    this.mocks.push(mockFn);
    return mockFn;
  }

  clearAllMocks() {
    this.mocks.forEach(mock => {
      if (typeof mock.mockClear === 'function') {
        mock.mockClear();
      }
    });
  }

  resetAllMocks() {
    this.mocks.forEach(mock => {
      if (typeof mock.mockReset === 'function') {
        mock.mockReset();
      }
    });
  }

  restoreAllMocks() {
    this.mocks.forEach(mock => {
      if (typeof mock.mockRestore === 'function') {
        mock.mockRestore();
      }
    });
    this.mocks = [];
  }
}

// Async test utilities
export class AsyncTestHelper {
  static async waitFor(
    condition: () => boolean | Promise<boolean>,
    timeout: number = 5000,
    interval: number = 100
  ): Promise<void> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      const result = await condition();
      if (result) {
        return;
      }
      await new Promise(resolve => setTimeout(resolve, interval));
    }
    
    throw new Error(`Condition not met within ${timeout}ms`);
  }

  static async waitForNextTick(): Promise<void> {
    return new Promise(resolve => process.nextTick(resolve));
  }

  static async waitForTimeout(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  static createTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => 
        setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs)
      )
    ]);
  }
}

// Error testing utilities
export class ErrorTestHelper {
  static async expectAsyncError(
    fn: () => Promise<any>,
    errorMatcher?: string | RegExp | Error | Function
  ): Promise<void> {
    try {
      await fn();
      throw new Error('Expected function to throw an error');
    } catch (error: any) {
      if (errorMatcher) {
        if (typeof errorMatcher === 'string') {
          expect(error.message).toContain(errorMatcher);
        } else if (errorMatcher instanceof RegExp) {
          expect(error.message).toMatch(errorMatcher);
        } else if (errorMatcher instanceof Error) {
          expect(error.message).toBe(errorMatcher.message);
        } else {
          expect(error).toBeInstanceOf(errorMatcher);
        }
      }
    }
  }

  static createMockError(message: string, code?: string): Error {
    const error = new Error(message);
    if (code) {
      (error as any).code = code;
    }
    return error;
  }
}

// Test data factories
export class TestDataFactory {
  private static idCounter = 1;

  static getUniqueId(): string {
    return `test_${Date.now()}_${this.idCounter++}`;
  }

  static createRandomString(length: number = 10): string {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  static createTimestamp(): string {
    return (Date.now() / 1000).toFixed(6);
  }
}

// Setup and teardown helpers
export function createTestSuite(name: string) {
  return {
    timers: new TestTimers(),
    environment: new TestEnvironment(),
    mocks: new MockManager(),
    
    setup() {
      // Common setup logic
      this.mocks.clearAllMocks();
    },
    
    teardown() {
      // Common teardown logic
      this.timers.useRealTimers();
      this.environment.restoreEnvironment();
      this.mocks.restoreAllMocks();
    }
  };
}