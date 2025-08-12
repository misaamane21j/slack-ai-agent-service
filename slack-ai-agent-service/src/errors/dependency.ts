import { BaseApplicationError } from './base';
import { ErrorContext, RecoverySuggestion, ErrorCategory, ErrorSeverity } from './types';

/**
 * Dependency injection error for service resolution
 */
export class DependencyInjectionError extends BaseApplicationError {
  public readonly serviceName: string;
  public readonly dependencyName?: string;
  public readonly injectionType: 'constructor' | 'property' | 'method' | 'circular';
  public readonly dependencyChain?: string[];

  constructor(
    message: string,
    serviceName: string,
    injectionType: 'constructor' | 'property' | 'method' | 'circular',
    context: Partial<ErrorContext> = {},
    dependencyName?: string,
    dependencyChain?: string[],
    originalError?: Error
  ) {
    const recoverySuggestions = DependencyInjectionError.generateRecoverySuggestions(
      injectionType, 
      serviceName,
      dependencyName,
      dependencyChain
    );

    super(
      `Dependency injection failed for ${serviceName}: ${message}`,
      ErrorCategory.DEPENDENCY_INJECTION,
      {
        ...context,
        operation: `di_${injectionType}`,
        severity: DependencyInjectionError.determineSeverity(injectionType, dependencyChain),
        additionalContext: {
          ...context.additionalContext,
          serviceName,
          dependencyName,
          injectionType,
          chainLength: dependencyChain?.length || 0
        }
      },
      recoverySuggestions,
      originalError
    );

    this.serviceName = serviceName;
    this.dependencyName = dependencyName;
    this.injectionType = injectionType;
    this.dependencyChain = dependencyChain;
  }

  private static generateRecoverySuggestions(
    injectionType: string,
    serviceName: string,
    dependencyName?: string,
    dependencyChain?: string[]
  ): RecoverySuggestion[] {
    const suggestions: RecoverySuggestion[] = [];

    switch (injectionType) {
      case 'constructor':
        suggestions.push(
          {
            action: 'check_constructor_params',
            description: `Verify constructor parameters for ${serviceName}`,
            automated: false
          },
          {
            action: 'use_factory_method',
            description: 'Use factory method instead of direct constructor injection',
            automated: true
          }
        );
        break;

      case 'property':
        suggestions.push(
          {
            action: 'lazy_inject_property',
            description: 'Use lazy injection for property dependencies',
            automated: true
          },
          {
            action: 'check_property_metadata',
            description: 'Verify property injection metadata is correct',
            automated: false
          }
        );
        break;

      case 'method':
        suggestions.push(
          {
            action: 'manual_method_injection',
            description: 'Perform manual method injection',
            automated: true
          },
          {
            action: 'verify_method_signature',
            description: 'Check method signature matches injection requirements',
            automated: false
          }
        );
        break;

      case 'circular':
        suggestions.push(
          {
            action: 'break_circular_dependency',
            description: 'Refactor to break circular dependency chain',
            automated: false
          },
          {
            action: 'use_lazy_resolution',
            description: 'Use lazy resolution to break circular dependency',
            automated: true
          }
        );
        if (dependencyChain?.length) {
          suggestions.push({
            action: 'analyze_dependency_chain',
            description: `Analyze dependency chain: ${dependencyChain.join(' -> ')}`,
            automated: false
          });
        }
        break;
    }

    // Common suggestions
    suggestions.push(
      {
        action: 'register_missing_service',
        description: dependencyName ? 
          `Register missing service: ${dependencyName}` : 
          'Register missing service dependency',
        automated: false
      },
      {
        action: 'check_service_lifetime',
        description: 'Verify service lifetime configuration',
        automated: false
      }
    );

    return suggestions;
  }

  private static determineSeverity(
    injectionType: string, 
    dependencyChain?: string[]
  ): ErrorSeverity {
    switch (injectionType) {
      case 'circular':
        return ErrorSeverity.CRITICAL;
      case 'constructor':
        return ErrorSeverity.HIGH;
      case 'property':
      case 'method':
        return ErrorSeverity.MEDIUM;
      default:
        return dependencyChain && dependencyChain.length > 3 ? 
               ErrorSeverity.HIGH : ErrorSeverity.MEDIUM;
    }
  }

  isRetryable(): boolean {
    // Circular dependencies are not retryable without code changes
    return this.injectionType !== 'circular';
  }
}

/**
 * Service registration error
 */
export class ServiceRegistrationError extends DependencyInjectionError {
  public readonly serviceType: string;
  public readonly registrationMethod: 'singleton' | 'transient' | 'scoped';

  constructor(
    message: string,
    serviceName: string,
    serviceType: string,
    registrationMethod: 'singleton' | 'transient' | 'scoped',
    context: Partial<ErrorContext> = {},
    originalError?: Error
  ) {
    super(
      `Service registration failed: ${message}`,
      serviceName,
      'constructor',
      {
        ...context,
        additionalContext: {
          ...context.additionalContext,
          serviceType,
          registrationMethod
        }
      },
      undefined,
      undefined,
      originalError
    );

    this.serviceType = serviceType;
    this.registrationMethod = registrationMethod;
  }
}

/**
 * Circular dependency error
 */
export class CircularDependencyError extends DependencyInjectionError {
  public readonly cycle: string[];

  constructor(
    message: string,
    cycle: string[],
    context: Partial<ErrorContext> = {},
    originalError?: Error
  ) {
    super(
      `Circular dependency detected: ${message}`,
      cycle[0] || 'unknown',
      'circular',
      {
        ...context,
        severity: ErrorSeverity.CRITICAL
      },
      undefined,
      cycle,
      originalError
    );

    this.cycle = cycle;
  }

  getCycleDescription(): string {
    return this.cycle.join(' -> ') + (this.cycle.length > 0 ? ` -> ${this.cycle[0]}` : '');
  }
}

/**
 * Missing dependency error
 */
export class MissingDependencyError extends DependencyInjectionError {
  public readonly expectedType?: string;
  public readonly availableServices: string[];

  constructor(
    message: string,
    serviceName: string,
    dependencyName: string,
    availableServices: string[],
    expectedType?: string,
    context: Partial<ErrorContext> = {},
    originalError?: Error
  ) {
    super(
      `Missing dependency: ${message}`,
      serviceName,
      'constructor',
      {
        ...context,
        additionalContext: {
          ...context.additionalContext,
          expectedType,
          availableServiceCount: availableServices.length
        }
      },
      dependencyName,
      undefined,
      originalError
    );

    this.expectedType = expectedType;
    this.availableServices = availableServices;
  }

  getSuggestions(): string[] {
    const suggestions = this.getRecoveryActions();
    
    // Add specific suggestions based on available services
    const similarServices = this.availableServices.filter(service =>
      service.toLowerCase().includes(this.dependencyName?.toLowerCase() || '') ||
      (this.dependencyName?.toLowerCase() || '').includes(service.toLowerCase())
    );

    if (similarServices.length > 0) {
      suggestions.push(`Consider using similar services: ${similarServices.join(', ')}`);
    }

    return suggestions;
  }
}