import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseActionItemsFromJson, runActionItemAgent } from './actionItemAgent.ts';

describe('ActionItemAgent - parseActionItemsFromJson', () => {
  it('parses lightweight structured JSON output with summary and action items', () => {
    const jsonStr = JSON.stringify({
      summary: 'Discussed Q3 roadmap and database migration.',
      actionItems: [
        {
          task: 'Migrate PostgreSQL schema',
          assignee: 'Alice',
          dueDate: '2026-08-20',
          quote: 'Alice will handle the PostgreSQL migration by next Friday.',
        },
      ],
    });

    const result = parseActionItemsFromJson(jsonStr);

    assert.strictEqual(result.summary, 'Discussed Q3 roadmap and database migration.');
    assert.strictEqual(result.actionItems.length, 1);
    assert.strictEqual(result.actionItems[0].task, 'Migrate PostgreSQL schema');
    assert.strictEqual(result.actionItems[0].assignee, 'Alice');
    assert.strictEqual(result.actionItems[0].dueDate, '2026-08-20');
    assert.strictEqual(result.actionItems[0].completed, false);
  });

  it('handles markdown ```json block wrappers', () => {
    const rawMarkdown = `
Here is the JSON response:
\`\`\`json
{
  "summary": "Meeting notes analysis",
  "actionItems": [
    {
      "task": "Update documentation",
      "assignee": "Bob"
    }
  ]
}
\`\`\`
    `.trim();

    const result = parseActionItemsFromJson(rawMarkdown);

    assert.strictEqual(result.summary, 'Meeting notes analysis');
    assert.strictEqual(result.actionItems.length, 1);
    assert.strictEqual(result.actionItems[0].task, 'Update documentation');
    assert.strictEqual(result.actionItems[0].assignee, 'Bob');
  });

  it('handles empty transcript gracefully in runActionItemAgent', async () => {
    const result = await runActionItemAgent({ transcript: '   ' });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.actionItems.length, 0);
    assert.match(result.error || '', /cannot be empty/i);
  });
});
