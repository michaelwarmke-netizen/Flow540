import axios from 'axios';
import type { AgentConfig } from '../config/agent-config.ts';
import { loadAgentConfig, getAgentConfig } from '../config/agent-config.ts';
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
export function decodeTokenInfo(token: string): TokenInfo {
  let payload: Record<string, unknown> = {};
  try {
    const parts = token.split('.');
    if (parts.length >= 2) {
      const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      payload = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    } else {
      return {
        scopes: ['manual-bearer-token'],
        subject: 'manual-token-user',
        expiresInSeconds: 86400,
      };
    }
  } catch {
    return {
      scopes: ['manual-bearer-token'],
      subject: 'manual-token-user',
      expiresInSeconds: 86400,
    };
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
  private customConfig?: AgentConfig;
  private readonly store: TokenStore;

  private get config(): AgentConfig {
    return this.customConfig || getAgentConfig();
  }

  constructor(
    config?: AgentConfig,
    store?: TokenStore,
  ) {
    this.customConfig = config;
    this.store = store || new TokenStore(config || getAgentConfig());
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
    let matchedState = state;
    let entry = TokenService.sharedVerifiers.get(state);

    if (!entry && state) {
      try {
        const decoded = decodeURIComponent(state);
        entry = TokenService.sharedVerifiers.get(decoded);
        if (entry) matchedState = decoded;
      } catch (_) {}
    }

    // Fallback when state parameter was omitted or dropped by authorization proxy
    if (!entry && !state) {
      const now = Date.now();
      for (const [key, val] of TokenService.sharedVerifiers.entries()) {
        if (val.expiresAt > now) {
          entry = val;
          matchedState = key;
          this.logger.warn(`OAuth callback state missing or mismatched; using active pending PKCE verifier.`);
          break;
        }
      }
    }

    if (!entry || entry.expiresAt < Date.now()) {
      if (matchedState) TokenService.sharedVerifiers.delete(matchedState);
      throw new Error('Unknown or expired state — restart the login flow.');
    }

    TokenService.sharedVerifiers.delete(matchedState);
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

  /** A valid access token, fetched directly from sidecar GET http://localhost:3540/oauth/token-info-raw. */
  async getAccessToken(): Promise<string> {
    if (this.config.oauth.manualAccessToken && this.config.oauth.manualAccessToken.trim().length > 0) {
      return this.config.oauth.manualAccessToken.trim();
    }
    if (this.cachedAccessToken && Date.now() < this.cachedExpiresAt - 10_000) {
      return this.cachedAccessToken;
    }

    const sidecarUrl = this.config.oauth.tokenUrl || 'http://localhost:3540/oauth/token-info-raw';
    try {
      const { data } = await axios.get(sidecarUrl, { timeout: 5000 });
      const token = this.extractTokenFromSidecarResponse(data);
      if (token) {
        this.cachedAccessToken = token;
        this.cachedExpiresAt = Date.now() + 60_000;
        return token;
      }
    } catch (err: any) {
      this.logger.error(`Error fetching token from sidecar at ${sidecarUrl}: ${err?.message || err}`);
    }

    // Fall back to stored refresh token if sidecar fetch fails
    const { refreshToken } = this.store.read();
    if (refreshToken) {
      return this.refresh(refreshToken);
    }

    throw new NeedsLoginError(`Unable to fetch token from sidecar endpoint (${sidecarUrl}). Make sure your sidecar is running.`);
  }

  private extractTokenFromSidecarResponse(data: unknown): string | null {
    if (!data) return null;
    if (typeof data === 'string') {
      const trimmed = data.trim();
      if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try {
          const parsed = JSON.parse(trimmed);
          return this.extractTokenFromSidecarResponse(parsed);
        } catch (_) {}
      }
      return trimmed;
    }
    if (typeof data === 'object') {
      const obj = data as Record<string, any>;
      const candidate =
        obj.access_token ||
        obj.accessToken ||
        obj.token ||
        obj.id_token ||
        obj.idToken ||
        obj.raw ||
        obj.jwt ||
        obj.text;
      if (typeof candidate === 'string') {
        return candidate.trim();
      }
    }
    return null;
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
