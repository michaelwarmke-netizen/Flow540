# 📝 Plan: Dynamic Retrospective Metrics from Transcripts

## Executive Summary

The **Coaching Agent Performance** dashboard ([`CoachDashboard.tsx`](file:///Users/mike/WebstormProjects/Flow540/src/components/retrospectives/CoachDashboard.tsx)) currently displays three Key Retrospective Metrics — **Topic Coverage** (86%), **Speaker Balance** (82%), and **Action Follow-Through** (78%). Action Follow-Through was recently made dynamic, but **Topic Coverage** and **Speaker Balance** are still hardcoded. This plan makes all three metrics fully dynamic, computed from actual retrospective transcripts and database records.

---

## 1. Metrics Calculation Methodology

| Metric | Method | LLM Required? | Data Source |
| :--- | :--- | :--- | :--- |
| **Speaker Balance** | **Deterministic**: Parse `Speaker Name: ...` lines from transcript, count words & turns per speaker, compute normalized Shannon entropy (0–100%) | ❌ No | Retrospective transcript text |
| **Topic Coverage** | **LLM Semantic Matching**: Match accepted `coach_topics` for the sprint against transcript content; evaluate whether each topic was discussed, partially discussed, or missed | ✅ Yes | Transcript + accepted `coach_topics` from DB |
| **Action Follow-Through** | **Database Aggregation**: `completed / total` tracked actions | ❌ No | `retro_tracked_actions` table |

---

## 2. Architecture

### Data Flow

```
 Retrospective Transcript Upload / analysis.run
   │
   ├─ [Sync]  calculateSpeakerBalance(transcript)     ← Pure function, instant
   │            → speaker_balance_score, speaker_distribution_json
   │
   ├─ [Async] runActionItemAgent(transcript, context)  ← Existing LLM agent
   │
   ├─ [Async] runSuggestionsAgent(transcript, context) ← Existing LLM agent
   │
   └─ [Async] runTopicCoverageAgent(transcript, topics)← NEW LLM agent
                → topic_coverage_score, topic_coverage_details_json
   │
   ▼
 Save all metrics to `retrospectives` table columns
   │
   ▼
 CoachDashboard fetches via coach.getMetricsSummary
   → Aggregates latest retro's metrics + action follow-through from DB
```

### Execution Strategy in `analysis.run`

The existing agents ([`actionItemAgent`](file:///Users/mike/WebstormProjects/Flow540/src/helpers/agent/agents/actionItemAgent.ts), [`suggestionsAgent`](file:///Users/mike/WebstormProjects/Flow540/src/helpers/agent/agents/suggestionsAgent.ts)) currently run **sequentially** in [`retroAgentHandlers.js`](file:///Users/mike/WebstormProjects/Flow540/src/helpers/retroAgentHandlers.js#L365-L389). The new work integrates as follows:

1. **`calculateSpeakerBalance(transcript)`** — runs **synchronously before** the LLM agents (instant, no network call).
2. **`runTopicCoverageAgent()`** — runs **after** `runSuggestionsAgent` (it needs the sprint's accepted topics from DB, not the suggestions output).
3. All metrics are saved to the `retrospectives` row after all agents complete.

### Files Changed

| File | Change Type | Description |
| :--- | :--- | :--- |
| [`src/utils/transcriptAnalytics.ts`](file:///Users/mike/WebstormProjects/Flow540/src/utils/) | **NEW** | Pure `calculateSpeakerBalance(transcript)` function with Shannon entropy scoring |
| [`src/helpers/agent/agents/topicCoverageAgent.ts`](file:///Users/mike/WebstormProjects/Flow540/src/helpers/agent/agents/) | **NEW** | LLM agent that evaluates accepted coach topics against transcript content |
| [`src/helpers/retroRepository.js`](file:///Users/mike/WebstormProjects/Flow540/src/helpers/retroRepository.js) | **MODIFY** | Migration V7: add analytics columns; new `getMetricsSummary()` query method |
| [`src/helpers/retroAgentHandlers.js`](file:///Users/mike/WebstormProjects/Flow540/src/helpers/retroAgentHandlers.js) | **MODIFY** | Call speaker balance + topic coverage in `analysis.run`; add `coach.getMetricsSummary` IPC op |
| [`src/services/retro/client.ts`](file:///Users/mike/WebstormProjects/Flow540/src/services/retro/client.ts) | **MODIFY** | Add `Retrospective` analytics fields to type; add `retroClient.getMetricsSummary()` |
| [`src/components/retrospectives/CoachDashboard.tsx`](file:///Users/mike/WebstormProjects/Flow540/src/components/retrospectives/CoachDashboard.tsx) | **MODIFY** | Fetch and render dynamic metrics with speaker breakdown tooltip |

---

## 3. Detailed Implementation

### Step 1: Speaker Balance Utility — `src/utils/transcriptAnalytics.ts` (NEW)

A pure, deterministic function with no LLM dependency. Separated from agents for clarity and testability.

```typescript
export interface SpeakerStats {
  speaker: string;
  wordCount: number;
  turnCount: number;
  percentage: number; // 0-100
}

export interface SpeakerBalanceResult {
  score: number; // 0-100, null-safe
  speakers: SpeakerStats[];
}

export function calculateSpeakerBalance(transcript: string | null): SpeakerBalanceResult | null {
  if (!transcript || !transcript.trim()) return null;

  const lines = transcript.split('\n');
  const counts: Record<string, { words: number; turns: number }> = {};

  for (const line of lines) {
    // Match "Speaker Name: message text" — supports multi-word names
    const match = line.match(/^([A-Za-z][A-Za-z\s'.]{0,30}):\s+(.+)$/);
    if (!match) continue;
    const name = match[1].trim();
    const words = match[2].split(/\s+/).filter(Boolean).length;
    if (!counts[name]) counts[name] = { words: 0, turns: 0 };
    counts[name].words += words;
    counts[name].turns += 1;
  }

  const speakerNames = Object.keys(counts);
  if (speakerNames.length === 0) return null; // No speaker tags detected

  const totalWords = Object.values(counts).reduce((acc, c) => acc + c.words, 0);
  if (totalWords === 0) return null;

  const speakers: SpeakerStats[] = speakerNames.map((name) => ({
    speaker: name,
    wordCount: counts[name].words,
    turnCount: counts[name].turns,
    percentage: Math.round((counts[name].words / totalWords) * 100),
  }));

  // Shannon entropy normalized to [0, 100]
  const n = speakers.length;
  if (n <= 1) return { score: 100, speakers };

  let entropy = 0;
  for (const s of speakers) {
    const p = s.wordCount / totalWords;
    if (p > 0) entropy -= p * Math.log2(p);
  }
  const maxEntropy = Math.log2(n);
  const score = Math.round((entropy / maxEntropy) * 100);

  return { score, speakers };
}
```

### Step 2: Topic Coverage Agent — `src/helpers/agent/agents/topicCoverageAgent.ts` (NEW)

An LLM agent that takes the transcript + accepted coach topics and returns coverage evaluation.

**System Prompt:**
```
You are an Agile Retrospective Analytics Agent. Analyze the retrospective transcript
and evaluate whether each of the provided Coach Topics was discussed.

For each topic, determine:
- "discussed": The topic was explicitly addressed with substantive conversation.
- "partially_discussed": The topic was touched on briefly or indirectly.
- "missed": The topic was not addressed at all in the transcript.

Provide an overall topicCoverageScore (0-100) calculated as:
  (discussed topics × 100 + partially_discussed × 50 + missed × 0) / total topics

Return JSON:
{
  "topicCoverageScore": number,
  "topics": [
    {
      "topicId": string,
      "title": string,
      "status": "discussed" | "partially_discussed" | "missed",
      "evidenceQuote": string | null
    }
  ]
}
```

**Interface:**
```typescript
export interface TopicCoverageResult {
  success: boolean;
  topicCoverageScore: number;
  topics: Array<{
    topicId: string;
    title: string;
    status: "discussed" | "partially_discussed" | "missed";
    evidenceQuote: string | null;
  }>;
  error?: string;
}
```

### Step 3: Database Migration V7 — `retroRepository.js`

Add analytics columns to `retrospectives` table. Current version is **V6**.

```javascript
if (currentVersion < 7) {
  const migrateV7 = db.transaction(() => {
    try {
      db.exec(`ALTER TABLE retrospectives ADD COLUMN speaker_balance_score INTEGER;`);
    } catch (_) {}
    try {
      db.exec(`ALTER TABLE retrospectives ADD COLUMN topic_coverage_score INTEGER;`);
    } catch (_) {}
    try {
      db.exec(`ALTER TABLE retrospectives ADD COLUMN speaker_distribution_json TEXT;`);
    } catch (_) {}
    try {
      db.exec(`ALTER TABLE retrospectives ADD COLUMN topic_coverage_details_json TEXT;`);
    } catch (_) {}
    db.pragma("user_version = 7");
  });
  migrateV7();
}
```

**New repository method** — `getMetricsSummary(projectId)`:
```javascript
async getMetricsSummary(projectId) {
  // Get the most recent completed retrospective with analytics for this project
  const latestRetro = this.db.prepare(`
    SELECT speaker_balance_score, topic_coverage_score,
           speaker_distribution_json, topic_coverage_details_json
    FROM retrospectives
    WHERE project_id = ? AND processing_state = 'completed'
      AND (speaker_balance_score IS NOT NULL OR topic_coverage_score IS NOT NULL)
    ORDER BY created_at DESC LIMIT 1
  `).get(projectId);

  // Get action follow-through across all sprints for this project
  const actionStats = this.db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
    FROM retro_tracked_actions ta
    JOIN retrospectives r ON ta.retrospective_id = r.id
    WHERE r.project_id = ?
  `).get(projectId);

  return {
    speakerBalance: latestRetro?.speaker_balance_score ?? null,
    topicCoverage: latestRetro?.topic_coverage_score ?? null,
    speakerDistribution: latestRetro?.speaker_distribution_json
      ? JSON.parse(latestRetro.speaker_distribution_json) : null,
    topicCoverageDetails: latestRetro?.topic_coverage_details_json
      ? JSON.parse(latestRetro.topic_coverage_details_json) : null,
    actionFollowThrough: actionStats?.total > 0
      ? Math.round((actionStats.completed / actionStats.total) * 100) : null,
    actionCompleted: actionStats?.completed ?? 0,
    actionTotal: actionStats?.total ?? 0,
  };
}
```

### Step 4: `retroAgentHandlers.js` — Integrate into `analysis.run`

```javascript
// At top of analysis.run, BEFORE the LLM agents:
const { calculateSpeakerBalance } = require("../utils/transcriptAnalytics.ts");
const speakerResult = calculateSpeakerBalance(retro.transcript);

// After existing runSuggestionsAgent call:
const { runTopicCoverageAgent } = require("./agent/agents/topicCoverageAgent.ts");
const acceptedTopics = retro.sprint_id
  ? await repo.listTopics(retro.project_id)
      .then(topics => topics.filter(t => t.sprint_id === retro.sprint_id && t.state === "accepted"))
  : [];

let topicCoverageResult = null;
if (acceptedTopics.length > 0) {
  try {
    topicCoverageResult = await runTopicCoverageAgent({
      transcript: retro.transcript || "",
      topics: acceptedTopics,
      provider: modelOpts.provider,
      model: modelOpts.model,
    });
  } catch (err) {
    debugLogger.warn("TopicCoverageAgent failed (non-fatal)", { error: err.message });
  }
}

// After saving proposals, persist analytics:
await repo.updateRetrospective(retrospectiveId, {
  speaker_balance_score: speakerResult?.score ?? null,
  speaker_distribution_json: speakerResult ? JSON.stringify(speakerResult.speakers) : null,
  topic_coverage_score: topicCoverageResult?.topicCoverageScore ?? null,
  topic_coverage_details_json: topicCoverageResult?.topics
    ? JSON.stringify(topicCoverageResult.topics) : null,
});
```

**New IPC operation** — `coach.getMetricsSummary`:
```javascript
// Add to ALLOWED_OPS set:
"coach.getMetricsSummary",

// Add to switch:
case "coach.getMetricsSummary":
  return repo.getMetricsSummary(payload?.projectId);
```

### Step 5: Pre-Seed Analytics in `resetDemoData()`

Since Sprint 1 and 2 already have transcripts, compute speaker balance eagerly during reset so the dashboard has data immediately:

```javascript
// After inserting retro-sprint-20 transcript:
const { calculateSpeakerBalance } = require("../utils/transcriptAnalytics.ts");

const sb20 = calculateSpeakerBalance(sprint20Transcript);
this.db.prepare(`UPDATE retrospectives SET speaker_balance_score = ?, speaker_distribution_json = ?, topic_coverage_score = ? WHERE id = ?`)
  .run(sb20?.score ?? null, sb20 ? JSON.stringify(sb20.speakers) : null, 83, "retro-sprint-20");

const sb21 = calculateSpeakerBalance(sprint21Transcript);
this.db.prepare(`UPDATE retrospectives SET speaker_balance_score = ?, speaker_distribution_json = ?, topic_coverage_score = ? WHERE id = ?`)
  .run(sb21?.score ?? null, sb21 ? JSON.stringify(sb21.speakers) : null, 86, "retro-sprint-21");
```

> **Note**: Topic Coverage scores for pre-seeded retros are set to plausible values (83%, 86%) since running the LLM agent during `resetDemoData()` is not feasible. These values are consistent with 5-6 accepted topics being mostly discussed.

### Step 6: Client & UI — `client.ts` + `CoachDashboard.tsx`

**Add to `client.ts`:**
```typescript
// Add to Retrospective interface:
speaker_balance_score?: number | null;
topic_coverage_score?: number | null;
speaker_distribution_json?: string | null;
topic_coverage_details_json?: string | null;

// Add new client method:
getMetricsSummary: (projectId?: string) =>
  invoke<MetricsSummary>("coach.getMetricsSummary", { projectId }),
```

**Update `CoachDashboard.tsx`:**
- Call `retroClient.getMetricsSummary(projectId)` in `loadCoachData()`.
- Render `speakerBalance`, `topicCoverage`, and `actionFollowThrough` from the response (fallback to `null` → show "—" placeholder).
- Add a `Tooltip` on the Speaker Balance card showing `speakerDistribution` breakdown (e.g., `Darth Sidious: 28% | Darth Vader: 24% | Thrawn: 20% | Grievous: 16% | Maul: 12%`).
- Add a `Tooltip` on the Topic Coverage card showing per-topic `discussed`/`missed` status.

---

## 4. Edge Cases

| Scenario | Speaker Balance | Topic Coverage | Action Follow-Through |
| :--- | :--- | :--- | :--- |
| No transcript (Sprint 3) | `null` → display "—" | `null` → display "—" | Computed from DB (valid) |
| No speaker tags in transcript | `null` → display "Not detected" | LLM still runs (valid) | N/A |
| No accepted coach topics for sprint | N/A | `null` → display "No topics to evaluate" | N/A |
| LLM topic coverage call fails | Speaker balance still saved | `null` → display "—" | N/A |
| Zero tracked actions | N/A | N/A | `null` → display "—" |

---

## 5. Testing Strategy

### Unit Tests

| File | Tests |
| :--- | :--- |
| `src/utils/transcriptAnalytics.spec.ts` | Even distribution → ~95%; single dominant speaker → ~40%; no speaker tags → `null`; empty string → `null`; single speaker → 100% |
| `src/helpers/agent/agents/topicCoverageAgent.spec.ts` | Mock LLM response parsing; graceful failure on malformed JSON; empty topics list → skip |

### Integration

- Run `analysis.run` on Sprint 1 transcript → verify `speaker_balance_score` and `speaker_distribution_json` are persisted in DB.
- Call `coach.getMetricsSummary` → verify aggregated response includes all three metrics.
- Click **Reset Demo Data** → verify pre-seeded speaker balance scores appear on dashboard.
