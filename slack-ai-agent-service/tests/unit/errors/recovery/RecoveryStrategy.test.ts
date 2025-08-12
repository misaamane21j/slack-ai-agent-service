/**
 * Unit tests for Recovery Strategy system
 */

import {
  RecoveryStrategy,
  RetryStrategy,
  FallbackStrategy,
  CircuitBreakerStrategy,
  RecoveryStrategyManager,
  RecoveryStrategyType,
  RecoveryResult,
  RecoveryContext
} from '../../../../src/errors/recovery/RecoveryStrategy';
import {
  EnhancedErrorContext,
  ErrorContextBuilder,
  OperationPhase,
  ProcessingStage
} from '../../../../src/errors/context/ErrorContext';
import { ErrorSeverity } from '../../../../src/errors/types';

// Mock timer functions for testing
jest.useFakeTimers();

describe('RetryStrategy', () => {
  let retryStrategy: RetryStrategy;
  let mockContext: RecoveryContext;

  beforeEach(() => {
    retryStrategy = new RetryStrategy(100, 5000, 0.1); // 100ms base, 5s max, 10% jitter
    
    const errorContext: EnhancedErrorContext = ErrorContextBuilder.create()
      .withSeverity(ErrorSeverity.MEDIUM)
      .withOperation('test_operation', OperationPhase.TOOL_INVOCATION)
      .withExecutionState(ProcessingStage.TOOL_EXECUTION)
      .build();

    mockContext = {
      originalError: new Error('Test error'),
      errorContext,
      attempts: [],
      maxAttempts: 3,
      timeoutMs: 30000
    };
  });

  describe('canHandle', () => {
    it('should return true for retryable operation phases', () => {
      expect(retryStrategy.canHandle(mockContext)).toBe(true);
    });

    it('should return true for retryable processing stages', () => {
      mockContext.errorContext.executionState.processingStage = ProcessingStage.AI_PROCESSING;
      expect(retryStrategy.canHandle(mockContext)).toBe(true);
    });

    it('should return false for non-retryable phases', () => {
      mockContext.errorContext.operation!.phase = OperationPhase.CLEANUP;
      mockContext.errorContext.executionState.processingStage = ProcessingStage.COMPLETED;
      
      expect(retryStrategy.canHandle(mockContext)).toBe(false);
    });
  });

  describe('shouldAttempt', () => {
    it('should return true when no previous attempts', () => {
      expect(retryStrategy.shouldAttempt(mockContext)).toBe(true);
    });

    it('should return false when max attempts exceeded', () => {
      // Add attempts equal to max for MEDIUM severity (3 attempts)
      for (let i = 0; i < 3; i++) {
        mockContext.attempts.push({
          strategyType: RecoveryStrategyType.RETRY,
          timestamp: new Date(),
          result: RecoveryResult.FAILED
        });
      }

      expect(retryStrategy.shouldAttempt(mockContext)).toBe(false);
    });

    it('should adjust max attempts based on severity', () => {
      mockContext.errorContext.severity = ErrorSeverity.CRITICAL;
      
      // Should allow only 1 attempt for CRITICAL
      mockContext.attempts.push({
        strategyType: RecoveryStrategyType.RETRY,
        timestamp: new Date(),
        result: RecoveryResult.FAILED
      });

      expect(retryStrategy.shouldAttempt(mockContext)).toBe(false);
    });
  });

  describe('execute', () => {
    it('should record attempt and return result', async () => {
      // Mock Math.random to ensure predictable "success"
      jest.spyOn(Math, 'random').mockReturnValue(0.8); // > 0.3, so success

      // Since we're using fake timers, we need to advance them during the promise
      const resultPromise = retryStrategy.execute(mockContext);
      
      // Advance timers to handle any delays
      await jest.runAllTimersAsync();
      
      const result = await resultPromise;

      expect(result).toBe(RecoveryResult.SUCCESS);
      expect(mockContext.attempts).toHaveLength(1);
      expect(mockContext.attempts[0].strategyType).toBe(RecoveryStrategyType.RETRY);
      expect(mockContext.attempts[0].result).toBe(RecoveryResult.SUCCESS);

      (Math.random as jest.Mock).mockRestore();
    });

    it('should fail when max attempts exceeded', async () => {
      // Fill up attempts to max
      for (let i = 0; i < 3; i++) {
        mockContext.attempts.push({
          strategyType: RecoveryStrategyType.RETRY,
          timestamp: new Date(),
          result: RecoveryResult.FAILED
        });
      }

      const result = await retryStrategy.execute(mockContext);

      expect(result).toBe(RecoveryResult.FAILED);
    });

    it('should calculate exponential backoff delay', () => {
      const delay0 = retryStrategy['calculateDelay'](0);
      const delay1 = retryStrategy['calculateDelay'](1);
      const delay2 = retryStrategy['calculateDelay'](2);

      expect(delay1).toBeGreaterThan(delay0);
      expect(delay2).toBeGreaterThan(delay1);
      expect(delay2).toBeLessThanOrEqual(5000); // Max delay
    });
  });

  describe('estimateRecoveryTime', () => {
    it('should estimate time based on attempt count', () => {
      mockContext.attempts = [
        {
          strategyType: RecoveryStrategyType.RETRY,
          timestamp: new Date(),
          result: RecoveryResult.FAILED
        }
      ];

      const estimatedTime = retryStrategy.estimateRecoveryTime(mockContext);
      expect(estimatedTime).toBeGreaterThan(100); // Should be > base delay
    });
  });

  describe('getPriority', () => {
    it('should decrease priority with more attempts', () => {
      const initialPriority = retryStrategy.getPriority(mockContext);
      
      mockContext.attempts.push({
        strategyType: RecoveryStrategyType.RETRY,
        timestamp: new Date(),
        result: RecoveryResult.FAILED
      });
      
      const laterPriority = retryStrategy.getPriority(mockContext);
      expect(laterPriority).toBeLessThan(initialPriority);
    });
  });
});

