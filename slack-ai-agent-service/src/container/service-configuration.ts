/**
 * Service Configuration and Registration
 * Configures and registers all services in the dependency injection container
 */

import { App as SlackApp } from '@slack/bolt';
import { ServiceContainer } from './service-container';
import { getConfig } from '../config/environment';
import { MCPConfigManager } from '../config/mcp-config-manager';
import { CredentialManager } from '../config/credential-manager';
import { AIProcessorService } from '../services/ai-processor';
import { MCPClientService } from '../services/mcp-client';
import { MCPRegistryService } from '../services/mcp-registry';
import { SlackBotService } from '../services/slack-bot';
import { NotificationService } from '../services/notification';
import { JenkinsAdapter } from '../adapters/jenkins-adapter';
import { logger } from '../utils/logger';

/**
 * Service identifiers
 */
export const SERVICE_IDS = {
  // Configuration services
  CONFIG: 'config',
  MCP_CONFIG_MANAGER: 'mcpConfigManager',
  CREDENTIAL_MANAGER: 'credentialManager',
  
  // Core services
  SLACK_APP: 'slackApp',
  AI_PROCESSOR: 'aiProcessor',
  MCP_CLIENT: 'mcpClient',
  MCP_REGISTRY: 'mcpRegistry',
  SLACK_BOT: 'slackBot',
  NOTIFICATION: 'notification',
  
  // Adapters
  JENKINS_ADAPTER: 'jenkinsAdapter',
} as const;

/**
 * Configure and register all services in the container
 */
export async function configureServices(container: ServiceContainer): Promise<void> {
  logger().info('Configuring services for dependency injection...');

  // Register configuration services
  await configureConfigurationServices(container);
  
  // Register core services
  await configureCoreServices(container);
  
  // Register adapters
  await configureAdapters(container);
  
  // Register application services
  await configureApplicationServices(container);

  logger().info('Service configuration completed', {
    totalServices: container.getServiceIds().length,
  });
}

/**
 * Configure configuration-related services
 */
async function configureConfigurationServices(container: ServiceContainer): Promise<void> {
  // Environment configuration (singleton)
  container.registerInstance(SERVICE_IDS.CONFIG, getConfig(), {
    required: true,
    tags: ['config', 'core'],
  });

  // MCP Configuration Manager (singleton)
  container.registerSingleton(
    SERVICE_IDS.MCP_CONFIG_MANAGER,
    (config) => {
      return new MCPConfigManager(config.mcp.configFile);
    },
    {
      dependencies: [SERVICE_IDS.CONFIG],
      required: true,
      tags: ['config', 'mcp'],
      init: async (manager: MCPConfigManager) => {
        await manager.loadConfig();
        logger().info('MCP Configuration Manager initialized');
      },
      destroy: async (manager: MCPConfigManager) => {
        await manager.stop();
        logger().info('MCP Configuration Manager stopped');
      },
    }
  );

  // Credential Manager (singleton)
  container.registerSingleton(
    SERVICE_IDS.CREDENTIAL_MANAGER,
    (config) => {
      return new CredentialManager({
        storageDir: './.credentials',
        defaultExpiration: config.mcp.security?.credentialExpiration || 24 * 60 * 60 * 1000,
      });
    },
    {
      dependencies: [SERVICE_IDS.CONFIG],
      required: false,
      tags: ['config', 'security'],
      init: async (manager: CredentialManager) => {
        // Initialize with environment-based master key
        const masterKey = process.env.CREDENTIAL_MASTER_KEY || 'default-dev-key-change-in-production';
        await manager.initialize(masterKey);
        
        // Import common credentials from environment
        await manager.importFromEnvironment({
          'jenkins.url': 'JENKINS_URL',
          'jenkins.username': 'JENKINS_USERNAME',
          'jenkins.apiToken': 'JENKINS_API_TOKEN',
          'github.token': 'GITHUB_TOKEN',
          'anthropic.apiKey': 'ANTHROPIC_API_KEY',
        }, {
          tags: ['imported', 'startup'],
          description: 'Auto-imported from environment variables',
        });
        
        logger().info('Credential Manager initialized');
      },
      destroy: async (manager: CredentialManager) => {
        await manager.destroy();
        logger().info('Credential Manager destroyed');
      },
    }
  );
}

