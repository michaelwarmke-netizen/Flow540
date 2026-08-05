import { Inject, Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { AGENT_CONFIG, AgentConfig } from '../config/agent-config';
import { codeChallengeS256, generateCodeVerifier, randomState } from './pkce.util';
import { TokenStore } from './token-store';

/** Thrown by getAccessToken() when there is no usable token and the user must run `agent login`. */
export class NeedsLoginError extends Error {
  constructor(message = 'No cached credentials — run `agent login` to authorize the agent.') {
    super(message);
    this.name = 'NeedsLoginError';
  }
}

interface OAuthEndpoints {
  authorizationEndpoint: string;
  tokenEndpoint: string;
}

interface TokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

/** Decoded, human-readable view of the access token's claims (for troubleshooting). */
export interface TokenInfo {
  scopes: string[];
  subject?: string;
  clientId?: string;
  issuer?: string;
  audience?: string | string[];
  jti?: string;
  issuedAt?: string;
  expiresAt?: string;
  expiresInSeconds?: number;
}

/**
 * Decode (WITHOUT verifying) the claims of an OAuth access-token JWT. Used only to show the caller
 * what scopes the token actually carries — the MCP server does the real signature verification.
 */
export function decodeTokenInfo(accessToken: string): TokenInfo {
  const parts = accessToken.split('.');
  if (parts.length < 2) throw new Error('Access token is not a JWT');
  let payload: Record<string, unknown>;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    payload = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  } catch {
    throw new Error('Failed to decode access token payload');
  }
  const scopeClaim = payload['scope'] ?? payload['scopes'];
  const scopes = Array.isArray(scopeClaim)
    ? (scopeClaim as string[])
    : typeof scopeClaim === 'string'
      ? scopeClaim.split(' ').filter(Boolean)
      : [];
  const exp = typeof payload['exp'] === 'number' ? (payload['exp'] as number) : undefined;
  const iat = typeof payload['iat'] === 'number' ? (payload['iat'] as number) : undefined;
  return {
    scopes: [...scopes].sort(),
    subject: (payload['sub'] as string) ?? undefined,
    clientId: (payload['client_id'] as string) ?? (payload['clientId'] as string) ?? undefined,
    issuer: (payload['iss'] as string) ?? undefined,
    audience: (payload['aud'] as string | string[]) ?? undefined,
    jti: (payload['jti'] as string) ?? undefined,
    issuedAt: iat ? new Date(iat * 1000).toISOString() : undefined,
    expiresAt: exp ? new Date(exp * 1000).toISOString() : undefined,
    expiresInSeconds: exp ? Math.max(0, Math.round(exp - Date.now() / 1000)) : undefined,
  };
}

/**
 * Obtains and refreshes OAuth access tokens from the API Gateway.
 *
 * The MCP server only accepts USER-DELEGATED `authorization_code` tokens (it rejects
 * `client_credentials`). The primary path is therefore:
 *   1. `agent login` → buildAuthorizeUrl() → browser → /oauth/callback → handleCallback()
 *      (stores a refresh token via TokenStore).
 *   2. getAccessToken() serves a cached access token, transparently refreshing it.
 *
 * getClientCredentialsToken() is provided for direct API Gateway-proxied routes only — it will
 * NOT be accepted by the MCP server.
 */
