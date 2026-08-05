/** Minimal MCP / JSON-RPC 2.0 types for the tools the agent exercises. */

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string;
  method: string;
  params?: unknown;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id: number | string;
  result?: T;
  error?: JsonRpcError;
}

export interface McpTool {
  name: string;
  description?: string;
  /** JSON Schema for the tool's arguments. */
  inputSchema?: Record<string, unknown>;
}

export interface McpToolsListResult {
  tools: McpTool[];
}

export interface McpContentBlock {
  type: string;
  text?: string;
  [key: string]: unknown;
}

export interface McpCallToolResult {
  content: McpContentBlock[];
  isError?: boolean;
}

export interface McpInitializeResult {
  protocolVersion: string;
  capabilities?: Record<string, unknown>;
  serverInfo?: { name?: string; version?: string };
}

export const MCP_PROTOCOL_VERSION = '2024-11-05';