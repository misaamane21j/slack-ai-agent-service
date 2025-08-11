import { App } from '@slack/bolt';
import { getSlackConfig } from './config/slack';
import { SlackBotService } from './services/slack-bot';
import { AIProcessorService } from './services/ai-processor';
import { MCPClientService } from './services/mcp-client';
import { NotificationService } from './services/notification';

async function main() {
  console.log('🚀 Starting Slack AI Agent Service...');
  let config;
  
  try {
    console.log('📋 Loading configuration...');
    // Load and validate configuration first
    const { getConfig } = await import('./config/environment');
    config = getConfig();
    console.log('✅ Configuration loaded successfully');
  } catch (error) {
    console.error('❌ Configuration Error:');
    console.error(error instanceof Error ? error.message : 'Unknown configuration error');
    console.error('\n📋 Required Environment Variables:');
    console.error('- SLACK_BOT_TOKEN (format: xoxb-...)');
    console.error('- SLACK_SIGNING_SECRET (32-64 characters)');
    console.error('- SLACK_APP_TOKEN (format: xapp-...)');
    console.error('- ANTHROPIC_API_KEY (format: sk-ant-api03-...)');
    console.error('- JENKINS_MCP_SERVER_PATH (path to Jenkins MCP server)');
    console.error('\n📝 Optional Environment Variables:');
    console.error('- AI_MODEL (default: claude-3-5-sonnet-20241022)');
    console.error('- AI_CONFIDENCE_THRESHOLD (default: 0.8)');
    console.error('- REDIS_URL (default: redis://localhost:6379)');
    console.error('- NODE_ENV (default: development)');
    console.error('- LOG_LEVEL (default: info)');
    console.error('- PORT (default: 3000)');
    console.error('\n💡 Create a .env file in the project root with these variables.');
    process.exit(1);
  }

  try {
    // Import logger after config is validated (logger depends on config)
    const { logger } = await import('./utils/logger');
    
    logger().info('Starting Slack AI Agent Service...');
    logger().info(`Environment: ${config.app.nodeEnv}`);
    logger().info(`Log Level: ${config.app.logLevel}`);
    
    logger().info('🔧 Creating Slack app instance...');
    const slackConfig = getSlackConfig();
    logger().info('📋 Slack config loaded:', {
      socketMode: slackConfig.socketMode,
      appToken: slackConfig.appToken ? '✅ Present' : '❌ Missing',
      token: slackConfig.token ? '✅ Present' : '❌ Missing',
      signingSecret: slackConfig.signingSecret ? '✅ Present' : '❌ Missing'
    });
    
    const app = new App(slackConfig);
    
    logger().info('🤖 Initializing AI and MCP services...');
    const aiProcessor = new AIProcessorService();
    const mcpClient = new MCPClientService();
    const notificationService = new NotificationService(app);
    const slackBot = new SlackBotService(app, aiProcessor, mcpClient, notificationService);

    logger().info('🚀 Starting Slack bot...');
    await slackBot.initialize();
    
    logger().info(`📡 Starting server on port ${config.port}...`);
    await app.start(config.port);
    
    logger().info(`✅ Slack AI Agent Service started successfully on port ${config.port}`);
    logger().info('🎯 Ready to process Slack mentions and trigger Jenkins jobs!');
    logger().info('💡 Test by mentioning your bot: @botname hello');
  } catch (error) {
    // Use console.error as fallback if logger is not available
    const logError = async (message: string, err: any) => {
      try {
        const { logger } = await import('./utils/logger');
        logger().error(message, err);
      } catch {
        console.error(message, err);
      }
    };
    
    await logError('Failed to start application:', error);
    process.exit(1);
  }
}

main();