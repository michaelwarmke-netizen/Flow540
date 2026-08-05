import axios from 'axios';
import type { AgentConfig } from '../config/agent-config.ts';
import { loadAgentConfig } from '../config/agent-config.ts';
import { Logger } from '../../logger.ts';
import { NeedsLoginError, TokenService } from '../oauth/token.service.ts';
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  McpCallToolResult,
  McpInitializeResult,
  McpTool,
  McpToolsListResult,
} from './mcp.types.ts';
import { MCP_PROTOCOL_VERSION } from './mcp.types.ts';

/**
 * A thin MCP (Model Context Protocol) JSON-RPC client over HTTP.
 * Every request carries a user-delegated OAuth Bearer token from {@link TokenService} if available.
 */
export class McpClientService {
  private readonly logger = new Logger(McpClientService.name);
  private nextId = 1;
  private initialized = false;
  private readonly config: AgentConfig;
  private readonly tokens: TokenService;

  constructor(
    config: AgentConfig = loadAgentConfig(),
    tokens: TokenService = new TokenService(config),
  ) {
    this.config = config;
    this.tokens = tokens;
  }

  /** MCP handshake. Safe to call repeatedly — only the first call hits the wire. */
  async initialize(): Promise<McpInitializeResult> {
    const result = await this.rpc<McpInitializeResult>('initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'openwhispr-agent', version: '1.7.6' },
    });
    // Best-effort "initialized" notification (no response expected).
    await this.notify('notifications/initialized').catch((err) =>
      this.logger.debug(`initialized notification failed (non-fatal): ${String(err)}`),
    );
    this.initialized = true;
    return result;
  }

  /** Reset initialization status so the client re-handshakes against updated server URLs. */
  reset(): void {
    this.initialized = false;
  }

  async listTools(): Promise<McpTool[]> {
    if (!this.initialized) await this.initialize();
    const result = await this.rpc<McpToolsListResult>('tools/list');
    return result.tools ?? [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpCallToolResult> {
    if (!this.initialized) await this.initialize();
    return this.rpc<McpCallToolResult>('tools/call', { name, arguments: args });
  }

  // ── transport ────────────────────────────────────────────────────────────────

  private async rpc<T>(method: string, params?: unknown): Promise<T> {
    const id = this.nextId++;
    const body: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };
    const { data } = await axios.post<JsonRpcResponse<T>>(this.config.mcpServerUrl, body, {
      headers: await this.headers(),
    });
    if (data.error) {
      throw new Error(`MCP ${method} failed: [${data.error.code}] ${data.error.message}`);
    }
    return data.result as T;
  }

  private async notify(method: string, params?: unknown): Promise<void> {
    const body: JsonRpcRequest = { jsonrpc: '2.0', method, params };
    await axios.post(this.config.mcpServerUrl, body, { headers: await this.headers() });
  }

  private async headers(): Promise<Record<string, string>> {
    const reqHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    try {
      const token = await this.tokens.getAccessToken();
      if (token) {
        reqHeaders['Authorization'] = `Bearer ${token}`;
      }
    } catch (err) {
      if (err instanceof NeedsLoginError) {
        const isLocal =
          this.config.mcpServerUrl.includes('localhost') ||
          this.config.mcpServerUrl.includes('127.0.0.1');
        const hasOAuthClient = Boolean(this.config.oauth.clientId);

        if (isLocal || !hasOAuthClient) {
          this.logger.debug('No cached OAuth token; attempting unauthenticated request to local/unconfigured MCP server.');
          return reqHeaders;
        }
      }
      throw err;
    }
    return reqHeaders;
  }
}
