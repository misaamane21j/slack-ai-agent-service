/**
 * Dependency Injection Container
 * Provides service registration, resolution, and lifecycle management
 */

import { logger } from '../utils/logger';

/**
 * Service lifecycle types
 */
export type ServiceLifecycle = 'singleton' | 'transient' | 'scoped';

/**
 * Service registration options
 */
export interface ServiceRegistrationOptions {
  /** Service lifecycle */
  lifecycle: ServiceLifecycle;
  /** Dependencies to inject */
  dependencies?: string[];
  /** Initialization function */
  init?: (instance: any) => Promise<void> | void;
  /** Cleanup function */
  destroy?: (instance: any) => Promise<void> | void;
  /** Whether service is required for application startup */
  required?: boolean;
  /** Service tags for categorization */
  tags?: string[];
}

/**
 * Service registration definition
 */
export interface ServiceRegistration<T = any> {
  /** Unique service identifier */
  id: string;
  /** Service constructor or factory function */
  factory: (...args: any[]) => T | Promise<T>;
  /** Registration options */
  options: ServiceRegistrationOptions;
  /** Cached instance (for singletons) */
  instance?: T;
  /** Whether service is initialized */
  initialized: boolean;
  /** Service creation timestamp */
  createdAt?: Date;
}

/**
 * Dependency resolution context
 */
export interface ResolutionContext {
  /** Services being resolved (for circular dependency detection) */
  resolving: Set<string>;
  /** Current resolution depth */
  depth: number;
  /** Maximum resolution depth */
  maxDepth: number;
}

/**
 * Service Container Events
 */
export interface ServiceContainerEvents {
  'service-registered': (serviceId: string, registration: ServiceRegistration) => void;
  'service-resolved': (serviceId: string, instance: any) => void;
  'service-initialized': (serviceId: string, instance: any) => void;
  'service-destroyed': (serviceId: string) => void;
  'container-started': () => void;
  'container-stopped': () => void;
}

/**
 * Service Container Class
 * Manages service registration, dependency injection, and lifecycle
 */
export class ServiceContainer {
  private services = new Map<string, ServiceRegistration>();
  private scopedInstances = new Map<string, any>();
  private isStarted = false;
  private eventListeners = new Map<keyof ServiceContainerEvents, Function[]>();

  constructor() {
    logger().info('Service Container initialized');
  }

  /**
   * Register a service with the container
   */
  register<T>(
    serviceId: string,
    factory: (...args: any[]) => T | Promise<T>,
    options: Partial<ServiceRegistrationOptions> = {}
  ): ServiceContainer {
    if (this.services.has(serviceId)) {
      throw new Error(`Service '${serviceId}' is already registered`);
    }

    const registration: ServiceRegistration<T> = {
      id: serviceId,
      factory,
      options: {
        lifecycle: 'singleton',
        dependencies: [],
        required: false,
        tags: [],
        ...options,
      },
      initialized: false,
    };

    this.services.set(serviceId, registration);
    
    logger().info('Service registered', {
      serviceId,
      lifecycle: registration.options.lifecycle,
      dependencies: registration.options.dependencies,
      required: registration.options.required,
    });

    this.emit('service-registered', serviceId, registration);
    return this;
  }

  /**
   * Register a singleton service
   */
  registerSingleton<T>(
    serviceId: string,
    factory: (...args: any[]) => T | Promise<T>,
    options: Partial<ServiceRegistrationOptions> = {}
  ): ServiceContainer {
    return this.register(serviceId, factory, { ...options, lifecycle: 'singleton' });
  }

  /**
   * Register a transient service
   */
  registerTransient<T>(
    serviceId: string,
    factory: (...args: any[]) => T | Promise<T>,
    options: Partial<ServiceRegistrationOptions> = {}
  ): ServiceContainer {
    return this.register(serviceId, factory, { ...options, lifecycle: 'transient' });
  }

  /**
   * Register a scoped service
   */
  registerScoped<T>(
    serviceId: string,
    factory: (...args: any[]) => T | Promise<T>,
    options: Partial<ServiceRegistrationOptions> = {}
  ): ServiceContainer {
    return this.register(serviceId, factory, { ...options, lifecycle: 'scoped' });
  }

