import type { McpCallToolResult } from './mcp.types.ts';

/**
 * Extracts and JSON-parses the first text content block from an MCP tool result.
 * Returns null if the result is an error, empty, or unparseable.
 */
export function parseMcpJsonResult<T>(result: McpCallToolResult): T | null {
  if (!result || result.isError || !Array.isArray(result.content)) {
    return null;
  }

  for (const block of result.content) {
    if (block && block.type === 'text' && typeof block.text === 'string') {
      const trimmed = block.text.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          return JSON.parse(trimmed) as T;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