@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);
  private endpoints?: OAuthEndpoints;
  private readonly verifiers = new Map<string, string>();
  private cachedAccessToken?: string;
  private cachedExpiresAt = 0;

  constructor(
    @Inject(AGENT_CONFIG) private readonly config: AgentConfig,
    private readonly store: TokenStore,
  ) {}

  /** Resolve the authorize/token endpoints, discovering from issuer metadata when not set. */
  async resolveEndpoints(): Promise<OAuthEndpoints> {
    if (this.endpoints) return this.endpoints;
    const { authorizeUrl, tokenUrl, issuer } = this.config.oauth;
    if (authorizeUrl && tokenUrl) {
      this.endpoints = { authorizationEndpoint: authorizeUrl, tokenEndpoint: tokenUrl };
      return this.endpoints;
    }
    const url = `${issuer.replace(/\/$/, '')}/.well-known/oauth-authorization-server`;
    const { data } = await axios.get<{ authorization_endpoint: string; token_endpoint: string }>(url);
    this.endpoints = {
      authorizationEndpoint: authorizeUrl ?? data.authorization_endpoint,
      tokenEndpoint: tokenUrl ?? data.token_endpoint,
    };
    return this.endpoints;
  }

  /** Build the authorize URL for the browser step and remember its PKCE verifier by state. */
  async buildAuthorizeUrl(): Promise<{ url: string; state: string }> {
    this.assertClientConfigured();
    const { authorizationEndpoint } = await this.resolveEndpoints();
    const verifier = generateCodeVerifier();
    const state = randomState();
    this.verifiers.set(state, verifier);

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.oauth.clientId,
      redirect_uri: this.config.oauth.redirectUri,
      scope: this.config.oauth.scopes,
      state,
      code_challenge: codeChallengeS256(verifier),
      code_challenge_method: 'S256',
    });
    return { url: `${authorizationEndpoint}?${params.toString()}`, state };
  }

  /** Exchange the authorization code (from /oauth/callback) for tokens; persist the refresh token. */
  async handleCallback(code: string, state: string): Promise<void> {
    const verifier = this.verifiers.get(state);
    if (!verifier) throw new Error('Unknown or expired state — restart the login flow.');
    this.verifiers.delete(state);

    const { tokenEndpoint } = await this.resolveEndpoints();
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.config.oauth.redirectUri,
      client_id: this.config.oauth.clientId,
      client_secret: this.config.oauth.clientSecret,
      code_verifier: verifier,
    });
    const token = await this.postToken(tokenEndpoint, body);
    this.cacheAccess(token);
    if (token.refresh_token) this.store.writeRefreshToken(token.refresh_token);
    else this.logger.warn('No refresh_token returned — ensure `offline_access` is in OAUTH_SCOPES.');
  }

  /** A valid user-delegated access token, refreshing transparently. Throws NeedsLoginError if none. */
  async getAccessToken(): Promise<string> {
    if (this.cachedAccessToken && Date.now() < this.cachedExpiresAt - 30_000) {
      return this.cachedAccessToken;
    }
    const { refreshToken } = this.store.read();
    if (!refreshToken) throw new NeedsLoginError();
    return this.refresh(refreshToken);
  }

  /**
   * Decode the current (auto-refreshed) access token so callers can inspect the scopes actually
   * granted. This is the same token every MCP tool call carries, so it is the source of truth when
   * a tool reports a missing scope. Throws NeedsLoginError if there is no usable token.
   */
  async getTokenInfo(): Promise<TokenInfo> {
    const token = await this.getAccessToken();
    return decodeTokenInfo(token);
  }

  /**
   * Forget the current session: drops the in-memory access token and clears the persisted refresh
   * token. The next `getAccessToken()` will require a fresh `agent login` — used to switch users.
   */
  clearTokens(): void {
    this.cachedAccessToken = undefined;
    this.cachedExpiresAt = 0;
    this.store.clear();
  }

  private async refresh(refreshToken: string): Promise<string> {
    this.assertClientConfigured();
    const { tokenEndpoint } = await this.resolveEndpoints();
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.config.oauth.clientId,
      client_secret: this.config.oauth.clientSecret,
    });
    const token = await this.postToken(tokenEndpoint, body);
    this.cacheAccess(token);
    // Refresh-token rotation: persist the new one if the server returned it.
    if (token.refresh_token) this.store.writeRefreshToken(token.refresh_token);
    return token.access_token;
  }

  /**
   * A `client_credentials` (M2M) token — for DIRECT API Gateway-proxied routes only.
   * The MCP server rejects these; use getAccessToken() (authorization_code) for MCP tools.
   */
  async getClientCredentialsToken(): Promise<string> {
    this.assertClientConfigured();
    const { tokenEndpoint } = await this.resolveEndpoints();
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.config.oauth.clientId,
      client_secret: this.config.oauth.clientSecret,
      scope: this.config.oauth.scopes,
    });
    const token = await this.postToken(tokenEndpoint, body);
    return token.access_token;
  }

  private async postToken(endpoint: string, body: URLSearchParams): Promise<TokenResponse> {
    const { data } = await axios.post<TokenResponse>(endpoint, body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    return data;
  }

  private cacheAccess(token: TokenResponse): void {
    this.cachedAccessToken = token.access_token;
    this.cachedExpiresAt = Date.now() + (token.expires_in ?? 3600) * 1000;
  }

  private assertClientConfigured(): void {
    if (!this.config.oauth.clientId || !this.config.oauth.clientSecret) {
      throw new Error(
        'OAUTH_CLIENT_ID / OAUTH_CLIENT_SECRET are not set — copy .env.local.example to .env.local and fill them in.',
      );
    }
  }
}