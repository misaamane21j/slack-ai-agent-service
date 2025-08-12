/**
 * Resilience Patterns Export Module
 * Central export for all resilience and recovery patterns
 */

// Circuit Breaker Pattern
export {
  CircuitBreaker,
  CircuitBreakerManager,
  CircuitState,
  type CircuitBreakerConfig,
  type CircuitBreakerResult,
  type CallRecord
} from './CircuitBreaker';

// Fallback Chain System
export {
  FallbackChain,
  FallbackLevel,
  type FallbackStep,
  type FallbackChainConfig,
  type FallbackResult,
  type ToolCapability
} from './FallbackChain';

// Graceful Degradation
export {
  GracefulDegradationManager,
  DegradationLevel,
  type DegradationStrategy,
  type DegradationTrigger,
  type FeatureConfig,
  type DegradationResult
} from './GracefulDegradation';

// Exponential Backoff with Jitter
export {
  ExponentialBackoffManager,
  BackoffStrategy,
  JitterType,
  type BackoffConfig,
  type BackoffResult,
  type AdaptiveAdjustment,
  type RetryContext
} from './ExponentialBackoff';

// Timeout Management with Resource Cleanup
export {
  TimeoutManager,
  type TimeoutConfig,
  type TimeoutResult,
  type ResourceHandle,
  type ActiveOperation
} from './TimeoutManager';

// Resilience Orchestrator
export {
  ResilienceOrchestrator,
  type ResilienceConfig,
  type ResilienceResult,
  type OperationDefinition,
  type ResilienceMetrics,
  type ExecutionStep
} from './ResilienceOrchestrator';

// Integrated Resilience Boundary
export {
  ResilienceBoundary,
  type ResilienceBoundaryConfig,
  type ResilienceBoundaryResult
} from './ResilienceBoundary';

// Re-export key types from Error Boundary for convenience
export {
  BoundaryType,
  BoundaryState,
  type BoundaryResult,
  type BoundaryConfig,
  type BoundaryMetrics
} from '../boundaries/ErrorBoundary';

// Re-export Enhanced Error Context for convenience
export {
  EnhancedErrorContext,
  type ErrorScope,
  type OperationType
} from '../context/ErrorContext';