describe('FallbackStrategy', () => {
  let fallbackStrategy: FallbackStrategy;
  let mockContext: RecoveryContext;

  beforeEach(() => {
    const fallbackMap = new Map([
      ['jenkins_trigger_job', ['jenkins_manual_build', 'notification_only']],
      ['github_create_issue', ['email_notification', 'slack_reminder']]
    ]);
    
    fallbackStrategy = new FallbackStrategy(fallbackMap);

    const errorContext: EnhancedErrorContext = ErrorContextBuilder.create()
      .withTool('jenkins', 'jenkins_trigger_job')
      .build();

    mockContext = {
      originalError: new Error('Test error'),
      errorContext,
      attempts: [],
      maxAttempts: 3,
      timeoutMs: 30000
    };
  });

  describe('canHandle', () => {
    it('should return true when fallback options exist for tool', () => {
      expect(fallbackStrategy.canHandle(mockContext)).toBe(true);
    });

    it('should return true when user intent has fallback options', () => {
      mockContext.errorContext.tool = undefined;
      mockContext.errorContext.userIntent = {
        originalMessage: 'test',
        parsedIntent: 'test',
        confidence: 0.8,
        conversationId: 'conv123',
        fallbackOptions: ['option1', 'option2']
      };

      expect(fallbackStrategy.canHandle(mockContext)).toBe(true);
    });

    it('should return false when no fallback options available', () => {
      mockContext.errorContext.tool!.toolName = 'unknown_tool';
      expect(fallbackStrategy.canHandle(mockContext)).toBe(false);
    });
  });

  describe('execute', () => {
    it('should succeed with fallback option', async () => {
      // Mock random to ensure success
      jest.spyOn(Math, 'random').mockReturnValue(0.9);

      const result = await fallbackStrategy.execute(mockContext);

      expect(result).toBe(RecoveryResult.SUCCESS);
      expect(mockContext.attempts[0].details).toContain('jenkins_manual_build');

      (Math.random as jest.Mock).mockRestore();
    });

    it('should handle partial success', async () => {
      jest.spyOn(Math, 'random').mockReturnValue(0.1); // < 0.2, so partial success

      const result = await fallbackStrategy.execute(mockContext);

      expect(result).toBe(RecoveryResult.PARTIAL_SUCCESS);

      (Math.random as jest.Mock).mockRestore();
    });
  });

  describe('estimateRecoveryTime', () => {
    it('should return estimated fallback time', () => {
      const estimatedTime = fallbackStrategy.estimateRecoveryTime(mockContext);
      expect(estimatedTime).toBe(5000); // Default 5 seconds
    });
  });
});

