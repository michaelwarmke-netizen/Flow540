import assert from "node:assert";
import { describe, it } from "node:test";
import { calculateSpeakerBalance } from "./transcriptAnalytics.ts";

describe("calculateSpeakerBalance", () => {
  it("returns null for empty or null transcripts", () => {
    assert.strictEqual(calculateSpeakerBalance(null), null);
    assert.strictEqual(calculateSpeakerBalance(""), null);
    assert.strictEqual(calculateSpeakerBalance("   \n\n  "), null);
  });

  it("returns null when no speaker tags are detected", () => {
    const text = "This is a paragraph without any speaker prefixes.\nJust text on multiple lines.";
    assert.strictEqual(calculateSpeakerBalance(text), null);
  });

  it("returns 100 for a single speaker", () => {
    const text = "Alice: Hello everyone.\nAlice: Today we discuss sprint items.";
    const result = calculateSpeakerBalance(text);
    assert.notStrictEqual(result, null);
    assert.strictEqual(result!.score, 100);
    assert.strictEqual(result!.speakers.length, 1);
    assert.strictEqual(result!.speakers[0].speaker, "Alice");
  });

  it("calculates balanced score near 100 for equal word distribution", () => {
    const text = `
Alice: We finished ten story points this sprint.
Bob: I completed five bug fixes and reviewed PRs.
Charlie: The deployment pipeline was stable and smooth.
    `.trim();

    const result = calculateSpeakerBalance(text);
    assert.notStrictEqual(result, null);
    assert.strictEqual(result!.speakers.length, 3);
    assert.strictEqual(result!.score > 90, true);
  });

  it("calculates lower score for heavily skewed speaker distribution", () => {
    const text = `
Alice: This is a very long update. We spent a lot of time on primary structure, shielding, emergency heat sinks, logistics, and contractor rework. Everything was reviewed multiple times across multiple days with many detailed notes.
Bob: Okay.
    `.trim();

    const result = calculateSpeakerBalance(text);
    assert.notStrictEqual(result, null);
    assert.strictEqual(result!.speakers.length, 2);
    assert.strictEqual(result!.score < 60, true);
  });
});
