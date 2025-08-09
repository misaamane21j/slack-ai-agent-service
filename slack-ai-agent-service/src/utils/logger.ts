import winston from 'winston';
import { getConfig } from '../config/environment';

let _logger: winston.Logger | null = null;

export function getLogger(): winston.Logger {
  if (!_logger) {
    const config = getConfig();
    
    _logger = winston.createLogger({
      level: config.app.logLevel,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      defaultMeta: { service: 'slack-ai-agent-service' },
      transports: [
        new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
        new winston.transports.File({ filename: 'logs/combined.log' }),
      ],
    });

    if (config.app.nodeEnv !== 'production') {
      _logger.add(new winston.transports.Console({
        format: winston.format.simple()
      }));
    }
  }
  
  return _logger;
}

// Logger instance will be created when first accessed
export { getLogger as logger };