describe('CircuitBreakerStrategy', () => {
  let circuitStrategy: CircuitBreakerStrategy;
  let mockContext: RecoveryContext;

  beforeEach(() => {
    circuitStrategy = new CircuitBreakerStrategy(2, 5000); // 2 failures, 5s recovery
    
    const errorContext: EnhancedErrorContext = ErrorContextBuilder.create()
      .withTool('jenkins', 'trigger_job')
      .build();

    mockContext = {
      originalError: new Error('Test error'),
      errorContext,
      attempts: [],
      maxAttempts: 3,
      timeoutMs: 30000
    };
  });

  describe('canHandle', () => {
    it('should return true when tool is defined', () => {
      expect(circuitStrategy.canHandle(mockContext)).toBe(true);
    });

    it('should return false when no tool defined', () => {
      mockContext.errorContext.tool = undefined;
      expect(circuitStrategy.canHandle(mockContext)).toBe(false);
    });
  });

  describe('execute', () => {
    it('should record failure in CLOSED state', async () => {
      const result = await circuitStrategy.execute(mockContext);

      expect(result).toBe(RecoveryResult.PARTIAL_SUCCESS);
      expect(mockContext.attempts[0].details).toContain('failure 1/2');
    });

    it('should open circuit after threshold failures', async () => {
      // Execute twice to reach threshold
      await circuitStrategy.execute(mockContext);
      mockContext.attempts = []; // Clear for clean test
      
      const result = await circuitStrategy.execute(mockContext);

      expect(result).toBe(RecoveryResult.NEEDS_ESCALATION);
      expect(mockContext.attempts[0].details).toContain('Circuit breaker opened');
    });

    it('should remain open during recovery period', async () => {
      // Open the circuit first
      await circuitStrategy.execute(mockContext);
      await circuitStrategy.execute(mockContext);
      mockContext.attempts = [];

      const result = await circuitStrategy.execute(mockContext);

      expect(result).toBe(RecoveryResult.FAILED);
      expect(mockContext.attempts[0].details).toContain('Circuit breaker open');
    });
  });

  describe('estimateRecoveryTime', () => {
    it('should return remaining recovery time for open circuit', async () => {
      // Open the circuit
      await circuitStrategy.execute(mockContext);
      await circuitStrategy.execute(mockContext);

      const estimatedTime = circuitStrategy.estimateRecoveryTime(mockContext);
      expect(estimatedTime).toBeGreaterThan(0);
      expect(estimatedTime).toBeLessThanOrEqual(5000);
    });
  });
});

