import dotenv from 'dotenv';
import Joi from 'joi';
import { EnvironmentConfig } from './interfaces';

dotenv.config();

/**
 * Joi schema for validating environment variables
 */
const environmentSchema = Joi.object<EnvironmentConfig>({
  slack: Joi.object({
    botToken: Joi.string()
      .pattern(/^xoxb-/)
      .required()
      .messages({
        'string.pattern.base': 'SLACK_BOT_TOKEN must start with "xoxb-"',
        'any.required': 'SLACK_BOT_TOKEN is required'
      }),
    signingSecret: Joi.string()
      .min(32)
      .max(64)
      .required()
      .messages({
        'string.min': 'SLACK_SIGNING_SECRET must be at least 32 characters',
        'string.max': 'SLACK_SIGNING_SECRET must be at most 64 characters',
        'any.required': 'SLACK_SIGNING_SECRET is required'
      }),
    appToken: Joi.string()
      .pattern(/^xapp-/)
      .required()
      .messages({
        'string.pattern.base': 'SLACK_APP_TOKEN must start with "xapp-"',
        'any.required': 'SLACK_APP_TOKEN is required'
      })
  }).required(),
  
  ai: Joi.object({
    openaiApiKey: Joi.string()
      .pattern(/^sk-/)
      .required()
      .messages({
        'string.pattern.base': 'OPENAI_API_KEY must start with "sk-"',
        'any.required': 'OPENAI_API_KEY is required'
      }),
    model: Joi.string()
      .valid('gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo', 'gpt-4o', 'gpt-4o-mini')
      .default('gpt-4-turbo')
      .messages({
        'any.only': 'AI_MODEL must be one of: gpt-4-turbo, gpt-4, gpt-3.5-turbo, gpt-4o, gpt-4o-mini'
      }),
    confidenceThreshold: Joi.number()
      .min(0)
      .max(1)
      .default(0.8)
      .messages({
        'number.min': 'AI_CONFIDENCE_THRESHOLD must be between 0 and 1',
        'number.max': 'AI_CONFIDENCE_THRESHOLD must be between 0 and 1'
      })
  }).required(),
  
  mcp: Joi.object({
    jenkinsServerPath: Joi.string()
      .required()
      .messages({
        'any.required': 'JENKINS_MCP_SERVER_PATH is required'
      })
  }).required(),
  
  redis: Joi.object({
    url: Joi.string()
      .uri({ scheme: ['redis', 'rediss'] })
      .default('redis://localhost:6379')
      .messages({
        'string.uri': 'REDIS_URL must be a valid Redis URL (redis:// or rediss://)'
      })
  }).required(),
  
  app: Joi.object({
    nodeEnv: Joi.string()
      .valid('development', 'production', 'test')
      .default('development')
      .messages({
        'any.only': 'NODE_ENV must be one of: development, production, test'
      }),
    logLevel: Joi.string()
      .valid('error', 'warn', 'info', 'debug')
      .default('info')
      .messages({
        'any.only': 'LOG_LEVEL must be one of: error, warn, info, debug'
      })
  }).required(),
  
  port: Joi.number()
    .port()
    .default(3000)
    .messages({
      'number.port': 'PORT must be a valid port number (1-65535)'
    })
}).required();

/**
 * Load and validate environment configuration
 * @returns Validated environment configuration
 * @throws Error if validation fails
 */
export function loadConfig(): EnvironmentConfig {
  const rawConfig = {
    slack: {
      botToken: process.env.SLACK_BOT_TOKEN,
      signingSecret: process.env.SLACK_SIGNING_SECRET,
      appToken: process.env.SLACK_APP_TOKEN,
    },
    ai: {
      openaiApiKey: process.env.OPENAI_API_KEY,
      model: process.env.AI_MODEL,
      confidenceThreshold: process.env.AI_CONFIDENCE_THRESHOLD ? 
        parseFloat(process.env.AI_CONFIDENCE_THRESHOLD) : undefined,
    },
    mcp: {
      jenkinsServerPath: process.env.JENKINS_MCP_SERVER_PATH,
    },
    redis: {
      url: process.env.REDIS_URL,
    },
    app: {
      nodeEnv: process.env.NODE_ENV,
      logLevel: process.env.LOG_LEVEL,
    },
    port: process.env.PORT ? parseInt(process.env.PORT, 10) : undefined,
  };

  const { error, value } = environmentSchema.validate(rawConfig, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    const errorMessages = error.details.map(detail => {
      const path = detail.path.join('.');
      return `- ${detail.message} (${path})`;
    }).join('\n');

    throw new Error(
      `Environment validation failed:\n${errorMessages}\n\n` +
      'Please check your .env file and ensure all required environment variables are set correctly.'
    );
  }

  return value;
}

/**
 * Validated environment configuration singleton
 * Note: This is lazily initialized to allow proper error handling at startup
 */
let _config: EnvironmentConfig | null = null;

export function getConfig(): EnvironmentConfig {
  if (!_config) {
    _config = loadConfig();
  }
  return _config;
}