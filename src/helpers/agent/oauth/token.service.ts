import axios from 'axios';
import type { AgentConfig } from '../config/agent-config.ts';
import { loadAgentConfig } from '../config/agent-config.ts';
import { Logger } from '../../logger.ts';
import { codeChallengeS256, generateCodeVerifier, randomState } from './pkce.util.ts';
import { TokenStore } from './token-store.ts';

/** Thrown by getAccessToken() when there is no usable token and the user must log in. */
export class NeedsLoginError extends Error {
  constructor(message = 'No cached credentials — authorize the agent to proceed.') {
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

/** Decoded, human-readable view of the access token's claims. */
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
 * Decode (WITHOUT verifying) the claims of an OAuth access-token JWT.
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
 * Obtains and refreshes OAuth access tokens.
 */
export class TokenService {
  private readonly logger = new Logger(TokenService.name);
  private endpoints?: OAuthEndpoints;
  private static readonly sharedVerifiers = new Map<string, { verifier: string; expiresAt: number }>();
  private cachedAccessToken?: string;
  private cachedExpiresAt = 0;
  private readonly config: AgentConfig;
  private readonly store: TokenStore;

  constructor(
    config: AgentConfig = loadAgentConfig(),
    store: TokenStore = new TokenStore(config),
  ) {
    this.config = config;
    this.store = store;
  }

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
    TokenService.sharedVerifiers.set(state, {
      verifier,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });

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

  /** Exchange the authorization code for tokens; persist the refresh token. */
  async handleCallback(code: string, state: string): Promise<void> {
    const entry = TokenService.sharedVerifiers.get(state);
    if (!entry || entry.expiresAt < Date.now()) {
      if (entry) TokenService.sharedVerifiers.delete(state);
      throw new Error('Unknown or expired state — restart the login flow.');
    }
    TokenService.sharedVerifiers.delete(state);
    const verifier = entry.verifier;

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

  /** A valid access token, refreshing transparently. Throws NeedsLoginError if none. */
  async getAccessToken(): Promise<string> {
    if (this.cachedAccessToken && Date.now() < this.cachedExpiresAt - 30_000) {
      return this.cachedAccessToken;
    }
    const { refreshToken } = this.store.read();
    if (!refreshToken) throw new NeedsLoginError();
    return this.refresh(refreshToken);
  }

  /** Decode the current access token. */
  async getTokenInfo(): Promise<TokenInfo> {
    const token = await this.getAccessToken();
    return decodeTokenInfo(token);
  }

  /** Clear session tokens. */
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
    if (token.refresh_token) this.store.writeRefreshToken(token.refresh_token);
    return token.access_token;
  }

  /** Client credentials (M2M) token for direct API Gateway routes. */
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
    if (!this.config.oauth.clientId) {
      this.config.oauth.clientId = 'nexus-sandbox-client';
    }
  }
}
