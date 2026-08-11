import { runAgent } from '../core/agentOrchestrator.ts';
import type { AgentConfig } from '../config/agent-config.ts';
import { loadAgentConfig } from '../config/agent-config.ts';
import { Logger } from '../../logger.ts';
import type { McpClientService } from '../mcp/mcp-client.service.ts';

const logger = new Logger('SuggestionsAgent');

export interface SuggestionsAgentOptions {
  /** Speech transcript or discussion notes from meeting/retro */
  transcript?: string;
  /** Contextual metadata such as sprint metrics, team members, or title */
  context?: {
    meetingTitle?: string;
    teamMembers?: string[];
    sprintMetrics?: {
      name?: string;
      committedPoints?: number;
      completedPoints?: number;
      velocity?: number;
      completedIssues?: number;
      totalIssues?: number;
      blockedIssues?: number;
      burndownTrend?: string;
      blockers?: string;
    };
    previousActionItems?: string[];
  };
  model?: string;
  provider?: 'gemini' | 'anthropic' | 'openai' | 'ollama';
  maxSteps?: number;
}

export interface SuggestionItem {
  id: string;
  title: string;
  description: string;
  basis: string;
  category: 'process' | 'communication' | 'metric_driven' | 'carryover' | 'general';
  owner: string;
  impact: 'high' | 'medium' | 'low';
}

export interface SuggestionsAgentResult {
  success: boolean;
  suggestions: SuggestionItem[];
  summary: string;
  rawText: string;
  error?: string;
  durationMs: number;
}

const SUGGESTIONS_SYSTEM_PROMPT = `
You are an expert Suggestions AI Agent. Your role is to analyze retrospective transcripts, team discussions, and sprint performance data to suggest high-value, actionable improvements.

Guidelines:
1. Identify process bottlenecks, team dynamics improvements, communication gaps, or capacity planning adjustments.
2. For each suggestion, provide a clear 'title', 'description' (how to execute the improvement), and 'basis' (the observation or metric that triggered this recommendation).
3. Recommend an appropriate facilitator/owner ('Scrum Master', specific team member, or 'Unassigned').
4. Categorize as 'process', 'communication', 'metric_driven', 'carryover', or 'general'.
5. Assign an impact rating ('high', 'medium', 'low').

OUTPUT REQUIREMENT:
You MUST output valid, parseable JSON matching the following schema without markdown or prose outside the JSON:

{
  "summary": "1-2 sentence executive assessment of team health and primary area for growth",
  "suggestions": [
    {
      "title": "Concise suggestion title",
      "description": "Actionable guidance for the team",
      "basis": "Transcript observation or metric data supporting this suggestion",
      "category": "process" | "communication" | "metric_driven" | "carryover" | "general",
      "owner": "Scrum Master or team member or Unassigned",
      "impact": "high" | "medium" | "low"
    }
  ]
}
`.trim();

/**
 * Suggestions Agent: Analyzes transcripts and metrics to provide team improvements & suggestions.
 */
