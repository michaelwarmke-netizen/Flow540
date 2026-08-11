import { ToolLoopAgent, stepCountIs } from 'ai';
import type { AgentConfig } from '../config/agent-config.ts';
import { loadAgentConfig } from '../config/agent-config.ts';
import { Logger } from '../../logger.ts';
import { McpClientService } from '../mcp/mcp-client.service.ts';
import type { AgentRunOptions, AgentRunResult, AgentStepResult } from './agentTypes.ts';
import { resolveAgentModel } from './agentProviderResolver.ts';
import { createAiSdkToolsFromMcp } from './mcpToolBridge.ts';

const DEFAULT_SYSTEM_PROMPT =
  'You are an autonomous AI agent capable of using tools to assist the user. Analyze the user request, determine which tools to call, and synthesize a clear final answer.';

const logger = new Logger('AgentOrchestrator');

/**
 * Runs an agentic tool-calling loop using Vercel AI SDK's `ToolLoopAgent`.
 * Automatically discovers MCP tools, executes tool steps up to `maxSteps`,
 * and returns the aggregated text, steps, and tool usage metrics.
 */
export async function runAgent(
  options: AgentRunOptions,
  mcpClient?: McpClientService,
  config: AgentConfig = loadAgentConfig(),
): Promise<AgentRunResult> {
  const sessionId = options.sessionId ?? `session-${Date.now()}`;
  const model = resolveAgentModel(options, config);
  const resolvedModelId = (model as any)?.modelId || options.model || config.llm.model || 'default';
  const maxSteps = options.maxSteps ?? config.llm.maxToolTurns ?? 8;
  const maxOutputTokens = options.maxOutputTokens ?? config.llm.maxOutputTokens ?? 4096;

  logger.info(`Starting agent run [session: ${sessionId}] provider=${options.provider ?? config.llm.provider} model=${resolvedModelId}`);

  // Discover & bridge MCP tools if client is present
  const tools = mcpClient ? await createAiSdkToolsFromMcp(mcpClient).catch((err) => {
    logger.warn(`Failed to discover MCP tools: ${String(err)}`);
    return {};
  }) : {};

  const agent = new ToolLoopAgent({
    model,
    instructions: options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
    tools,
    stopWhen: stepCountIs(maxSteps),
    maxOutputTokens,
    onStepFinish(step: any) {
      const mappedStep: AgentStepResult = {
        stepType: step.stepType || 'continue',
        text: step.text || '',
        toolCalls: (step.toolCalls || []).map((tc: any) => ({
          toolCallId: tc.toolCallId || tc.id || '',
          toolName: tc.toolName || tc.name || '',
          args: (tc.args ?? tc.arguments ?? {}) as Record<string, unknown>,
        })),
        toolResults: (step.toolResults || []).map((tr: any) => ({
          toolCallId: tr.toolCallId || tr.id || '',
          toolName: tr.toolName || tr.name || '',
          args: (tr.args ?? tr.arguments ?? {}) as Record<string, unknown>,
          result: tr.result ?? tr.output,
        })),
        ...(step.usage
          ? {
              usage: {
                promptTokens: step.usage.inputTokens ?? step.usage.promptTokens ?? 0,
                completionTokens: step.usage.outputTokens ?? step.usage.completionTokens ?? 0,
                totalTokens: step.usage.totalTokens ?? 0,
              },
            }
          : {}),
      };
      options.onStepFinish?.(mappedStep);
    },
  });

  const result = await agent.generate({
    prompt: options.prompt,
    abortSignal: options.abortSignal,
  });

  const steps: AgentStepResult[] = (result.steps || []).map((s: any) => ({
    stepType: s.stepType || 'continue',
    text: s.text || '',
    toolCalls: (s.toolCalls || []).map((tc: any) => ({
      toolCallId: tc.toolCallId || tc.id || '',
      toolName: tc.toolName || tc.name || '',
      args: (tc.args ?? tc.arguments ?? {}) as Record<string, unknown>,
    })),
    toolResults: (s.toolResults || []).map((tr: any) => ({
      toolCallId: tr.toolCallId || tr.id || '',
      toolName: tr.toolName || tr.name || '',
      args: (tr.args ?? tr.arguments ?? {}) as Record<string, unknown>,
      result: tr.result ?? tr.output,
    })),
    ...(s.usage
      ? {
          usage: {
            promptTokens: s.usage.inputTokens ?? s.usage.promptTokens ?? 0,
            completionTokens: s.usage.outputTokens ?? s.usage.completionTokens ?? 0,
            totalTokens: s.usage.totalTokens ?? 0,
          },
        }
      : {}),
  }));

  const totalToolCalls = steps.reduce((sum, s) => sum + s.toolCalls.length, 0);

  return {
    sessionId,
    text: result.text,
    steps,
    toolCallsCount: totalToolCalls,
    finishReason: result.finishReason ?? 'completed',
    ...(result.usage
      ? {
          usage: {
            promptTokens: result.usage.inputTokens ?? (result.usage as any).promptTokens ?? 0,
            completionTokens: result.usage.outputTokens ?? (result.usage as any).completionTokens ?? 0,
            totalTokens: result.usage.totalTokens ?? 0,
          },
        }
      : {}),
  };
}