/**
 * Configure core services
 */
async function configureCoreServices(container: ServiceContainer): Promise<void> {
  // Slack App (singleton)
  container.registerSingleton(
    SERVICE_IDS.SLACK_APP,
    (config) => {
      return new SlackApp({
        token: config.slack.botToken,
        signingSecret: config.slack.signingSecret,
        appToken: config.slack.appToken,
        socketMode: true,
        logLevel: config.app.logLevel as any,
      });
    },
    {
      dependencies: [SERVICE_IDS.CONFIG],
      required: true,
      tags: ['core', 'slack'],
      init: async (app: SlackApp) => {
        await app.start();
        logger().info('Slack App started');
      },
      destroy: async (app: SlackApp) => {
        await app.stop();
        logger().info('Slack App stopped');
      },
    }
  );

  // MCP Registry Service (singleton)
  container.registerSingleton(
    SERVICE_IDS.MCP_REGISTRY,
    (configManager) => {
      return new MCPRegistryService(configManager);
    },
    {
      dependencies: [SERVICE_IDS.MCP_CONFIG_MANAGER],
      required: true,
      tags: ['core', 'mcp'],
      init: async (registry: MCPRegistryService) => {
        await registry.initialize();
        logger().info('MCP Registry Service initialized');
      },
      destroy: async (registry: MCPRegistryService) => {
        await registry.destroy();
        logger().info('MCP Registry Service destroyed');
      },
    }
  );

  // AI Processor Service (singleton)
  container.registerSingleton(
    SERVICE_IDS.AI_PROCESSOR,
    (mcpRegistry) => {
      return new AIProcessorService(mcpRegistry);
    },
    {
      dependencies: [SERVICE_IDS.MCP_REGISTRY],
      required: true,
      tags: ['core', 'ai'],
      init: async (processor: AIProcessorService) => {
        await processor.refreshTools();
        logger().info('AI Processor Service initialized');
      },
      destroy: async (processor: AIProcessorService) => {
        await processor.cleanup();
        logger().info('AI Processor Service cleaned up');
      },
    }
  );

  // MCP Client Service (singleton)
  container.registerSingleton(
    SERVICE_IDS.MCP_CLIENT,
    (config, mcpRegistry) => {
      return new MCPClientService(config, mcpRegistry);
    },
    {
      dependencies: [SERVICE_IDS.CONFIG, SERVICE_IDS.MCP_REGISTRY],
      required: true,
      tags: ['core', 'mcp'],
      init: async (client: MCPClientService) => {
        // MCP Client initialization is handled internally
        logger().info('MCP Client Service initialized');
      },
    }
  );

  // Notification Service (singleton)
  container.registerSingleton(
    SERVICE_IDS.NOTIFICATION,
    () => {
      return new NotificationService();
    },
    {
      required: false,
      tags: ['core', 'notification'],
      init: async (service: NotificationService) => {
        logger().info('Notification Service initialized');
      },
    }
  );
}

/**
 * Configure adapter services
 */
async function configureAdapters(container: ServiceContainer): Promise<void> {
  // Jenkins Adapter (singleton)
  container.registerSingleton(
    SERVICE_IDS.JENKINS_ADAPTER,
    (mcpClient, config, credentialManager) => {
      // Create Jenkins configuration from environment or credentials
      const jenkinsConfig = {
        url: process.env.JENKINS_URL || 'http://localhost:8080',
        username: process.env.JENKINS_USERNAME || 'admin',
        apiToken: process.env.JENKINS_API_TOKEN || '',
        timeout: config.mcp.connectionTimeout,
        maxRetries: 3,
      };

      return new JenkinsAdapter(mcpClient, jenkinsConfig);
    },
    {
      dependencies: [SERVICE_IDS.MCP_CLIENT, SERVICE_IDS.CONFIG, SERVICE_IDS.CREDENTIAL_MANAGER],
      required: false, // Jenkins adapter is optional
      tags: ['adapter', 'jenkins'],
      init: async (adapter: JenkinsAdapter) => {
        // Test connection if Jenkins is configured
        const connectionTest = await adapter.testConnection();
        if (connectionTest.success) {
          logger().info('Jenkins Adapter initialized and connected', {
            responseTime: connectionTest.responseTime,
          });
        } else {
          logger().warn('Jenkins Adapter initialized but connection failed', {
            error: connectionTest.error,
          });
        }
      },
      destroy: async (adapter: JenkinsAdapter) => {
        await adapter.destroy();
        logger().info('Jenkins Adapter destroyed');
      },
    }
  );
}