  /**
   * Register an existing instance as a singleton
   */
  registerInstance<T>(
    serviceId: string,
    instance: T,
    options: Partial<ServiceRegistrationOptions> = {}
  ): ServiceContainer {
    const registration: ServiceRegistration<T> = {
      id: serviceId,
      factory: () => instance,
      options: {
        lifecycle: 'singleton',
        dependencies: [],
        required: false,
        tags: [],
        ...options,
      },
      instance,
      initialized: true,
      createdAt: new Date(),
    };

    this.services.set(serviceId, registration);
    
    logger().info('Service instance registered', {
      serviceId,
      tags: registration.options.tags,
    });

    this.emit('service-registered', serviceId, registration);
    return this;
  }

  /**
   * Resolve a service and its dependencies
   */
  async resolve<T>(serviceId: string): Promise<T> {
    const context: ResolutionContext = {
      resolving: new Set(),
      depth: 0,
      maxDepth: 20,
    };

    return await this.resolveWithContext<T>(serviceId, context);
  }

  /**
   * Resolve a service with resolution context
   */
  private async resolveWithContext<T>(
    serviceId: string,
    context: ResolutionContext
  ): Promise<T> {
    // Check for circular dependencies
    if (context.resolving.has(serviceId)) {
      throw new Error(`Circular dependency detected: ${Array.from(context.resolving).join(' -> ')} -> ${serviceId}`);
    }

    // Check resolution depth
    if (context.depth > context.maxDepth) {
      throw new Error(`Maximum resolution depth exceeded: ${context.maxDepth}`);
    }

    const registration = this.services.get(serviceId);
    if (!registration) {
      throw new Error(`Service '${serviceId}' not registered`);
    }

    // Return existing instance for singletons
    if (registration.options.lifecycle === 'singleton' && registration.instance) {
      return registration.instance;
    }

    // Return existing scoped instance
    if (registration.options.lifecycle === 'scoped' && this.scopedInstances.has(serviceId)) {
      return this.scopedInstances.get(serviceId);
    }

    // Add to resolution context
    context.resolving.add(serviceId);
    context.depth++;

    try {
      // Resolve dependencies
      const dependencies = [];
      if (registration.options.dependencies) {
        for (const depId of registration.options.dependencies) {
          const dependency = await this.resolveWithContext(depId, context);
          dependencies.push(dependency);
        }
      }

      // Create instance
      const instance = await this.createInstance(registration, dependencies);

      // Store instance based on lifecycle
      if (registration.options.lifecycle === 'singleton') {
        registration.instance = instance;
        registration.createdAt = new Date();
      } else if (registration.options.lifecycle === 'scoped') {
        this.scopedInstances.set(serviceId, instance);
      }

      // Initialize if needed
      if (!registration.initialized && registration.options.init) {
        await registration.options.init(instance);
        registration.initialized = true;
        this.emit('service-initialized', serviceId, instance);
      }

      logger().debug('Service resolved', {
        serviceId,
        lifecycle: registration.options.lifecycle,
        dependencies: registration.options.dependencies?.length || 0,
      });

      this.emit('service-resolved', serviceId, instance);
      return instance;

    } finally {
      // Remove from resolution context
      context.resolving.delete(serviceId);
      context.depth--;
    }
  }

  /**
   * Create service instance
   */
  private async createInstance<T>(
    registration: ServiceRegistration<T>,
    dependencies: any[]
  ): Promise<T> {
    try {
      const instance = await registration.factory(...dependencies);
      return instance;
    } catch (error) {
      logger().error('Failed to create service instance', {
        serviceId: registration.id,
        error,
      });
      throw new Error(`Failed to create service '${registration.id}': ${error}`);
    }
  }

  /**
   * Check if a service is registered
   */
  isRegistered(serviceId: string): boolean {
    return this.services.has(serviceId);
  }

  /**
   * Get service registration info
   */
  getRegistration(serviceId: string): ServiceRegistration | undefined {
    return this.services.get(serviceId);
  }

  /**
   * Get all registered service IDs
   */
  getServiceIds(): string[] {
    return Array.from(this.services.keys());
  }

  /**
   * Get services by tag
   */
  getServicesByTag(tag: string): string[] {
    const services: string[] = [];
    for (const [serviceId, registration] of this.services) {
      if (registration.options.tags?.includes(tag)) {
        services.push(serviceId);
      }
    }
    return services;
  }

