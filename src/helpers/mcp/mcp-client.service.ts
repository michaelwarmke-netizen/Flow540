import { Inject, Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { AGENT_CONFIG, AgentConfig } from '../config/agent-config';
import { TokenService } from '../oauth/token.service';
import {
  JsonRpcRequest,
  JsonRpcResponse,
  McpCallToolResult,
  McpInitializeResult,
  MCP_PROTOCOL_VERSION,
  McpTool,
  McpToolsListResult,
} from './mcp.types';

/**
 * A thin MCP (Model Context Protocol) JSON-RPC client over stateless HTTP — exactly the
 * transport a hackathon team's agent uses. Every request carries a user-delegated OAuth
 * Bearer token from {@link TokenService} (the MCP server rejects M2M tokens).
 */
@Injectable()
export class McpClientService {
  private readonly logger = new Logger(McpClientService.name);
  private nextId = 1;
  private initialized = false;

  constructor(
    @Inject(AGENT_CONFIG) private readonly config: AgentConfig,
    private readonly tokens: TokenService,
  ) {}

  /** MCP handshake. Safe to call repeatedly — only the first call hits the wire. */
  async initialize(): Promise<McpInitializeResult> {
    const result = await this.rpc<McpInitializeResult>('initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'external-agent', version: '0.0.1' },
    });
    // Best-effort "initialized" notification (no response expected).
    await this.notify('notifications/initialized').catch((err) =>
      this.logger.debug(`initialized notification failed (non-fatal): ${String(err)}`),
    );
    this.initialized = true;
    return result;
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
    const token = await this.tokens.getAccessToken();
    return {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    };
  }
}