export async function runSuggestionsAgent(
  options: SuggestionsAgentOptions,
  mcpClient?: McpClientService,
  config: AgentConfig = loadAgentConfig(),
): Promise<SuggestionsAgentResult> {
  const startTime = Date.now();

  if (!options.transcript && !options.context?.sprintMetrics) {
    return {
      success: false,
      suggestions: [],
      summary: 'No transcript or metrics provided.',
      rawText: '',
      error: 'Either transcript or sprint metrics must be provided.',
      durationMs: Date.now() - startTime,
    };
  }

  let prompt = `Transcript to analyze:\n"""\n${options.transcript || 'No transcript text provided.'}\n"""`;

  if (options.context) {
    prompt += `\n\nContext & Sprint Metrics:\n`;
    if (options.context.meetingTitle) prompt += `- Meeting: ${options.context.meetingTitle}\n`;
    if (options.context.teamMembers?.length) prompt += `- Team Members: ${options.context.teamMembers.join(', ')}\n`;
    if (options.context.sprintMetrics) {
      const m = options.context.sprintMetrics;
      prompt += `- Sprint Name: ${m.name || 'Current'}\n`;
      prompt += `- Velocity / Capacity: ${m.completedPoints ?? 0} / ${m.committedPoints ?? 0} pts (Velocity: ${m.velocity ?? 0})\n`;
      if (m.blockedIssues) prompt += `- Blocked Issues: ${m.blockedIssues}\n`;
      if (m.blockers) prompt += `- Blockers Reported: ${m.blockers}\n`;
      if (m.burndownTrend) prompt += `- Burndown Trend: ${m.burndownTrend}\n`;
    }
    if (options.context.previousActionItems?.length) {
      prompt += `- Carried Over Action Items: ${options.context.previousActionItems.join(', ')}\n`;
    }
  }

  const targetModel = options.model || config.llm.model;
  const targetProvider = options.provider || config.llm.provider;

  if (!targetModel) {
    return {
      success: false,
      suggestions: [],
      summary: 'No AI model configured or selected in settings.',
      rawText: '',
      error: 'No AI model selected or configured in settings. Please select an AI model in settings.',
      durationMs: Date.now() - startTime,
    };
  }

  logger.info(`SuggestionsAgent processing input using model: "${targetModel}" (${targetProvider || 'default'})`);

  try {
    const agentResult = await runAgent(
      {
        prompt,
        systemPrompt: SUGGESTIONS_SYSTEM_PROMPT,
        provider: options.provider,
        model: options.model,
        maxSteps: options.maxSteps ?? 4,
      },
      mcpClient,
      config,
    );

    const parsed = parseSuggestionsFromJson(agentResult.text);

    const duration = Date.now() - startTime;
    logger.info(`SuggestionsAgent completed in ${duration}ms — generated ${parsed.suggestions.length} suggestions`);

    return {
      success: true,
      suggestions: parsed.suggestions,
      summary: parsed.summary,
      rawText: agentResult.text,
      durationMs: duration,
    };
  } catch (err: any) {
    logger.error(`SuggestionsAgent failed: ${err?.message || err}`);
    return {
      success: false,
      suggestions: [],
      summary: 'Suggestions analysis failed.',
      rawText: '',
      error: String(err?.message || err),
      durationMs: Date.now() - startTime,
    };
  }
}

/** Robust JSON parsing helper that handles raw JSON, markdown \`\`\`json blocks, and fallbacks. */
export function parseSuggestionsFromJson(text: string): { summary: string; suggestions: SuggestionItem[] } {
  let cleanText = text.trim();

  // Strip markdown code block wrappers if present
  if (cleanText.includes('```')) {
    const match = cleanText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (match && match[1]) {
      cleanText = match[1].trim();
    }
  }

  try {
    const parsed = JSON.parse(cleanText);
    const summary = typeof parsed.summary === 'string' ? parsed.summary : 'Suggestions generated successfully.';
    const rawItems = Array.isArray(parsed.suggestions) ? parsed.suggestions : Array.isArray(parsed) ? parsed : [];

    const suggestions: SuggestionItem[] = rawItems.map((item: any, index: number) => ({
      id: `suggestion-${Date.now()}-${index + 1}`,
      title: String(item.title || item.suggestion || item.name || `Suggestion ${index + 1}`).trim(),
      description: String(item.description || item.detail || item.recommendation || '').trim(),
      basis: String(item.basis || item.rationale || item.reason || '').trim(),
      category: (['process', 'communication', 'metric_driven', 'carryover', 'general'].includes(
        String(item.category).toLowerCase(),
      )
        ? String(item.category).toLowerCase()
        : 'general') as any,
      owner: String(item.owner || item.facilitator || 'Unassigned').trim(),
      impact: (['high', 'medium', 'low'].includes(String(item.impact).toLowerCase())
        ? String(item.impact).toLowerCase()
        : 'medium') as any,
    }));

    return { summary, suggestions };
  } catch (err) {
    logger.warn(`Failed to parse suggestions JSON; returning empty list.`);
    return {
      summary: 'Parsed from freeform output.',
      suggestions: [],
    };
  }
}
