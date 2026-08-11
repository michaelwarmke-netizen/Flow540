import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseSuggestionsFromJson, runSuggestionsAgent } from './suggestionsAgent.ts';

describe('SuggestionsAgent - parseSuggestionsFromJson', () => {
  it('parses valid structured JSON output with summary and suggestions', () => {
    const jsonStr = JSON.stringify({
      summary: 'Team completed 80% of committed sprint velocity.',
      suggestions: [
        {
          title: 'Improve PR Review Turnaround',
          description: 'Establish 24h SLA for peer pull request reviews',
          basis: 'Metrics show 3 issues blocked on PR reviews',
          category: 'process',
          owner: 'Scrum Master',
          impact: 'high',
        },
      ],
    });

    const result = parseSuggestionsFromJson(jsonStr);

    assert.strictEqual(result.summary, 'Team completed 80% of committed sprint velocity.');
    assert.strictEqual(result.suggestions.length, 1);
    assert.strictEqual(result.suggestions[0].title, 'Improve PR Review Turnaround');
    assert.strictEqual(result.suggestions[0].owner, 'Scrum Master');
    assert.strictEqual(result.suggestions[0].category, 'process');
    assert.strictEqual(result.suggestions[0].impact, 'high');
  });

  it('handles markdown ```json block wrappers', () => {
    const rawMarkdown = `
Here are the suggestions:
\`\`\`json
{
  "summary": "Capacity gap identified",
  "suggestions": [
    {
      "title": "Adjust Sprint Commitment Threshold",
      "description": "Buffer 15% capacity for operational bug fixes",
      "basis": "Committed 40 points but completed 32 points"
    }
  ]
}
\`\`\`
    `.trim();

    const result = parseSuggestionsFromJson(rawMarkdown);

    assert.strictEqual(result.summary, 'Capacity gap identified');
    assert.strictEqual(result.suggestions.length, 1);
    assert.strictEqual(result.suggestions[0].title, 'Adjust Sprint Commitment Threshold');
  });

  it('handles empty options gracefully in runSuggestionsAgent', async () => {
    const result = await runSuggestionsAgent({});

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.suggestions.length, 0);
    assert.match(result.error || '', /must be provided/i);
  });
});
