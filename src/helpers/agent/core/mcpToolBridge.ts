import { tool } from 'ai';
import { z } from 'zod';
import type { McpClientService } from '../mcp/mcp-client.service.ts';
import type { McpTool } from '../mcp/mcp.types.ts';

/**
 * Bridges tools discovered from an {@link McpClientService} into Vercel AI SDK
 * tool definitions compatible with `generateText({ tools })`.
 */
export async function createAiSdkToolsFromMcp(
  mcpClient: McpClientService,
): Promise<Record<string, any>> {
  const tools = await mcpClient.listTools();
  return bridgeMcpToolList(tools, mcpClient);
}

/**
 * Converts a list of {@link McpTool} definitions into Vercel AI SDK tools.
 */
export function bridgeMcpToolList(
  tools: McpTool[],
  mcpClient: McpClientService,
): Record<string, any> {
  const bridged: Record<string, any> = {};

  for (const t of tools) {
    bridged[t.name] = (tool as any)(t.name, {
      description: t.description ?? `MCP Tool: ${t.name}`,
      parameters: z.record(z.string(), z.unknown()),
      execute: async (args: any) => {
        const res = await mcpClient.callTool(t.name, (args ?? {}) as Record<string, unknown>);
        if (res.isError) {
          throw new Error(res.content.map((c) => c.text ?? JSON.stringify(c)).join('\n'));
        }
        return res.content.map((c) => c.text ?? JSON.stringify(c)).join('\n');
      },
    });
  }

  return bridged;
}
