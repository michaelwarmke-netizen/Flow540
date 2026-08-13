/** Shared TypeScript types for agent sessions, execution, and step results. */

export interface AgentRunOptions {
  /** User's input prompt or instruction */
  prompt: string;
  /** Optional system prompt override */
  systemPrompt?: string;
  /** Session identifier for tracking multi-turn conversations or cancellation */
  sessionId?: string;
  /** Maximum number of tool-calling roundtrips (defaults to config maxToolTurns) */
  maxSteps?: number;
  /** Maximum output tokens per generation */
  maxOutputTokens?: number;
  /** Temperature override for generation */
  temperature?: number;
  /** Provider override ('gemini', 'openai', 'anthropic', 'groq', 'local', etc.) */
  provider?: string;
  /** Model ID override */
  model?: string;
  /** API key override */
  apiKey?: string;
  /** Custom endpoint URL override (for Ollama, llama.cpp, etc.) */
  baseUrl?: string;
  /** Callback fired after each tool call / step iteration */
  onStepFinish?: (step: AgentStepResult) => void;
  /** AbortSignal for cancellation */
  abortSignal?: AbortSignal;
}

export interface AgentToolCallInfo {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

export interface AgentToolResultInfo {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  result: unknown;
}

export interface AgentStepResult {
  stepType: 'initial' | 'continue';
  text: string;
  toolCalls: AgentToolCallInfo[];
  toolResults: AgentToolResultInfo[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface AgentRunResult {
  sessionId: string;
  text: string;
  steps: AgentStepResult[];
  toolCallsCount: number;
  finishReason: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface AgentSessionInfo {
  sessionId: string;
  prompt: string;
  status: 'idle' | 'running' | 'completed' | 'cancelled' | 'error';
  startedAt: string;
  completedAt?: string;
  error?: string;
}