/**
 * Configure application services
 */
async function configureApplicationServices(container: ServiceContainer): Promise<void> {
  // Slack Bot Service (singleton)
  container.registerSingleton(
    SERVICE_IDS.SLACK_BOT,
    (slackApp, aiProcessor, mcpClient, notification, mcpRegistry) => {
      return new SlackBotService(
        slackApp,
        aiProcessor,
        mcpClient,
        notification,
        mcpRegistry
      );
    },
    {
      dependencies: [
        SERVICE_IDS.SLACK_APP,
        SERVICE_IDS.AI_PROCESSOR,
        SERVICE_IDS.MCP_CLIENT,
        SERVICE_IDS.NOTIFICATION,
        SERVICE_IDS.MCP_REGISTRY,
      ],
      required: true,
      tags: ['application', 'slack'],
      init: async (slackBot: SlackBotService) => {
        await slackBot.initialize();
        logger().info('Slack Bot Service initialized');
      },
    }
  );
}

/**
 * Create and configure a new service container
 */
export async function createServiceContainer(): Promise<ServiceContainer> {
  const container = new ServiceContainer();
  
  // Add container event listeners
  container.on('service-registered', (serviceId, registration) => {
    logger().debug('Service registered', {
      serviceId,
      lifecycle: registration.options.lifecycle,
      required: registration.options.required,
    });
  });

  container.on('service-resolved', (serviceId) => {
    logger().debug('Service resolved', { serviceId });
  });

  container.on('service-initialized', (serviceId) => {
    logger().info('Service initialized', { serviceId });
  });

  container.on('container-started', () => {
    const stats = container.getStats();
    logger().info('Service container started', {
      totalServices: stats.totalServices,
      initializedServices: stats.initializedServices,
      requiredServices: stats.requiredServices,
    });
  });

  container.on('container-stopped', () => {
    logger().info('Service container stopped');
  });

  // Configure all services
  await configureServices(container);

  return container;
}

/**
 * Get a typed service resolver function
 */
export function createServiceResolver(container: ServiceContainer) {
  return async <T>(serviceId: keyof typeof SERVICE_IDS): Promise<T> => {
    return await container.resolve<T>(SERVICE_IDS[serviceId]);
  };
}

/**
 * Health check for all critical services
 */
export async function performHealthCheck(container: ServiceContainer): Promise<{
  healthy: boolean;
  services: Array<{
    serviceId: string;
    healthy: boolean;
    error?: string;
  }>;
}> {
  const results: Array<{
    serviceId: string;
    healthy: boolean;
    error?: string;
  }> = [];

  // Check required services
  const requiredServices = container.getServicesByTag('core');
  
  for (const serviceId of requiredServices) {
    try {
      const service = await container.resolve(serviceId);
      
      // Check if service has a health check method
      if (service && typeof service.getHealthStatus === 'function') {
        const health = await service.getHealthStatus();
        results.push({
          serviceId,
          healthy: health.healthy,
          error: health.healthy ? undefined : 'Service reported unhealthy',
        });
      } else {
        // Service exists and was resolved successfully
        results.push({
          serviceId,
          healthy: true,
        });
      }
    } catch (error) {
      results.push({
        serviceId,
        healthy: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  const healthy = results.every(result => result.healthy);
  
  return {
    healthy,
    services: results,
  };
}