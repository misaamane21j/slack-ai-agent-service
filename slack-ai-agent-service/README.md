# Slack AI Agent Service

A comprehensive Slack bot that processes user mentions, analyzes context with AI, and triggers Jenkins jobs via MCP (Model Context Protocol).

## Features

- 🤖 **AI-Powered Context Analysis** - Intelligent processing of Slack messages
- 🔧 **Jenkins Integration** - Trigger and monitor Jenkins jobs via MCP
- 🛡️ **Advanced Error Handling** - Comprehensive error boundaries and recovery strategies
- 📊 **Monitoring & Observability** - Real-time system health and performance tracking
- 🔄 **Resilience Patterns** - Circuit breakers, fallbacks, and graceful degradation

## Quick Start

```bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your API keys

# Build the project
npm run build

# Run in development
npm run dev

# Run tests
npm test
```

## Architecture

### Core Services
- **Slack Bot** - Handles Slack interactions and commands
- **AI Processor** - Analyzes context using Anthropic Claude API
- **MCP Client** - Communicates with Model Context Protocol servers
- **Jenkins Integration** - Manages CI/CD workflows

### Error Handling System
- **Error Boundaries** - Isolate failures across system components
- **Recovery Strategies** - Automatic retry and fallback mechanisms
- **Resilience Patterns** - Circuit breakers and graceful degradation
- **Context Preservation** - Maintain user state during error recovery

### Monitoring & Observability
- **Metrics Collection** - Error rates, performance, user experience
- **Health Monitoring** - MCP server availability and response times
- **Alert Management** - Configurable thresholds and escalation
- **Dashboard Integration** - Real-time system visualization

## Testing

```bash
# Unit tests
npm test

# Error handling tests
npm run test:errors

# Monitoring system tests
npm run test:monitoring

# All tests with coverage
npm run test:all
```

### Monitoring Tests

```bash
# Interactive monitoring test
npm run test:monitoring:manual

# Performance benchmarks  
npm run test:monitoring:performance

# Real-world scenarios
npm run test:monitoring:scenarios
```

## Configuration

### Environment Variables
```env
# API Keys
ANTHROPIC_API_KEY=your_anthropic_key
SLACK_BOT_TOKEN=xoxb-your-slack-bot-token
SLACK_SIGNING_SECRET=your_signing_secret

# Jenkins Configuration
JENKINS_URL=https://your-jenkins.com
JENKINS_USERNAME=your_username
JENKINS_API_TOKEN=your_api_token

# Redis Configuration
REDIS_URL=redis://localhost:6379
```

### MCP Servers
Configure MCP servers in `.mcp.json`:

```json
{
  "mcpServers": {
    "jenkins": {
      "command": "jenkins-mcp-server",
      "args": ["--port", "3001"]
    }
  }
}
```

## Documentation

- 📖 **[Full Monitoring Documentation](docs/MONITORING_SYSTEM.md)** - Comprehensive monitoring system guide
- 🚀 **[Quick Reference](docs/QUICK_REFERENCE.md)** - Fast lookup for common tasks
- 🧪 **Testing Guide** - Located in `tests/` directory
- 🔧 **API Reference** - Generated from TypeScript definitions

## Performance

The system is designed for high performance and reliability:

- **Error Recording**: <1ms average latency
- **Concurrent Operations**: >1000 ops/second  
- **Memory Efficiency**: <100MB growth under load
- **System Uptime**: >99.9% availability target

## Development

### Project Structure
```
src/
├── config/          # Configuration management
├── services/        # Core business logic
├── errors/          # Error handling system
├── monitoring/      # Observability components
├── types/           # TypeScript definitions
└── utils/           # Utility functions

tests/
├── unit/           # Unit tests
├── integration/    # Integration tests
└── fixtures/       # Test data

scripts/
└── test-*          # Testing utilities
```

### Error Handling

The system implements comprehensive error handling:

```typescript
import { MonitoringOrchestrator } from './src/monitoring';

// Initialize monitoring
const monitoring = new MonitoringOrchestrator();
await monitoring.initialize();

// Record errors automatically
try {
  await riskyOperation();
} catch (error) {
  monitoring.recordError({
    category: ErrorCategory.MCP_TOOL,
    severity: ErrorSeverity.HIGH,
    message: error.message,
    operation: 'risky_operation'
  });
}
```

### Monitoring Integration

```typescript
// Track operation performance
monitoring.recordOperation({
  name: 'slack_command_processing',
  duration: 1500,
  success: true,
  userId: 'user123'
});

// Get system health
const health = monitoring.getHealthStatus();
console.log(`System Health: ${health.overall} (${health.score}/100)`);
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines

- **TypeScript**: All code must be type-safe
- **Testing**: Maintain >90% test coverage
- **Error Handling**: Use the comprehensive error system
- **Monitoring**: Integrate with the observability system
- **Documentation**: Update relevant docs

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Support

- 📚 Documentation: `docs/` directory
- 🐛 Issues: GitHub Issues
- 💬 Discussions: GitHub Discussions
- 📊 Monitoring: Built-in dashboard at `http://localhost:3001/health`

---

Built with ❤️ for robust Slack automation with enterprise-grade reliability.