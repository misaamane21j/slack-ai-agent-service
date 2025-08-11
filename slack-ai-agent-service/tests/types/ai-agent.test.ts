import { AIAgentResponse, ToolDefinition, ToolInvocationResult, ValidationResult } from '../../src/types/ai-agent';

describe('AIAgentResponse Interface', () => {
  describe('type validation', () => {
    it('should validate tool_invocation response structure', () => {
      const response: AIAgentResponse = {
        intent: 'tool_invocation',
        confidence: 0.9,
        tool: {
          serverId: 'jenkins',
          toolName: 'trigger_job',
          parameters: { jobName: 'deploy-app', branch: 'main' }
        },
        reasoning: 'User wants to deploy the application'
      };

      expect(response.intent).toBe('tool_invocation');
      expect(response.confidence).toBe(0.9);
      expect(response.tool?.serverId).toBe('jenkins');
      expect(response.tool?.toolName).toBe('trigger_job');
      expect(response.tool?.parameters).toEqual({ jobName: 'deploy-app', branch: 'main' });
      expect(response.reasoning).toBe('User wants to deploy the application');
    });

    it('should validate clarification_needed response structure', () => {
      const response: AIAgentResponse = {
        intent: 'clarification_needed',
        confidence: 0.6,
        message: 'Could you specify which environment to deploy to?',
        reasoning: 'Deployment target is ambiguous'
      };

      expect(response.intent).toBe('clarification_needed');
      expect(response.confidence).toBe(0.6);
      expect(response.tool).toBeUndefined();
      expect(response.message).toBe('Could you specify which environment to deploy to?');
      expect(response.reasoning).toBe('Deployment target is ambiguous');
    });

    it('should validate general_conversation response structure', () => {
      const response: AIAgentResponse = {
        intent: 'general_conversation',
        confidence: 0.8,
        message: 'Hello! I can help you with Jenkins deployments, GitHub issues, and database queries.',
        reasoning: 'User is greeting the bot'
      };

      expect(response.intent).toBe('general_conversation');
      expect(response.confidence).toBe(0.8);
      expect(response.tool).toBeUndefined();
      expect(response.message).toBe('Hello! I can help you with Jenkins deployments, GitHub issues, and database queries.');
      expect(response.reasoning).toBe('User is greeting the bot');
    });

    it('should allow optional fields to be undefined', () => {
      const minimalResponse: AIAgentResponse = {
        intent: 'general_conversation',
        confidence: 0.5
      };

      expect(minimalResponse.intent).toBe('general_conversation');
      expect(minimalResponse.confidence).toBe(0.5);
      expect(minimalResponse.tool).toBeUndefined();
      expect(minimalResponse.message).toBeUndefined();
      expect(minimalResponse.reasoning).toBeUndefined();
    });
  });

  describe('intent type validation', () => {
    it('should accept valid intent values', () => {
      const validIntents: AIAgentResponse['intent'][] = [
        'tool_invocation',
        'clarification_needed',
        'general_conversation'
      ];

      validIntents.forEach(intent => {
        const response: AIAgentResponse = {
          intent,
          confidence: 0.8
        };
        expect(response.intent).toBe(intent);
      });
    });
  });

  describe('confidence validation', () => {
    it('should accept confidence values between 0 and 1', () => {
      const validConfidences = [0, 0.1, 0.5, 0.9, 1.0];

      validConfidences.forEach(confidence => {
        const response: AIAgentResponse = {
          intent: 'general_conversation',
          confidence
        };
        expect(response.confidence).toBe(confidence);
      });
    });
  });
});

describe('ToolDefinition Interface', () => {
  it('should validate complete tool definition', () => {
    const toolDefinition: ToolDefinition = {
      serverId: 'jenkins',
      name: 'trigger_jenkins_job',
      description: 'Triggers a Jenkins job with specified parameters',
      inputSchema: {
        type: 'object',
        properties: {
          jobName: { type: 'string', description: 'Name of the Jenkins job' },
          parameters: { type: 'object', description: 'Job parameters' }
        },
        required: ['jobName']
      },
      outputSchema: {
        type: 'object',
        properties: {
          buildNumber: { type: 'number' },
          status: { type: 'string' }
        }
      }
    };

    expect(toolDefinition.serverId).toBe('jenkins');
    expect(toolDefinition.name).toBe('trigger_jenkins_job');
    expect(toolDefinition.description).toBe('Triggers a Jenkins job with specified parameters');
    expect(toolDefinition.inputSchema.type).toBe('object');
    expect(toolDefinition.outputSchema?.type).toBe('object');
  });

  it('should allow minimal tool definition', () => {
    const minimalTool: ToolDefinition = {
      serverId: 'github',
      name: 'create_issue',
      description: 'Creates a GitHub issue',
      inputSchema: {}
    };

    expect(minimalTool.serverId).toBe('github');
    expect(minimalTool.name).toBe('create_issue');
    expect(minimalTool.outputSchema).toBeUndefined();
  });

  it('should handle complex input schemas', () => {
    const complexTool: ToolDefinition = {
      serverId: 'database',
      name: 'complex_query',
      description: 'Executes complex database queries',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          parameters: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                value: { type: ['string', 'number', 'boolean'] }
              }
            }
          },
          options: {
            type: 'object',
            properties: {
              timeout: { type: 'number', minimum: 1000 },
              maxRows: { type: 'number', minimum: 1, maximum: 10000 }
            }
          }
        },
        required: ['query']
      }
    };

    expect(complexTool.inputSchema.properties.parameters.type).toBe('array');
    expect(complexTool.inputSchema.required).toEqual(['query']);
  });
});

