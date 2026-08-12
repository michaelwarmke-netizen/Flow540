import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RetroRepository } from '../../retroRepository.js';
import { parseMcpJsonResult } from '../mcp/parseMcpResult.ts';
import type { McpCallToolResult } from '../mcp/mcp.types.ts';

function createMockDb() {
  const store = new Map<string, any>();

  return {
    store,
    pragma() {
      return 10;
    },
    prepare(sql: string) {
      if (sql.includes('INSERT INTO projects')) {
        return {
          run(id: string, name: string, project_id: string, slack_channel_id: string, description: string) {
            const existingKey = Array.from(store.keys()).find((k) => store.get(k).project_id === project_id);
            const keyToUse = existingKey || id;
            const existingObj = store.get(keyToUse) || {};
            store.set(keyToUse, {
              ...existingObj,
              id: keyToUse,
              name,
              project_id,
              slack_channel_id: slack_channel_id || existingObj.slack_channel_id || '',
              description,
              notification_settings: existingObj.notification_settings || '{}',
              updated_at: new Date().toISOString(),
            });
            return { changes: 1 };
          },
        };
      }
      if (sql.includes('SELECT * FROM projects ORDER BY name ASC')) {
        return {
          all() {
            return Array.from(store.values()).sort((a, b) => a.name.localeCompare(b.name));
          },
        };
      }
      return {
        run() {
          return { changes: 0 };
        },
        all() {
          return [];
        },
        get() {
          return null;
        },
      };
    },
    transaction(fn: () => void) {
      return () => fn();
    },
  };
}

describe('Project MCP Sync Integration', () => {
  it('upserts projects returned from MCP server into repository', async () => {
    const mockDb = createMockDb();
    const repo = new RetroRepository(mockDb as any);

    const mcpProjects = [
      {
        id: 'proj-uuid-1',
        name: 'GenEng Team',
        project_id: 'PROJ-GENENG',
        slack_channel_id: 'C123456',
        description: 'General Engineering Team',
      },
      {
        name: 'Payments Platform',
        project_id: 'PROJ-PAYMENTS',
        slack_channel_id: 'C654321',
        description: 'Core Payments Services',
      },
    ];

    const result = await repo.upsertProjectsFromMcp(mcpProjects);
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 2);

    const geneng = result.find((p: any) => p.project_id === 'PROJ-GENENG');
    assert.ok(geneng);
    assert.equal(geneng.name, 'GenEng Team');
    assert.equal(geneng.slack_channel_id, 'C123456');

    const payments = result.find((p: any) => p.project_id === 'PROJ-PAYMENTS');
    assert.ok(payments);
    assert.equal(payments.name, 'Payments Platform');
  });

  it('updates existing project attributes while preserving notification_settings', async () => {
    const mockDb = createMockDb();
    const repo = new RetroRepository(mockDb as any);

    // Initial project
    mockDb.store.set('proj-1', {
      id: 'proj-1',
      name: 'Old Name',
      project_id: 'PROJ-GENENG',
      slack_channel_id: 'C_OLD',
      description: 'Old description',
      notification_settings: JSON.stringify({ preRetroPreview: { enabled: false } }),
    });

    // Sync from MCP server with updated name and channel
    const mcpProjects = [
      {
        project_id: 'PROJ-GENENG',
        name: 'New Refreshed Name',
        slack_channel_id: 'C_NEW',
        description: 'Updated description from MCP',
      },
    ];

    const updatedList = await repo.upsertProjectsFromMcp(mcpProjects);
    assert.equal(updatedList.length, 1);

    const updated = updatedList[0];
    assert.equal(updated.name, 'New Refreshed Name');
    assert.equal(updated.slack_channel_id, 'C_NEW');
    assert.equal(updated.description, 'Updated description from MCP');

    // Verify notification_settings were preserved
    const parsedSettings = JSON.parse(updated.notification_settings);
    assert.equal(parsedSettings.preRetroPreview.enabled, false);
  });

  it('handles MCP response parsing and error fallbacks gracefully', () => {
    const validMcpResult: McpCallToolResult = {
      content: [
        {
          type: 'text',
          text: JSON.stringify([
            { name: 'Alpha Team', project_id: 'PROJ-ALPHA' },
          ]),
        },
      ],
    };

    const projects = parseMcpJsonResult<any[]>(validMcpResult);
    assert.ok(Array.isArray(projects));
    assert.equal(projects.length, 1);
    assert.equal(projects[0].project_id, 'PROJ-ALPHA');

    const invalidResult: McpCallToolResult = {
      isError: true,
      content: [{ type: 'text', text: '500 Server Error' }],
    };

    const emptyProjects = parseMcpJsonResult(invalidResult);
    assert.equal(emptyProjects, null);
  });
});
