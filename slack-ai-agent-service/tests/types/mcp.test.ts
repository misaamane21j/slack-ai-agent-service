import { MCPServerConfig, MCPConfig, MCPServerStatus, MCPToolDiscovery } from '../../src/types/mcp';
import { ToolDefinition } from '../../src/types/ai-agent';

describe('MCPServerConfig Interface', () => {
  it('should validate complete server configuration', () => {
    const config: MCPServerConfig = {
      id: 'jenkins-prod',
      name: 'Production Jenkins Server',
      description: 'Jenkins server for production deployments',
      command: 'node',
      args: ['../jenkins-mcp-server/dist/index.js'],
      env: {
        JENKINS_URL: 'https://jenkins.company.com',
        JENKINS_USERNAME: 'bot-user',
        JENKINS_API_TOKEN: 'secret-token'
      },
      enabled: true,
      timeout: 30000,
      maxRetries: 3
    };

    expect(config.id).toBe('jenkins-prod');
    expect(config.name).toBe('Production Jenkins Server');
    expect(config.command).toBe('node');
    expect(Array.isArray(config.args)).toBe(true);
    expect(config.args).toHaveLength(1);
    expect(config.env?.JENKINS_URL).toBe('https://jenkins.company.com');
    expect(config.enabled).toBe(true);
    expect(config.timeout).toBe(30000);
    expect(config.maxRetries).toBe(3);
  });

  it('should validate minimal server configuration', () => {
    const minimalConfig: MCPServerConfig = {
      id: 'simple-server',
      name: 'Simple Server',
      description: 'A simple MCP server',
      command: 'python',
      args: ['server.py'],
      enabled: true
    };

    expect(minimalConfig.id).toBe('simple-server');
    expect(minimalConfig.env).toBeUndefined();
    expect(minimalConfig.timeout).toBeUndefined();
    expect(minimalConfig.maxRetries).toBeUndefined();
  });

  it('should handle different command types', () => {
    const dockerConfig: MCPServerConfig = {
      id: 'docker-server',
      name: 'Docker MCP Server',
      description: 'Server running in Docker',
      command: 'docker',
      args: ['run', '-i', '--rm', 'mcp-server:latest'],
      enabled: true
    };

    const binaryConfig: MCPServerConfig = {
      id: 'binary-server',
      name: 'Binary MCP Server',
      description: 'Pre-compiled binary server',
      command: './mcp-server',
      args: ['--config', 'server.conf'],
      enabled: true
    };

    expect(dockerConfig.command).toBe('docker');
    expect(dockerConfig.args[0]).toBe('run');
    expect(binaryConfig.command).toBe('./mcp-server');
    expect(binaryConfig.args).toContain('--config');
  });

  it('should handle complex environment configurations', () => {
    const complexEnvConfig: MCPServerConfig = {
      id: 'complex-server',
      name: 'Complex Environment Server',
      description: 'Server with complex environment setup',
      command: 'node',
      args: ['server.js'],
      env: {
        NODE_ENV: 'production',
        DEBUG: 'mcp:*',
        DATABASE_URL: 'postgresql://user:pass@localhost/db',
        REDIS_URL: 'redis://localhost:6379',
        API_KEYS: 'key1,key2,key3',
        LOG_LEVEL: 'info',
        TIMEOUT: '30000',
        MAX_CONNECTIONS: '10'
      },
      enabled: true
    };

    expect(Object.keys(complexEnvConfig.env || {})).toHaveLength(8);
    expect(complexEnvConfig.env?.NODE_ENV).toBe('production');
    expect(complexEnvConfig.env?.API_KEYS).toBe('key1,key2,key3');
  });

  it('should handle disabled servers', () => {
    const disabledConfig: MCPServerConfig = {
      id: 'disabled-server',
      name: 'Disabled Server',
      description: 'This server is currently disabled',
      command: 'node',
      args: ['disabled-server.js'],
      enabled: false,
      timeout: 5000
    };

    expect(disabledConfig.enabled).toBe(false);
  });
});

