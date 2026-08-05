import axios from 'axios';
import { AgentConfig } from '../config/agent-config';
import { TokenService } from '../oauth/token.service';
import { McpClientService } from './mcp-client.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

function makeConfig(): AgentConfig {
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
    gemini: { apiKey: 'k', model: 'm', maxToolTurns: 8, maxOutputTokens: 4096 },
  };
}

const tokens = { getAccessToken: jest.fn().mockResolvedValue('at-1') } as unknown as TokenService;

function rpcOk<T>(result: T) {
  return { data: { jsonrpc: '2.0', id: 1, result } };
}

describe('McpClientService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('lists tools after performing the initialize handshake', async () => {
    mockedAxios.post
      .mockResolvedValueOnce(rpcOk({ protocolVersion: '2024-11-05' })) // initialize
      .mockResolvedValueOnce({ data: {} }) // notifications/initialized
      .mockResolvedValueOnce(rpcOk({ tools: [{ name: 'thrive_list_campaigns' }] })); // tools/list

    const svc = new McpClientService(makeConfig(), tokens);
    const tools = await svc.listTools();

    expect(tools.map((t) => t.name)).toEqual(['thrive_list_campaigns']);
    // every request carries the bearer token
    expect(mockedAxios.post).toHaveBeenLastCalledWith(
      'https://mcp.example.test',
      expect.objectContaining({ method: 'tools/list' }),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer at-1' }) }),
    );
  });

  it('calls a tool with name + arguments', async () => {
    mockedAxios.post
      .mockResolvedValueOnce(rpcOk({ protocolVersion: '2024-11-05' }))
      .mockResolvedValueOnce({ data: {} })
      .mockResolvedValueOnce(rpcOk({ content: [{ type: 'text', text: '[]' }] }));

    const svc = new McpClientService(makeConfig(), tokens);
    const result = await svc.callTool('thrive_campaign_report', { campaignId: 'c1' });

    expect(result.content[0].text).toBe('[]');
    expect(mockedAxios.post).toHaveBeenLastCalledWith(
      'https://mcp.example.test',
      expect.objectContaining({
        method: 'tools/call',
        params: { name: 'thrive_campaign_report', arguments: { campaignId: 'c1' } },
      }),
      expect.anything(),
    );
  });

  it('throws when the server returns a JSON-RPC error', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: { jsonrpc: '2.0', id: 1, error: { code: -32001, message: 'unauthorized' } },
    });
    const svc = new McpClientService(makeConfig(), tokens);
    await expect(svc.initialize()).rejects.toThrow(/unauthorized/);
  });
});