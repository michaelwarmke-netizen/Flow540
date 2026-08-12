import { runAgent } from '../core/agentOrchestrator.ts';
import type { AgentConfig } from '../config/agent-config.ts';
import { loadAgentConfig } from '../config/agent-config.ts';
import { Logger } from '../../logger.ts';
import type { McpClientService } from '../mcp/mcp-client.service.ts';

const logger = new Logger('TopicCoverageAgent');

export interface TopicCoverageItem {
  topicId: string;
  title: string;
  status: 'discussed' | 'partially_discussed' | 'missed';
  evidenceQuote: string | null;
}

export interface TopicCoverageOptions {
  transcript: string;
  topics: Array<{ id: string; title: string; rationale?: string }>;
  model?: string;
  provider?: 'gemini' | 'anthropic' | 'openai' | 'ollama';
  maxSteps?: number;
}

export interface TopicCoverageAgentResult {
  success: boolean;
  topicCoverageScore: number; // 0-100
  topics: TopicCoverageItem[];
  rawText?: string;
  error?: string;
  durationMs: number;
}

const TOPIC_COVERAGE_SYSTEM_PROMPT = `
You are an Agile Retrospective Analytics Agent. Your role is to evaluate whether pre-retro coaching agenda topics were covered in the retrospective meeting transcript.

For each topic:
1. "discussed": The topic was explicitly addressed with substantive conversation.
2. "partially_discussed": The topic was touched on briefly or indirectly.
3. "missed": The topic was not addressed at all in the transcript.

Calculate an overall topicCoverageScore (0-100):
  (discussed_count * 100 + partially_discussed_count * 50) / total_topics

Respond with JSON strictly following this schema:
{
  "topicCoverageScore": 85,
  "topics": [
    {
      "topicId": "topic-1",
      "title": "Topic title",
      "status": "discussed",
      "evidenceQuote": "Quote from transcript supporting discussion"
    }
  ]
}
`;

export async function runTopicCoverageAgent(
  options: TopicCoverageOptions,
  mcpClient?: McpClientService | null,
  agentConfig?: AgentConfig,
): Promise<TopicCoverageAgentResult> {
  const startTime = Date.now();
  const config = agentConfig || loadAgentConfig();

  if (!options.topics || options.topics.length === 0) {
    return {
      success: true,
      topicCoverageScore: 100,
      topics: [],
      durationMs: Date.now() - startTime,
    };
  }

  let prompt = `Analyze this Retrospective Transcript and evaluate discussion coverage for the following accepted agenda topics:\n\n`;

  prompt += `--- ACCEPTED COACH AGENDA TOPICS ---\n`;
  for (const t of options.topics) {
    prompt += `- [ID: ${t.id}] Title: ${t.title}${t.rationale ? ` (Rationale: ${t.rationale})` : ''}\n`;
  }

  prompt += `\n--- RETROSPECTIVE TRANSCRIPT ---\n${options.transcript}\n`;

  const targetModel = options.model || config.llm.model;
  const targetProvider = options.provider || config.llm.provider;

  if (!targetModel) {
    return {
      success: false,
      topicCoverageScore: 0,
      topics: [],
      error: 'No AI model configured.',
      durationMs: Date.now() - startTime,
    };
  }

  logger.info(`TopicCoverageAgent evaluating ${options.topics.length} topics using model: "${targetModel}"`);

  try {
    const agentResult = await runAgent(
      {
        prompt,
        systemPrompt: TOPIC_COVERAGE_SYSTEM_PROMPT,
        provider: options.provider,
        model: options.model,
        maxSteps: options.maxSteps ?? 2,
      },
      mcpClient,
      config,
    );

    const parsed = parseTopicCoverageFromJson(agentResult.text, options.topics);

    return {
      success: true,
      topicCoverageScore: parsed.topicCoverageScore,
      topics: parsed.topics,
      rawText: agentResult.text,
      durationMs: Date.now() - startTime,
    };
  } catch (err: any) {
    logger.error('TopicCoverageAgent execution failed', { error: err.message });
    return {
      success: false,
      topicCoverageScore: 0,
      topics: [],
      error: err.message,
      durationMs: Date.now() - startTime,
    };
  }
}

export function parseTopicCoverageFromJson(
  rawText: string,
  inputTopics: Array<{ id: string; title: string }>
): { topicCoverageScore: number; topics: TopicCoverageItem[] } {
  try {
    let cleaned = rawText.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '');
    }
    const jsonStart = cleaned.indexOf('{');
    const jsonEnd = cleaned.lastIndexOf('}');
    if (jsonStart !== -1 && jsonEnd !== -1) {
      cleaned = cleaned.slice(jsonStart, jsonEnd + 1);
    }
    const obj = JSON.parse(cleaned);

    const items: TopicCoverageItem[] = [];
    if (Array.isArray(obj.topics)) {
      for (const item of obj.topics) {
        if (item && item.topicId) {
          items.push({
            topicId: String(item.topicId),
            title: String(item.title || ''),
            status: ['discussed', 'partially_discussed', 'missed'].includes(item.status)
              ? item.status
              : 'missed',
            evidenceQuote: item.evidenceQuote ? String(item.evidenceQuote) : null,
          });
        }
      }
    }

    let score = typeof obj.topicCoverageScore === 'number' ? Math.round(obj.topicCoverageScore) : 0;
    if (items.length > 0 && (!obj.topicCoverageScore || isNaN(score))) {
      let discussed = items.filter((i) => i.status === 'discussed').length;
      let partial = items.filter((i) => i.status === 'partially_discussed').length;
      score = Math.round(((discussed * 100) + (partial * 50)) / items.length);
    }

    return { topicCoverageScore: Math.min(100, Math.max(0, score)), topics: items };
  } catch {
    return {
      topicCoverageScore: 0,
      topics: inputTopics.map((t) => ({
        topicId: t.id,
        title: t.title,
        status: 'missed',
        evidenceQuote: null,
      })),
    };
  }
}
