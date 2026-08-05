/**
 * Typed configuration for the external agent, hydrated from environment variables.
 * Non-sensitive values come from `.env` (committed); secrets from `.env.local` (gitignored).
 * See `.env` and `.env.local.example` for the full surface.
 */
export interface AgentConfig {
  port: number;
  oauth: OAuthConfig;
  mcpServerUrl: string;
  tokenStorePath: string;
  gemini: GeminiConfig;
}

export interface OAuthConfig {
  /** API Gateway base URL — the OAuth2 authorization server. */
  issuer: string;
  /** Explicit endpoints; when blank they are discovered from the issuer's metadata. */
  authorizeUrl?: string;
  tokenUrl?: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
  /** Space-separated scopes to request (MCP tool scopes + `offline_access`). */
  scopes: string;
}

export interface GeminiConfig {
  apiKey: string;
  model: string;
  maxToolTurns: number;
  maxOutputTokens: number;
}

/** DI token for the resolved {@link AgentConfig}. */
export const AGENT_CONFIG = 'AGENT_CONFIG';

function int(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

/** Build the {@link AgentConfig} from `process.env`. Called once by the config provider. */
export function loadAgentConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  return {
    port: int(env.PORT, 3540),
    mcpServerUrl: env.MCP_SERVER_URL ?? 'http://localhost:3005',
    tokenStorePath: env.TOKEN_STORE_PATH ?? '/workspace/.agent-tokens.json',
    oauth: {
      issuer: env.OAUTH_ISSUER ?? 'http://localhost:3003',
      authorizeUrl: env.OAUTH_AUTHORIZE_URL || undefined,
      tokenUrl: env.OAUTH_TOKEN_URL || undefined,
      redirectUri: env.OAUTH_REDIRECT_URI ?? 'http://localhost:3540/oauth/callback',
      clientId: env.OAUTH_CLIENT_ID ?? '',
      clientSecret: env.OAUTH_CLIENT_SECRET ?? '',
      scopes: env.OAUTH_SCOPES ?? 'openid offline_access',
    },
    gemini: {
      apiKey: env.GEMINI_API_KEY ?? '',
      model: env.GEMINI_MODEL ?? 'gemini-2.5-flash',
      maxToolTurns: int(env.AGENT_MAX_TOOL_TURNS, 8),
      maxOutputTokens: int(env.AGENT_MAX_OUTPUT_TOKENS, 4096),
    },
  };
}