describe('ToolInvocationResult Interface', () => {
  it('should validate successful result', () => {
    const successResult: ToolInvocationResult = {
      success: true,
      data: {
        buildNumber: 42,
        status: 'SUCCESS',
        duration: 120000
      },
      executionTime: 5000
    };

    expect(successResult.success).toBe(true);
    expect(successResult.data).toBeDefined();
    expect(successResult.error).toBeUndefined();
    expect(successResult.executionTime).toBe(5000);
  });

  it('should validate failure result', () => {
    const failureResult: ToolInvocationResult = {
      success: false,
      error: 'Jenkins server is unreachable',
      executionTime: 30000
    };

    expect(failureResult.success).toBe(false);
    expect(failureResult.error).toBe('Jenkins server is unreachable');
    expect(failureResult.data).toBeUndefined();
    expect(failureResult.executionTime).toBe(30000);
  });

  it('should allow minimal result structure', () => {
    const minimalResult: ToolInvocationResult = {
      success: false
    };

    expect(minimalResult.success).toBe(false);
    expect(minimalResult.data).toBeUndefined();
    expect(minimalResult.error).toBeUndefined();
    expect(minimalResult.executionTime).toBeUndefined();
  });

  it('should handle various data types', () => {
    const stringDataResult: ToolInvocationResult = {
      success: true,
      data: 'Tool executed successfully'
    };

    const arrayDataResult: ToolInvocationResult = {
      success: true,
      data: [
        { id: 1, name: 'Item 1' },
        { id: 2, name: 'Item 2' }
      ]
    };

    const numberDataResult: ToolInvocationResult = {
      success: true,
      data: 42
    };

    expect(typeof stringDataResult.data).toBe('string');
    expect(Array.isArray(arrayDataResult.data)).toBe(true);
    expect(typeof numberDataResult.data).toBe('number');
  });
});

describe('ValidationResult Interface', () => {
  it('should validate successful validation result', () => {
    const validResult: ValidationResult = {
      valid: true,
      errors: [],
      sanitized: {
        jobName: 'deploy-app',
        branch: 'main',
        environment: 'production'
      }
    };

    expect(validResult.valid).toBe(true);
    expect(validResult.errors).toEqual([]);
    expect(validResult.sanitized).toBeDefined();
    expect(validResult.sanitized?.jobName).toBe('deploy-app');
  });

  it('should validate failed validation result', () => {
    const invalidResult: ValidationResult = {
      valid: false,
      errors: [
        'jobName is required',
        'branch contains invalid characters',
        'environment must be one of: development, staging, production'
      ]
    };

    expect(invalidResult.valid).toBe(false);
    expect(invalidResult.errors).toHaveLength(3);
    expect(invalidResult.sanitized).toBeUndefined();
  });

  it('should allow empty errors array for valid results', () => {
    const validWithoutSanitized: ValidationResult = {
      valid: true,
      errors: []
    };

    expect(validWithoutSanitized.valid).toBe(true);
    expect(validWithoutSanitized.errors).toEqual([]);
    expect(validWithoutSanitized.sanitized).toBeUndefined();
  });

  it('should handle complex sanitized data', () => {
    const complexValidation: ValidationResult = {
      valid: true,
      errors: [],
      sanitized: {
        user: {
          id: 123,
          name: 'John Doe',
          permissions: ['read', 'write']
        },
        metadata: {
          timestamp: new Date().toISOString(),
          source: 'slack-bot'
        }
      }
    };

    expect(complexValidation.sanitized?.user.name).toBe('John Doe');
    expect(Array.isArray(complexValidation.sanitized?.user.permissions)).toBe(true);
  });
});

describe('Interface Compatibility', () => {
  it('should maintain compatibility with existing Jenkins response formats', () => {
    // Test that AIAgentResponse can represent legacy Jenkins responses
    const legacyJenkinsResponse: AIAgentResponse = {
      intent: 'tool_invocation',
      confidence: 0.9,
      tool: {
        serverId: 'jenkins',
        toolName: 'trigger_jenkins_job',
        parameters: {
          jobName: 'deploy-application',
          branch: 'main',
          environment: 'production',
          parameters: {
            VERSION: '1.2.3',
            DEPLOY_TARGET: 'k8s-cluster'
          }
        }
      },
      message: 'Triggering Jenkins deployment job',
      reasoning: 'User requested application deployment to production'
    };

    expect(legacyJenkinsResponse.tool?.serverId).toBe('jenkins');
    expect(legacyJenkinsResponse.tool?.parameters.jobName).toBe('deploy-application');
    expect(legacyJenkinsResponse.tool?.parameters.parameters.VERSION).toBe('1.2.3');
  });

  it('should support future MCP server types', () => {
    // Test extensibility for future server types
    const futureServerResponse: AIAgentResponse = {
      intent: 'tool_invocation',
      confidence: 0.85,
      tool: {
        serverId: 'kubernetes',
        toolName: 'apply_manifest',
        parameters: {
          namespace: 'production',
          manifest: 'deployment.yaml',
          dryRun: false
        }
      },
      reasoning: 'User wants to deploy Kubernetes resources'
    };

    expect(futureServerResponse.tool?.serverId).toBe('kubernetes');
    expect(futureServerResponse.tool?.parameters.namespace).toBe('production');
  });
});