import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGroq } from '@ai-sdk/groq';
import type { LanguageModel } from 'ai';
import type { AgentConfig } from '../config/agent-config.ts';
import { loadAgentConfig } from '../config/agent-config.ts';

export interface ResolveModelOptions {
  provider?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}

/**
 * Resolves a Vercel AI SDK {@link LanguageModel} based on provided options or {@link AgentConfig}.
 * Supports Google Gemini, OpenAI, Anthropic, Groq, and any local OpenAI-compatible endpoint (llama.cpp, Ollama, MLX).
 */
export function resolveAgentModel(
  options: ResolveModelOptions = {},
  config: AgentConfig = loadAgentConfig(),
): LanguageModel {
  const provider = (options.provider || config.llm.provider || 'gemini').toLowerCase();
  const modelId = options.model || config.llm.model || 'gemini-2.5-flash';
  const apiKey = options.apiKey || config.llm.apiKey || '';
  const baseUrl = options.baseUrl || config.llm.baseUrl;

  switch (provider) {
    case 'google':
    case 'gemini': {
      const google = createGoogleGenerativeAI({ apiKey: apiKey || process.env.GEMINI_API_KEY });
      return google(modelId);
    }
    case 'anthropic':
    case 'claude': {
      const anthropic = createAnthropic({ apiKey: apiKey || process.env.ANTHROPIC_API_KEY });
      return anthropic(modelId);
    }
    case 'groq': {
      const groq = createGroq({ apiKey: apiKey || process.env.GROQ_API_KEY });
      return groq(modelId);
    }
    case 'local':
    case 'ollama':
    case 'llama':
    case 'mlx':
    case 'self-hosted': {
      const endpoint = baseUrl || 'http://localhost:11434/v1';
      const localOpenAI = createOpenAI({
        baseURL: endpoint,
        apiKey: apiKey || 'local',
      });
      return localOpenAI(modelId);
    }
    case 'openai':
    default: {
      const openAI = createOpenAI({
        apiKey: apiKey || process.env.OPENAI_API_KEY,
        ...(baseUrl ? { baseURL: baseUrl } : {}),
      });
      return openAI(modelId);
    }
  }
}
