import assert from 'node:assert';
import { describe, it } from 'node:test';
import { parseTopicCoverageFromJson } from './topicCoverageAgent.ts';

describe('parseTopicCoverageFromJson', () => {
  it('parses valid JSON response correctly', () => {
    const raw = JSON.stringify({
      topicCoverageScore: 85,
      topics: [
        { topicId: 'topic-1', title: 'Supplier Fastener Quality', status: 'discussed', evidenceQuote: 'Replaced nonconforming lot' },
        { topicId: 'topic-2', title: 'Exhaust Vent Audit', status: 'partially_discussed', evidenceQuote: 'Reviewed structural collars' }
      ]
    });

    const topics = [
      { id: 'topic-1', title: 'Supplier Fastener Quality' },
      { id: 'topic-2', title: 'Exhaust Vent Audit' }
    ];

    const result = parseTopicCoverageFromJson(raw, topics);
    assert.strictEqual(result.topicCoverageScore, 85);
    assert.strictEqual(result.topics.length, 2);
    assert.strictEqual(result.topics[0].status, 'discussed');
    assert.strictEqual(result.topics[1].status, 'partially_discussed');
  });

  it('handles markdown code block wrappers', () => {
    const raw = "```json\n" + JSON.stringify({
      topicCoverageScore: 100,
      topics: [
        { topicId: 't-1', title: 'Test Topic', status: 'discussed', evidenceQuote: 'Quote' }
      ]
    }) + "\n```";

    const result = parseTopicCoverageFromJson(raw, [{ id: 't-1', title: 'Test Topic' }]);
    assert.strictEqual(result.topicCoverageScore, 100);
    assert.strictEqual(result.topics[0].status, 'discussed');
  });

  it('falls back gracefully on malformed JSON', () => {
    const raw = 'Invalid JSON text';
    const topics = [{ id: 't-1', title: 'Topic 1' }];
    const result = parseTopicCoverageFromJson(raw, topics);
    assert.strictEqual(result.topicCoverageScore, 0);
    assert.strictEqual(result.topics[0].status, 'missed');
  });
});
