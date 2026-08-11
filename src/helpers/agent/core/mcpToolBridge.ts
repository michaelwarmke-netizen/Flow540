import { tool, jsonSchema } from 'ai';
import { z } from 'zod';
import type { McpClientService } from '../mcp/mcp-client.service.ts';
import type { McpTool } from '../mcp/mcp.types.ts';

/**
 * Bridges tools discovered from an {@link McpClientService} into Vercel AI SDK
 * tool definitions compatible with `generateText({ tools })` or `ToolLoopAgent`.
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
    const parameters =
      t.inputSchema && typeof t.inputSchema === 'object' && Object.keys(t.inputSchema).length > 0
        ? jsonSchema(t.inputSchema as any)
        : z.record(z.string(), z.unknown());

    bridged[t.name] = tool({
      description: t.description ?? `MCP Tool: ${t.name}`,
      parameters,
      execute: async (args: any) => {
        const res = await mcpClient.callTool(t.name, (args ?? {}) as Record<string, unknown>);
        if (res.isError) {
          throw new Error(res.content.map((c) => c.text ?? JSON.stringify(c)).join('\n'));
        }
        return res.content
          .map((c) => {
            if (c.type === 'text' && typeof c.text === 'string') {
              const trimmed = c.text.trim();
              if (
                (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
                (trimmed.startsWith('[') && trimmed.endsWith(']'))
              ) {
                try {
                  return JSON.stringify(JSON.parse(trimmed), null, 2);
                } catch (_) {}
              }
              return c.text;
            }
            return JSON.stringify(c);
          })
          .join('\n\n');
      },
    });
  }

  return bridged;
}
