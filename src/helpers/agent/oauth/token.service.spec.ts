import assert from 'node:assert/strict';
import { beforeEach, describe, it, mock } from 'node:test';
import axios from 'axios';
import type { AgentConfig } from '../config/agent-config.ts';
import { TokenStore } from './token-store.ts';
import { NeedsLoginError, TokenService, decodeTokenInfo } from './token.service.ts';

function makeConfig(): AgentConfig {
  const llm = {
    provider: 'gemini',
    apiKey: 'k',
    model: 'gemini-2.5-flash',
    maxToolTurns: 8,
    maxOutputTokens: 4096,
  };
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
    llm,
    gemini: llm,
  };
}

function makeStore(refreshToken?: string): TokenStore {
  const store = new TokenStore(makeConfig());
  store.read = () => (refreshToken ? { refreshToken } : {});
  store.writeRefreshToken = mock.fn();
  store.clear = mock.fn();
  return store;
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
    assert.deepStrictEqual(info.scopes, ['assets.reports.compliance', 'openid', 'thrive.reports.read']);
    assert.equal(info.subject, 'person-1');
    assert.equal(info.clientId, 'client-abc');
    assert.equal(info.issuer, 'https://api.example.test');
    assert.equal(info.jti, 'jti-9');
    assert.equal(info.expiresAt, new Date(4000 * 1000).toISOString());
  });

  it('accepts a scopes array claim', () => {
    assert.deepStrictEqual(decodeTokenInfo(makeJwt({ scopes: ['b', 'a'] })).scopes, ['a', 'b']);
  });

  it('returns empty scopes when the claim is absent', () => {
    assert.deepStrictEqual(decodeTokenInfo(makeJwt({ sub: 'x' })).scopes, []);
  });

  it('handles non-JWT opaque manual tokens gracefully', () => {
    const info = decodeTokenInfo('not-a-jwt');
    assert.deepStrictEqual(info.scopes, ['manual-bearer-token']);
  });
});

describe('getTokenInfo', () => {
  it('decodes the token returned by getAccessToken', async () => {
    const svc = new TokenService(makeConfig(), makeStore('rt-1'));
    svc.getAccessToken = async () => makeJwt({ scope: 'openid', sub: 'p1' });
    const info = await svc.getTokenInfo();
    assert.deepStrictEqual(info.scopes, ['openid']);
    assert.equal(info.subject, 'p1');
  });
});

describe('clearTokens', () => {
  it('drops the in-memory access token and clears the store', async () => {
    const store = makeStore('rt-1');
    const svc = new TokenService(makeConfig(), store);
    mock.method(axios, 'post', async () => ({ data: { access_token: 'at-1', expires_in: 3600 } }));
    assert.equal(await svc.getAccessToken(), 'at-1');

    store.read = () => ({});
    svc.clearTokens();
    assert.equal((store.clear as any).mock.callCount(), 1);

    await assert.rejects(async () => svc.getAccessToken(), (err: any) => err instanceof NeedsLoginError);
  });
});

describe('TokenService', () => {
  describe('buildAuthorizeUrl', () => {
    it('builds a PKCE authorize URL with S256 challenge and client_id', async () => {
      const svc = new TokenService(makeConfig(), makeStore());
      const { url, state } = await svc.buildAuthorizeUrl();
      const parsed = new URL(url);
      assert.equal(parsed.origin + parsed.pathname, 'https://api.example.test/authorize');
      assert.equal(parsed.searchParams.get('response_type'), 'code');
      assert.equal(parsed.searchParams.get('client_id'), 'client-abc');
      assert.equal(parsed.searchParams.get('code_challenge_method'), 'S256');
      assert.ok(parsed.searchParams.get('code_challenge'));
      assert.equal(parsed.searchParams.get('state'), state);
      assert.match(parsed.searchParams.get('scope') || '', /offline_access/);
    });
  });

  describe('getAccessToken', () => {
    it('throws NeedsLoginError when no refresh token is stored', async () => {
      const svc = new TokenService(makeConfig(), makeStore());
      await assert.rejects(async () => svc.getAccessToken(), (err: any) => err instanceof NeedsLoginError);
    });

    it('refreshes using the stored refresh token and caches the access token', async () => {
      const store = makeStore('rt-1');
      const svc = new TokenService(makeConfig(), store);
      let callCount = 0;
      mock.method(axios, 'post', async () => {
        callCount++;
        return { data: { access_token: 'at-1', expires_in: 3600, refresh_token: 'rt-2' } };
      });

      const token = await svc.getAccessToken();
      assert.equal(token, 'at-1');
      assert.equal((store.writeRefreshToken as any).mock.callCount(), 1);

      const again = await svc.getAccessToken();
      assert.equal(again, 'at-1');
      assert.equal(callCount, 1);
    });
  });

  describe('handleCallback', () => {
    it('rejects an unknown state', async () => {
      const svc = new TokenService(makeConfig(), makeStore());
      await assert.rejects(async () => svc.handleCallback('code-1', 'never-issued'), /state/i);
    });

    it('exchanges a code and persists the refresh token', async () => {
      const store = makeStore();
      const svc = new TokenService(makeConfig(), store);
      const { state } = await svc.buildAuthorizeUrl();
      mock.method(axios, 'post', async () => ({
        data: { access_token: 'at-1', expires_in: 3600, refresh_token: 'rt-1' },
      }));

      await svc.handleCallback('code-1', state);
      assert.equal((store.writeRefreshToken as any).mock.callCount(), 1);
      assert.equal(await svc.getAccessToken(), 'at-1');
    });
  });
});
