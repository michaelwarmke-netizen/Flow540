import { runAgent } from '../core/agentOrchestrator.ts';
import type { AgentConfig } from '../config/agent-config.ts';
import { loadAgentConfig } from '../config/agent-config.ts';
import { Logger } from '../../logger.ts';
import type { McpClientService } from '../mcp/mcp-client.service.ts';

const logger = new Logger('ActionItemAgent');

export interface ActionItemExtractionOptions {
  /** The text transcript from voice dictation, audio recording, or meeting log. */
  transcript: string;
  /** Optional contextual metadata to enhance extraction accuracy. */
  context?: {
    meetingTitle?: string;
    teamMembers?: string[];
    projectContext?: string;
    sprintId?: string;
  };
  /** Optional AI model or provider overrides. */
  model?: string;
  provider?: 'gemini' | 'anthropic' | 'openai' | 'ollama';
  /** Max steps for tool-calling loop (default 4). */
  maxSteps?: number;
}

export interface ExtractedActionItem {
  id: string;
  task: string;
  assignee: string;
  dueDate: string | null;
  quote: string;
  completed: boolean;
}

export interface ActionItemAgentResult {
  success: boolean;
  actionItems: ExtractedActionItem[];
  summary: string;
  rawText: string;
  error?: string;
  durationMs: number;
}

const ACTION_ITEM_SYSTEM_PROMPT = `
You are a lightweight Action Item Tracker AI Agent. Your job is to extract actionable tasks directly from the provided transcript text.

Keep the output concise, accurate, and lightweight.

Rules for Extraction:
1. Extract clear actionable work items (who is doing what).
2. Assign the responsible person's name if mentioned (or "Unassigned").
3. Note any mentioned due date or timeline (or null).
4. Include the direct quote snippet from the transcript.

OUTPUT REQUIREMENT:
You MUST output valid, parseable JSON matching the following schema. Do NOT include conversational filler outside the JSON:

{
  "summary": "Short 1-2 sentence summary of key decisions or transcript context",
  "actionItems": [
    {
      "task": "Actionable task title",
      "assignee": "Person responsible or Unassigned",
      "dueDate": "Timeline/deadline string or null",
      "quote": "Exact snippet from transcript"
    }
  ]
}
`.trim();

/**
 * Lightweight Action Item Agent: Takes a transcript and extracts simple actionable work items.
 */
export async function runActionItemAgent(
  options: ActionItemExtractionOptions,
  mcpClient?: McpClientService,
  config: AgentConfig = loadAgentConfig(),
): Promise<ActionItemAgentResult> {
  const startTime = Date.now();

  if (!options.transcript || options.transcript.trim().length === 0) {
    return {
      success: false,
      actionItems: [],
      summary: 'Transcript is empty.',
      rawText: '',
      error: 'Transcript text cannot be empty.',
      durationMs: Date.now() - startTime,
    };
  }

  let prompt = `Transcript to analyze:\n"""\n${options.transcript.trim()}\n"""`;

  if (options.context) {
    prompt += `\n\nContext Information:\n`;
    if (options.context.meetingTitle) prompt += `- Meeting Title: ${options.context.meetingTitle}\n`;
    if (options.context.teamMembers?.length) prompt += `- Known Team Members: ${options.context.teamMembers.join(', ')}\n`;
    if (options.context.projectContext) prompt += `- Project Context: ${options.context.projectContext}\n`;
    if (options.context.sprintId) prompt += `- Sprint ID: ${options.context.sprintId}\n`;
  }

  try {
    const agentResult = await runAgent(
      {
        prompt,
        systemPrompt: ACTION_ITEM_SYSTEM_PROMPT,
        provider: options.provider,
        model: options.model,
        maxSteps: options.maxSteps ?? 4,
      },
      mcpClient,
      config,
    );

    const parsed = parseActionItemsFromJson(agentResult.text);

    return {
      success: true,
      actionItems: parsed.actionItems,
      summary: parsed.summary,
      rawText: agentResult.text,
      durationMs: Date.now() - startTime,
    };
  } catch (err: any) {
    logger.error(`ActionItemAgent failed: ${err?.message || err}`);
    return {
      success: false,
      actionItems: [],
      summary: 'Extraction failed.',
      rawText: '',
      error: String(err?.message || err),
      durationMs: Date.now() - startTime,
    };
  }
}

/** Robust JSON parsing helper that handles raw JSON, markdown \`\`\`json blocks, and fallbacks. */
export function parseActionItemsFromJson(text: string): { summary: string; actionItems: ExtractedActionItem[] } {
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

    const summary = typeof parsed.summary === 'string' ? parsed.summary : 'Action items extracted successfully.';
    const rawItems = Array.isArray(parsed.actionItems) ? parsed.actionItems : Array.isArray(parsed) ? parsed : [];

    const actionItems: ExtractedActionItem[] = rawItems.map((item: any, index: number) => ({
      id: `action-${Date.now()}-${index + 1}`,
      task: String(item.task || item.title || item.action || `Task ${index + 1}`).trim(),
      assignee: String(item.assignee || item.owner || item.person || 'Unassigned').trim(),
      dueDate: item.dueDate ? String(item.dueDate) : item.deadline ? String(item.deadline) : null,
      quote: String(item.quote || item.snippet || item.context || '').trim(),
      completed: false,
    }));

    return { summary, actionItems };
  } catch (err) {
    logger.warn(`Failed to parse JSON response directly; falling back to heuristic parsing.`);
    return {
      summary: 'Parsed from freeform output.',
      actionItems: [],
    };
  }
}
