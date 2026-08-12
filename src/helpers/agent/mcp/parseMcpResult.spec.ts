import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseMcpJsonResult } from './parseMcpResult.ts';
import type { McpCallToolResult } from './mcp.types.ts';

describe('parseMcpJsonResult', () => {
  it('parses valid JSON array from MCP text content block', () => {
    const mcpResult: McpCallToolResult = {
      content: [
        {
          type: 'text',
          text: JSON.stringify([
            { id: '1', name: 'Engineering', project_id: 'PROJ-ENG' },
            { id: '2', name: 'Product', project_id: 'PROJ-PROD' },
          ]),
        },
      ],
    };

    const parsed = parseMcpJsonResult<any[]>(mcpResult);
    assert.ok(Array.isArray(parsed));
    assert.equal(parsed.length, 2);
    assert.equal(parsed[0].name, 'Engineering');
    assert.equal(parsed[1].project_id, 'PROJ-PROD');
  });

  it('parses valid JSON object from MCP text content block', () => {
    const mcpResult: McpCallToolResult = {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ success: true, count: 5 }),
        },
      ],
    };

    const parsed = parseMcpJsonResult<{ success: boolean; count: number }>(mcpResult);
    assert.ok(parsed);
    assert.equal(parsed?.success, true);
    assert.equal(parsed?.count, 5);
  });

  it('returns null when isError is true', () => {
    const mcpResult: McpCallToolResult = {
      isError: true,
      content: [{ type: 'text', text: 'Internal Server Error' }],
    };

    const parsed = parseMcpJsonResult(mcpResult);
    assert.equal(parsed, null);
  });

  it('returns null when content contains invalid JSON', () => {
    const mcpResult: McpCallToolResult = {
      content: [{ type: 'text', text: 'Error: Connection timeout' }],
    };

    const parsed = parseMcpJsonResult(mcpResult);
    assert.equal(parsed, null);
  });

  it('returns null when content array is empty or undefined', () => {
    const parsed1 = parseMcpJsonResult({ content: [] });
    assert.equal(parsed1, null);

    const parsed2 = parseMcpJsonResult(null as any);
    assert.equal(parsed2, null);
  });
});
