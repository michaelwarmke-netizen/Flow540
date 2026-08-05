import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveAgentModel } from './agentProviderResolver.ts';
import { bridgeMcpToolList } from './mcpToolBridge.ts';
import { AgentSessionManager } from './agentSessionManager.ts';
import type { McpTool } from '../mcp/mcp.types.ts';

describe('resolveAgentModel', () => {
  it('resolves a Gemini model by default', () => {
    const model = resolveAgentModel({ provider: 'gemini', model: 'gemini-2.5-flash', apiKey: 'test-key' });
    assert.ok(model);
    assert.equal((model as any).modelId, 'gemini-2.5-flash');
  });

  it('resolves a local model with OpenAI-compatible endpoint', () => {
    const model = resolveAgentModel({ provider: 'local', model: 'llama3', baseUrl: 'http://localhost:11434/v1' });
    assert.ok(model);
    assert.equal((model as any).modelId, 'llama3');
  });

  it('resolves Anthropic Claude model', () => {
    const model = resolveAgentModel({ provider: 'anthropic', model: 'claude-3-5-sonnet', apiKey: 'test-key' });
    assert.ok(model);
    assert.equal((model as any).modelId, 'claude-3-5-sonnet');
  });
});

describe('bridgeMcpToolList', () => {
  it('converts McpTool array into Vercel AI SDK tools', () => {
    const mockMcpTools: McpTool[] = [
      {
        name: 'test_tool',
        description: 'A test tool',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string' } },
        },
      },
    ];

    const mockMcpClient = {
      callTool: async (name: string, args: Record<string, unknown>) => ({
        content: [{ type: 'text', text: `Result for ${name} with args ${JSON.stringify(args)}` }],
      }),
    } as any;

    const bridged = bridgeMcpToolList(mockMcpTools, mockMcpClient);
    assert.ok(bridged.test_tool);
  });
});

describe('AgentSessionManager', () => {
  it('manages sessions and session metadata', () => {
    const manager = new AgentSessionManager();
    const sessions = manager.listSessions();
    assert.deepStrictEqual(sessions, []);
  });
});
