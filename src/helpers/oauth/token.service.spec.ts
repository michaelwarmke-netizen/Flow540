import axios from 'axios';
import { AgentConfig } from '../config/agent-config';
import { NeedsLoginError, TokenService, decodeTokenInfo } from './token.service';
import { TokenStore } from './token-store';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

function makeConfig(): AgentConfig {
  return {
    port: 3540,
    mcpServerUrl: 'https://mcp.example.test',
    tokenStorePath: '/tmp/agent-tokens.json',
    oauth: {
      issuer: 'https://api.example.test',
      authorizeUrl: 'https://api.example.test/authorize',
      tokenUrl: 'https://api.example.test/token',
      redirectUri: 'http://localhost:3540/oauth/callback',
      clientId: 'client-abc',
      clientSecret: 'secret-xyz',
      scopes: 'openid offline_access thrive.reports.read',
    },
    gemini: { apiKey: 'k', model: 'gemini-2.5-flash', maxToolTurns: 8, maxOutputTokens: 4096 },
  };
}

function makeStore(refreshToken?: string): jest.Mocked<TokenStore> {
  return {
    read: jest.fn().mockReturnValue(refreshToken ? { refreshToken } : {}),
    writeRefreshToken: jest.fn(),
    clear: jest.fn(),
  } as unknown as jest.Mocked<TokenStore>;
}

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const makeJwt = (payload: Record<string, unknown>) =>
  `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url(payload)}.sig`;

describe('decodeTokenInfo', () => {
  it('parses a space-delimited scope claim, sorts scopes, and maps claims', () => {
    const token = makeJwt({
      scope: 'thrive.reports.read assets.reports.compliance openid',
      sub: 'person-1',
      client_id: 'client-abc',
      iss: 'https://api.example.test',
      aud: 'mcp',
      jti: 'jti-9',
      iat: 1000,
      exp: 4000,
    });
    const info = decodeTokenInfo(token);
    expect(info.scopes).toEqual(['assets.reports.compliance', 'openid', 'thrive.reports.read']);
    expect(info.subject).toBe('person-1');
    expect(info.clientId).toBe('client-abc');
    expect(info.issuer).toBe('https://api.example.test');
    expect(info.jti).toBe('jti-9');
    expect(info.expiresAt).toBe(new Date(4000 * 1000).toISOString());
  });

  it('accepts a scopes array claim', () => {
    expect(decodeTokenInfo(makeJwt({ scopes: ['b', 'a'] })).scopes).toEqual(['a', 'b']);
  });

  it('returns empty scopes when the claim is absent', () => {
    expect(decodeTokenInfo(makeJwt({ sub: 'x' })).scopes).toEqual([]);
  });

  it('throws when the token is not a JWT', () => {
    expect(() => decodeTokenInfo('not-a-jwt')).toThrow('not a JWT');
  });
});

describe('getTokenInfo', () => {
  it('decodes the token returned by getAccessToken', async () => {
    const svc = new TokenService(makeConfig(), makeStore('rt-1'));
    jest.spyOn(svc, 'getAccessToken').mockResolvedValue(makeJwt({ scope: 'openid', sub: 'p1' }));
    const info = await svc.getTokenInfo();
    expect(info.scopes).toEqual(['openid']);
    expect(info.subject).toBe('p1');
  });
});

describe('clearTokens', () => {
  it('drops the in-memory access token and clears the store (login required afterward)', async () => {
    const store = makeStore('rt-1');
    const svc = new TokenService(makeConfig(), store);
    mockedAxios.post.mockResolvedValueOnce({ data: { access_token: 'at-1', expires_in: 3600 } });
    expect(await svc.getAccessToken()).toBe('at-1'); // caches at-1 via refresh

    store.read.mockReturnValue({}); // simulate the store after clear()
    svc.clearTokens();
    expect(store.clear).toHaveBeenCalledTimes(1);

    // The cached token was dropped and no refresh token remains → must re-authorize.
    await expect(svc.getAccessToken()).rejects.toBeInstanceOf(NeedsLoginError);
  });
});

describe('TokenService', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('buildAuthorizeUrl', () => {
    it('builds a PKCE authorize URL with S256 challenge and client_id', async () => {
      const svc = new TokenService(makeConfig(), makeStore());
      const { url, state } = await svc.buildAuthorizeUrl();
      const parsed = new URL(url);
      expect(parsed.origin + parsed.pathname).toBe('https://api.example.test/authorize');
      expect(parsed.searchParams.get('response_type')).toBe('code');
      expect(parsed.searchParams.get('client_id')).toBe('client-abc');
      expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
      expect(parsed.searchParams.get('code_challenge')).toBeTruthy();
      expect(parsed.searchParams.get('state')).toBe(state);
      expect(parsed.searchParams.get('scope')).toContain('offline_access');
    });
  });

  describe('getAccessToken', () => {
    it('throws NeedsLoginError when no refresh token is stored', async () => {
      const svc = new TokenService(makeConfig(), makeStore());
      await expect(svc.getAccessToken()).rejects.toBeInstanceOf(NeedsLoginError);
    });

    it('refreshes using the stored refresh token and caches the access token', async () => {
      const store = makeStore('rt-1');
      const svc = new TokenService(makeConfig(), store);
      mockedAxios.post.mockResolvedValueOnce({
        data: { access_token: 'at-1', expires_in: 3600, refresh_token: 'rt-2' },
      });

      const token = await svc.getAccessToken();
      expect(token).toBe('at-1');
      // rotated refresh token is persisted
      expect(store.writeRefreshToken).toHaveBeenCalledWith('rt-2');

      // second call is served from cache — no additional token request
      const again = await svc.getAccessToken();
      expect(again).toBe('at-1');
      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    });
  });

  describe('handleCallback', () => {
    it('rejects an unknown state', async () => {
      const svc = new TokenService(makeConfig(), makeStore());
      await expect(svc.handleCallback('code-1', 'never-issued')).rejects.toThrow(/state/i);
    });

    it('exchanges a code and persists the refresh token', async () => {
      const store = makeStore();
      const svc = new TokenService(makeConfig(), store);
      const { state } = await svc.buildAuthorizeUrl();
      mockedAxios.post.mockResolvedValueOnce({
        data: { access_token: 'at-1', expires_in: 3600, refresh_token: 'rt-1' },
      });

      await svc.handleCallback('code-1', state);
      expect(store.writeRefreshToken).toHaveBeenCalledWith('rt-1');
      expect(await svc.getAccessToken()).toBe('at-1');
    });
  });
});