  /**
   * Start the container and initialize required services
   */
  async start(): Promise<void> {
    if (this.isStarted) {
      logger().warn('Service container is already started');
      return;
    }

    logger().info('Starting service container...');

    // Get required services
    const requiredServices = Array.from(this.services.entries())
      .filter(([, registration]) => registration.options.required)
      .map(([serviceId]) => serviceId);

    logger().info('Initializing required services', { requiredServices });

    // Initialize required services
    for (const serviceId of requiredServices) {
      try {
        await this.resolve(serviceId);
        logger().info('Required service initialized', { serviceId });
      } catch (error) {
        logger().error('Failed to initialize required service', { serviceId, error });
        throw new Error(`Failed to start container: required service '${serviceId}' failed to initialize`);
      }
    }

    this.isStarted = true;
    
    logger().info('Service container started successfully', {
      totalServices: this.services.size,
      requiredServices: requiredServices.length,
    });

    this.emit('container-started');
  }

  /**
   * Stop the container and cleanup resources
   */
  async stop(): Promise<void> {
    if (!this.isStarted) {
      logger().warn('Service container is not started');
      return;
    }

    logger().info('Stopping service container...');

    // Destroy services in reverse order
    const services = Array.from(this.services.entries()).reverse();
    
    for (const [serviceId, registration] of services) {
      if (registration.instance && registration.options.destroy) {
        try {
          await registration.options.destroy(registration.instance);
          logger().debug('Service destroyed', { serviceId });
          this.emit('service-destroyed', serviceId);
        } catch (error) {
          logger().error('Error destroying service', { serviceId, error });
        }
      }
    }

    // Clear instances
    for (const registration of this.services.values()) {
      registration.instance = undefined;
      registration.initialized = false;
    }
    this.scopedInstances.clear();

    this.isStarted = false;
    
    logger().info('Service container stopped');
    this.emit('container-stopped');
  }

  /**
   * Create a new scope for scoped services
   */
  createScope(): ServiceContainer {
    const scopedContainer = new ServiceContainer();
    
    // Copy service registrations
    for (const [serviceId, registration] of this.services) {
      scopedContainer.services.set(serviceId, { ...registration });
    }

    return scopedContainer;
  }

  /**
   * Get container statistics
   */
  getStats(): {
    totalServices: number;
    singletonServices: number;
    transientServices: number;
    scopedServices: number;
    initializedServices: number;
    requiredServices: number;
    isStarted: boolean;
  } {
    const stats = {
      totalServices: this.services.size,
      singletonServices: 0,
      transientServices: 0,
      scopedServices: 0,
      initializedServices: 0,
      requiredServices: 0,
      isStarted: this.isStarted,
    };

    for (const registration of this.services.values()) {
      switch (registration.options.lifecycle) {
        case 'singleton':
          stats.singletonServices++;
          break;
        case 'transient':
          stats.transientServices++;
          break;
        case 'scoped':
          stats.scopedServices++;
          break;
      }

      if (registration.initialized) {
        stats.initializedServices++;
      }

      if (registration.options.required) {
        stats.requiredServices++;
      }
    }

    return stats;
  }

  /**
   * Add event listener
   */
  on<K extends keyof ServiceContainerEvents>(
    event: K,
    listener: ServiceContainerEvents[K]
  ): ServiceContainer {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event)!.push(listener);
    return this;
  }

  /**
   * Emit event
   */
  private emit<K extends keyof ServiceContainerEvents>(
    event: K,
    ...args: Parameters<ServiceContainerEvents[K]>
  ): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      for (const listener of listeners) {
        try {
          (listener as any)(...args);
        } catch (error) {
          logger().error('Event listener error', { event, error });
        }
      }
    }
  }

  /**
   * Remove event listener
   */
  off<K extends keyof ServiceContainerEvents>(
    event: K,
    listener: ServiceContainerEvents[K]
  ): ServiceContainer {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      const index = listeners.indexOf(listener);
      if (index !== -1) {
        listeners.splice(index, 1);
      }
    }
    return this;
  }

  /**
   * Clear all event listeners
   */
  removeAllListeners(): ServiceContainer {
    this.eventListeners.clear();
    return this;
  }
}