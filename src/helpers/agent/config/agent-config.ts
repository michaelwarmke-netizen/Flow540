import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Typed configuration for the external agent, hydrated from environment variables.
 * Supports multiple providers (Gemini, OpenAI, Anthropic, local models, etc.).
 */
export interface AgentConfig {
  port: number;
  oauth: OAuthConfig;
  mcpServerUrl: string;
  tokenStorePath: string;
  llm: AgentLlmConfig;
  /** @deprecated Kept for backward compatibility with existing code. */
  gemini: AgentLlmConfig;
}

export interface OAuthConfig {
  /** API Gateway base URL — the OAuth2 authorization server. */
  issuer: string;
  /** Explicit endpoints; when blank they are discovered from issuer metadata. */
  authorizeUrl?: string;
  tokenUrl?: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
  /** Space-separated scopes to request. */
  scopes: string;
  /** Manual static access token provided directly when OAuth server is unreachable. */
  manualAccessToken?: string;
}

export interface AgentLlmConfig {
  /** LLM provider identifier ('gemini', 'openai', 'anthropic', 'groq', 'local', etc.) */
  provider: string;
  apiKey: string;
  model: string;
  baseUrl?: string;
  maxToolTurns: number;
  maxOutputTokens: number;
}

export const AGENT_CONFIG = 'AGENT_CONFIG';

function int(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

let activeConfigSingleton: AgentConfig | null = null;

const CONFIG_FILE_PATH = process.env.AGENT_CONFIG_FILE || `${process.env.HOME || '.'}/.openwhispr/agent-config.json`;

/** Build the {@link AgentConfig} from `process.env` and optional saved overrides. */
export function loadAgentConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  if (activeConfigSingleton) return activeConfigSingleton;

  const provider =
    env.AGENT_LLM_PROVIDER ||
    env.retroAnalystProvider ||
    env.cloudTranscriptionProvider ||
    env.cleanupProvider ||
    '';
  const apiKey =
    env.AGENT_LLM_API_KEY ||
    env.GEMINI_API_KEY ||
    env.OPENAI_API_KEY ||
    env.ANTHROPIC_API_KEY ||
    env.GROQ_API_KEY ||
    env.retroAnalystCustomApiKey ||
    '';
  const model =
    env.AGENT_LLM_MODEL ||
    env.GEMINI_MODEL ||
    env.retroAnalystModel ||
    env.retroReasoningModel ||
    env.cloudTranscriptionModel ||
    env.cleanupModel ||
    '';
  const baseUrl = env.AGENT_LLM_BASE_URL || undefined;
  const maxToolTurns = int(env.AGENT_MAX_TOOL_TURNS, 8);
  const maxOutputTokens = int(env.AGENT_MAX_OUTPUT_TOKENS, 4096);

  const llmConfig: AgentLlmConfig = {
    provider,
    apiKey,
    model,
    baseUrl,
    maxToolTurns,
    maxOutputTokens,
  };

  let loaded: AgentConfig = {
    port: int(env.PORT, 3540),
    mcpServerUrl: env.MCP_SERVER_URL ?? 'http://localhost:3005',
    tokenStorePath: env.TOKEN_STORE_PATH ?? `${process.env.HOME || '.'}/.openwhispr/agent-tokens.json`,
    oauth: {
      issuer: env.OAUTH_ISSUER ?? 'http://localhost:3003',
      authorizeUrl: env.OAUTH_AUTHORIZE_URL || undefined,
      tokenUrl: env.OAUTH_TOKEN_URL || undefined,
      redirectUri: env.OAUTH_REDIRECT_URI ?? 'http://localhost:3540/oauth/callback',
      clientId: env.OAUTH_CLIENT_ID ?? '',
      clientSecret: env.OAUTH_CLIENT_SECRET ?? '',
      scopes: env.OAUTH_SCOPES ?? 'openid offline_access',
      manualAccessToken: env.OAUTH_MANUAL_TOKEN ?? env.OAUTH_ACCESS_TOKEN ?? '',
    },
    llm: llmConfig,
    gemini: llmConfig,
  };

  // Merge from saved JSON file if present
  if (existsSync(CONFIG_FILE_PATH)) {
    try {
      const saved = JSON.parse(readFileSync(CONFIG_FILE_PATH, 'utf8'));
      loaded = {
        ...loaded,
        ...saved,
        oauth: { ...loaded.oauth, ...(saved.oauth || {}) },
        llm: { ...loaded.llm, ...(saved.llm || {}) },
        gemini: { ...loaded.gemini, ...(saved.llm || saved.gemini || {}) },
      };
    } catch (_) {}
  }

  activeConfigSingleton = loaded;
  return activeConfigSingleton;
}

/** Get current active config. */
export function getAgentConfig(): AgentConfig {
  return activeConfigSingleton || loadAgentConfig();
}

/** Update config dynamically in memory and persist to disk. */
export function updateAgentConfig(updates: Partial<AgentConfig>): AgentConfig {
  const current = getAgentConfig();
  const updated: AgentConfig = {
    ...current,
    ...updates,
    oauth: {
      ...current.oauth,
      ...(updates.oauth || {}),
    },
    llm: {
      ...current.llm,
      ...(updates.llm || {}),
    },
    gemini: {
      ...current.gemini,
      ...(updates.llm || updates.gemini || {}),
    },
  };

  activeConfigSingleton = updated;

  try {
    mkdirSync(dirname(CONFIG_FILE_PATH), { recursive: true });
    writeFileSync(CONFIG_FILE_PATH, JSON.stringify(updated, null, 2), { mode: 0o600 });
  } catch (_) {}

  return updated;
}
