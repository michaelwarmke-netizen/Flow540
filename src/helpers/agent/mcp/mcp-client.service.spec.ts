import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import axios from 'axios';
import type { AgentConfig } from '../config/agent-config.ts';
import { TokenService } from '../oauth/token.service.ts';
import { McpClientService } from './mcp-client.service.ts';

function makeConfig(): AgentConfig {
  const llm = {
    provider: 'gemini',
    apiKey: 'k',
    model: 'gemini-2.5-flash',
    maxToolTurns: 8,
    maxOutputTokens: 4096,
  };
  return {
    port: 3540,
    mcpServerUrl: 'https://mcp.example.test',
    tokenStorePath: '/tmp/t.json',
    oauth: {
      issuer: 'https://api.example.test',
      redirectUri: 'http://localhost:3540/oauth/callback',
      clientId: 'c',
      clientSecret: 's',
      scopes: 'openid offline_access',
    },
    llm,
    gemini: llm,
  };
}

const tokens = { getAccessToken: async () => 'at-1' } as TokenService;

function rpcOk<T>(result: T) {
  return { data: { jsonrpc: '2.0', id: 1, result } };
}

describe('McpClientService', () => {
  it('lists tools after performing the initialize handshake', async () => {
    let postCallCount = 0;
    let lastPostArgs: any[] = [];
    mock.method(axios, 'post', async (...args: any[]) => {
      postCallCount++;
      lastPostArgs = args;
      if (postCallCount === 1) return rpcOk({ protocolVersion: '2024-11-05' });
      if (postCallCount === 2) return { data: {} };
      return rpcOk({ tools: [{ name: 'thrive_list_campaigns' }] });
    });

    const svc = new McpClientService(makeConfig(), tokens);
    const tools = await svc.listTools();

    assert.deepStrictEqual(tools.map((t) => t.name), ['thrive_list_campaigns']);
    assert.equal(lastPostArgs[0], 'https://mcp.example.test');
    assert.equal(lastPostArgs[1].method, 'tools/list');
    assert.equal(lastPostArgs[2].headers.Authorization, 'Bearer at-1');
  });

  it('calls a tool with name + arguments', async () => {
    let postCallCount = 0;
    let lastPostArgs: any[] = [];
    mock.method(axios, 'post', async (...args: any[]) => {
      postCallCount++;
      lastPostArgs = args;
      if (postCallCount === 1) return rpcOk({ protocolVersion: '2024-11-05' });
      if (postCallCount === 2) return { data: {} };
      return rpcOk({ content: [{ type: 'text', text: '[]' }] });
    });

    const svc = new McpClientService(makeConfig(), tokens);
    const result = await svc.callTool('thrive_campaign_report', { campaignId: 'c1' });

    assert.equal(result.content[0].text, '[]');
    assert.equal(lastPostArgs[0], 'https://mcp.example.test');
    assert.equal(lastPostArgs[1].method, 'tools/call');
    assert.deepStrictEqual(lastPostArgs[1].params, { name: 'thrive_campaign_report', arguments: { campaignId: 'c1' } });
  });

  it('throws when the server returns a JSON-RPC error', async () => {
    mock.method(axios, 'post', async () => ({
      data: { jsonrpc: '2.0', id: 1, error: { code: -32001, message: 'unauthorized' } },
    }));
    const svc = new McpClientService(makeConfig(), tokens);
    await assert.rejects(async () => svc.initialize(), /unauthorized/);
  });
});
