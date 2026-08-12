import { tool, jsonSchema } from 'ai';
import { z } from 'zod';
import type { McpClientService } from '../mcp/mcp-client.service.ts';
import type { McpTool } from '../mcp/mcp.types.ts';
import { Logger } from '../../logger.ts';

const logger = new Logger('McpToolBridge');

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
 * Sanitizes and cleans up raw JSON schema from MCP servers.
 * Strips `$schema` and injects fallback parameters if properties are empty.
 */
function cleanJsonSchema(rawSchema?: Record<string, unknown>): Record<string, unknown> {
  if (!rawSchema || typeof rawSchema !== 'object') {
    return {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Notification message or body text' },
        recipient: { type: 'string', description: 'Recipient name, email, or channel' },
        channel: { type: 'string', description: 'Delivery channel e.g. slack or email' },
      },
    };
  }

  const cleaned: Record<string, unknown> = { ...rawSchema };
  delete cleaned['$schema'];

  if (!cleaned.type) {
    cleaned.type = 'object';
  }

  if (
    !cleaned.properties ||
    typeof cleaned.properties !== 'object' ||
    Object.keys(cleaned.properties as object).length === 0
  ) {
    cleaned.properties = {
      message: { type: 'string', description: 'Notification message or content' },
      recipient: { type: 'string', description: 'Target recipient or channel' },
      channel: { type: 'string', description: 'Delivery channel' },
      subject: { type: 'string', description: 'Email subject line' },
    };
  }

  return cleaned;
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
    const cleanedSchema = cleanJsonSchema(t.inputSchema);
    logger.info(`Bridged MCP tool '${t.name}' schema:\n${JSON.stringify(cleanedSchema, null, 2)}`);

    bridged[t.name] = (tool as any)({
      description: t.description ?? `MCP Tool: ${t.name}`,
      parameters: jsonSchema(cleanedSchema as any),
      execute: async (args: any) => {
        logger.info(`Executing tool '${t.name}' with args:\n${JSON.stringify(args, null, 2)}`);
        try {
          const res = await mcpClient.callTool(t.name, (args ?? {}) as Record<string, unknown>);
          if (res.isError) {
            const errMsg = res.content.map((c) => c.text ?? JSON.stringify(c)).join('\n');
            logger.error(`Tool '${t.name}' returned error response:\n${errMsg}`);
            throw new Error(errMsg);
          }
          const outputText = res.content
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

          logger.info(`Tool '${t.name}' executed successfully. Output snippet:\n${outputText.slice(0, 500)}`);
          return outputText;
        } catch (err: any) {
          logger.error(`Tool '${t.name}' execution throw error: ${err?.message || err}`);
          throw err;
        }
      },
    });
  }

  return bridged;
}