describe('MCPConfig Interface', () => {
  it('should validate configuration with multiple servers', () => {
    const config: MCPConfig = {
      servers: {
        jenkins: {
          id: 'jenkins',
          name: 'Jenkins CI/CD',
          description: 'Jenkins automation server',
          command: 'node',
          args: ['jenkins-server.js'],
          enabled: true
        },
        github: {
          id: 'github',
          name: 'GitHub Integration',
          description: 'GitHub API integration',
          command: 'docker',
          args: ['run', 'github-mcp'],
          enabled: true
        },
        database: {
          id: 'database',
          name: 'Database Operations',
          description: 'Database query and management',
          command: 'python',
          args: ['db-server.py'],
          enabled: false
        }
      }
    };

    expect(Object.keys(config.servers)).toHaveLength(3);
    expect(config.servers.jenkins.id).toBe('jenkins');
    expect(config.servers.github.command).toBe('docker');
    expect(config.servers.database.enabled).toBe(false);
  });

  it('should handle empty server configuration', () => {
    const emptyConfig: MCPConfig = {
      servers: {}
    };

    expect(Object.keys(emptyConfig.servers)).toHaveLength(0);
  });

  it('should maintain server ID consistency', () => {
    const config: MCPConfig = {
      servers: {
        'my-server': {
          id: 'my-server',
          name: 'My Custom Server',
          description: 'Custom MCP server',
          command: 'node',
          args: ['custom-server.js'],
          enabled: true
        }
      }
    };

    const serverKey = Object.keys(config.servers)[0];
    const server = config.servers[serverKey];
    expect(serverKey).toBe(server.id);
  });
});

describe('MCPServerStatus Interface', () => {
  it('should validate connected server status', () => {
    const connectedStatus: MCPServerStatus = {
      serverId: 'jenkins',
      connected: true,
      lastConnected: new Date('2024-01-15T10:30:00Z'),
      toolCount: 5
    };

    expect(connectedStatus.serverId).toBe('jenkins');
    expect(connectedStatus.connected).toBe(true);
    expect(connectedStatus.lastConnected).toBeInstanceOf(Date);
    expect(connectedStatus.toolCount).toBe(5);
    expect(connectedStatus.lastError).toBeUndefined();
  });

  it('should validate disconnected server status with error', () => {
    const disconnectedStatus: MCPServerStatus = {
      serverId: 'github',
      connected: false,
      lastError: 'Connection timeout after 30 seconds',
      toolCount: 0
    };

    expect(disconnectedStatus.serverId).toBe('github');
    expect(disconnectedStatus.connected).toBe(false);
    expect(disconnectedStatus.lastError).toBe('Connection timeout after 30 seconds');
    expect(disconnectedStatus.toolCount).toBe(0);
    expect(disconnectedStatus.lastConnected).toBeUndefined();
  });

  it('should handle status transitions', () => {
    // Initial status
    let status: MCPServerStatus = {
      serverId: 'database',
      connected: false,
      toolCount: 0
    };

    expect(status.connected).toBe(false);

    // After successful connection
    status = {
      ...status,
      connected: true,
      lastConnected: new Date(),
      toolCount: 3,
      lastError: undefined
    };

    expect(status.connected).toBe(true);
    expect(status.toolCount).toBe(3);
    expect(status.lastError).toBeUndefined();

    // After connection failure
    status = {
      ...status,
      connected: false,
      lastError: 'Server crashed',
      toolCount: 0
    };

    expect(status.connected).toBe(false);
    expect(status.lastError).toBe('Server crashed');
    expect(status.toolCount).toBe(0);
  });
});