describe('RecoveryStrategyManager', () => {
  let manager: RecoveryStrategyManager;
  let mockContext: RecoveryContext;

  beforeEach(() => {
    manager = new RecoveryStrategyManager();
    
    const errorContext: EnhancedErrorContext = ErrorContextBuilder.create()
      .withSeverity(ErrorSeverity.MEDIUM)
      .withOperation('test_op', OperationPhase.TOOL_INVOCATION)
      .withTool('jenkins', 'trigger_job')
      .withExecutionState(ProcessingStage.TOOL_EXECUTION)
      .build();

    mockContext = {
      originalError: new Error('Test error'),
      errorContext,
      attempts: [],
      maxAttempts: 3,
      timeoutMs: 30000
    };
  });

  describe('getApplicableStrategies', () => {
    it('should return strategies that can handle the context', () => {
      const strategies = manager.getApplicableStrategies(mockContext);
      
      expect(strategies.length).toBeGreaterThan(0);
      expect(strategies.every(s => s.canHandle(mockContext))).toBe(true);
    });

    it('should sort strategies by priority', () => {
      const strategies = manager.getApplicableStrategies(mockContext);
      
      for (let i = 1; i < strategies.length; i++) {
        const prevPriority = strategies[i - 1].getPriority(mockContext);
        const currentPriority = strategies[i].getPriority(mockContext);
        expect(prevPriority).toBeGreaterThanOrEqual(currentPriority);
      }
    });

    it('should filter out strategies that should not attempt', () => {
      // Add max attempts for retry strategy
      for (let i = 0; i < 3; i++) {
        mockContext.attempts.push({
          strategyType: RecoveryStrategyType.RETRY,
          timestamp: new Date(),
          result: RecoveryResult.FAILED
        });
      }

      const strategies = manager.getApplicableStrategies(mockContext);
      const retryStrategies = strategies.filter(s => s.constructor.name === 'RetryStrategy');
      
      expect(retryStrategies).toHaveLength(0);
    });
  });

  describe('executeRecovery', () => {
    it('should execute highest priority strategy first', async () => {
      // Mock successful recovery
      jest.spyOn(Math, 'random').mockReturnValue(0.8);

      const resultPromise = manager.executeRecovery(mockContext);
      await jest.runAllTimersAsync();
      const result = await resultPromise;

      expect(result).toBe(RecoveryResult.SUCCESS);
      expect(mockContext.attempts.length).toBeGreaterThan(0);

      (Math.random as jest.Mock).mockRestore();
    });

    it('should try multiple strategies if first ones fail', async () => {
      // Mock consistent failure
      jest.spyOn(Math, 'random').mockReturnValue(0.1);

      const resultPromise = manager.executeRecovery(mockContext);
      await jest.runAllTimersAsync();
      const result = await resultPromise;

      expect([
        RecoveryResult.FAILED,
        RecoveryResult.PARTIAL_SUCCESS,
        RecoveryResult.NEEDS_ESCALATION
      ]).toContain(result);
      
      (Math.random as jest.Mock).mockRestore();
    });

    it('should return NEEDS_ESCALATION when no strategies available', async () => {
      // Create context that no strategy can handle
      mockContext.errorContext.tool = undefined;
      mockContext.errorContext.operation!.phase = OperationPhase.CLEANUP;
      mockContext.errorContext.executionState.processingStage = ProcessingStage.COMPLETED;

      const result = await manager.executeRecovery(mockContext);

      expect(result).toBe(RecoveryResult.NEEDS_ESCALATION);
    });
  });

  describe('estimateTotalRecoveryTime', () => {
    it('should sum estimated times from applicable strategies', () => {
      const totalTime = manager.estimateTotalRecoveryTime(mockContext);
      
      expect(totalTime).toBeGreaterThan(0);
      expect(typeof totalTime).toBe('number');
    });
  });

  describe('strategy management', () => {
    it('should allow adding custom strategies', () => {
      class CustomStrategy extends RecoveryStrategy {
        constructor() {
          super(RecoveryStrategyType.ESCALATION, 'Custom', 'Custom strategy');
        }
        
        canHandle(): boolean { return true; }
        async execute(): Promise<RecoveryResult> { return RecoveryResult.SUCCESS; }
        estimateRecoveryTime(): number { return 1000; }
        getPriority(): number { return 10; }
      }

      const customStrategy = new CustomStrategy();
      manager.addStrategy(customStrategy);

      const strategies = manager.getApplicableStrategies(mockContext);
      expect(strategies.some(s => s.constructor.name === 'CustomStrategy')).toBe(true);
    });

    it('should allow removing strategies', () => {
      manager.removeStrategy(RecoveryStrategyType.RETRY);

      const strategies = manager.getApplicableStrategies(mockContext);
      expect(strategies.every(s => s.constructor.name !== 'RetryStrategy')).toBe(true);
    });
  });
});