describe('MCPToolDiscovery Interface', () => {
  const mockTools: ToolDefinition[] = [
    {
      serverId: 'jenkins',
      name: 'trigger_job',
      description: 'Triggers a Jenkins job',
      inputSchema: {
        type: 'object',
        properties: {
          jobName: { type: 'string' },
          parameters: { type: 'object' }
        }
      }
    },
    {
      serverId: 'jenkins',
      name: 'get_build_status',
      description: 'Gets the status of a Jenkins build',
      inputSchema: {
        type: 'object',
        properties: {
          jobName: { type: 'string' },
          buildNumber: { type: 'number' }
        }
      }
    }
  ];

  it('should validate tool discovery result', () => {
    const discovery: MCPToolDiscovery = {
      serverId: 'jenkins',
      tools: mockTools,
      discoveredAt: new Date('2024-01-15T10:45:00Z')
    };

    expect(discovery.serverId).toBe('jenkins');
    expect(discovery.tools).toHaveLength(2);
    expect(discovery.tools[0].name).toBe('trigger_job');
    expect(discovery.tools[1].name).toBe('get_build_status');
    expect(discovery.discoveredAt).toBeInstanceOf(Date);
  });

  it('should handle empty tool discovery', () => {
    const emptyDiscovery: MCPToolDiscovery = {
      serverId: 'empty-server',
      tools: [],
      discoveredAt: new Date()
    };

    expect(emptyDiscovery.serverId).toBe('empty-server');
    expect(emptyDiscovery.tools).toHaveLength(0);
    expect(Array.isArray(emptyDiscovery.tools)).toBe(true);
  });

  it('should maintain tool serverId consistency', () => {
    const discovery: MCPToolDiscovery = {
      serverId: 'github',
      tools: [
        {
          serverId: 'github',
          name: 'create_issue',
          description: 'Creates a GitHub issue',
          inputSchema: {}
        },
        {
          serverId: 'github',
          name: 'update_pr',
          description: 'Updates a pull request',
          inputSchema: {}
        }
      ],
      discoveredAt: new Date()
    };

    expect(discovery.serverId).toBe('github');
    discovery.tools.forEach(tool => {
      expect(tool.serverId).toBe('github');
    });
  });

  it('should handle complex tool schemas', () => {
    const complexTools: ToolDefinition[] = [
      {
        serverId: 'database',
        name: 'execute_query',
        description: 'Executes a database query with parameters',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'SQL query to execute'
            },
            parameters: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  value: { type: ['string', 'number', 'boolean', 'null'] },
                  type: { type: 'string', enum: ['VARCHAR', 'INTEGER', 'BOOLEAN', 'DATE'] }
                },
                required: ['name', 'value']
              }
            },
            options: {
              type: 'object',
              properties: {
                timeout: { type: 'number', minimum: 1000, maximum: 300000 },
                maxRows: { type: 'number', minimum: 1, maximum: 10000 },
                transaction: { type: 'boolean', default: false }
              }
            }
          },
          required: ['query']
        },
        outputSchema: {
          type: 'object',
          properties: {
            rows: { type: 'array' },
            rowCount: { type: 'number' },
            executionTime: { type: 'number' },
            columns: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  type: { type: 'string' }
                }
              }
            }
          }
        }
      }
    ];

    const complexDiscovery: MCPToolDiscovery = {
      serverId: 'database',
      tools: complexTools,
      discoveredAt: new Date()
    };

    const tool = complexDiscovery.tools[0];
    expect(tool.inputSchema.properties.query.type).toBe('string');
    expect(tool.inputSchema.properties.parameters.type).toBe('array');
    expect(tool.inputSchema.required).toContain('query');
    expect(tool.outputSchema?.properties.rows.type).toBe('array');
  });

  it('should preserve discovery timestamp', () => {
    const fixedDate = new Date('2024-01-15T12:00:00Z');
    const discovery: MCPToolDiscovery = {
      serverId: 'test-server',
      tools: [],
      discoveredAt: fixedDate
    };

    expect(discovery.discoveredAt).toBe(fixedDate);
    expect(discovery.discoveredAt.toISOString()).toBe('2024-01-15T12:00:00.000Z');
  });
});