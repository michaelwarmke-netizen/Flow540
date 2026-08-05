import { Inject, Injectable, Logger } from '@nestjs/common';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { AGENT_CONFIG, AgentConfig } from '../config/agent-config';

export interface StoredTokens {
  refreshToken?: string;
  obtainedAt?: string;
}

/**
 * Persists the OAuth refresh token to a gitignored JSON file so the one-time `agent login`
 * survives restarts. The access token is short-lived and kept only in memory (TokenService).
 */
@Injectable()
export class TokenStore {
  private readonly logger = new Logger(TokenStore.name);

  constructor(@Inject(AGENT_CONFIG) private readonly config: AgentConfig) {}

  read(): StoredTokens {
    const path = this.config.tokenStorePath;
    if (!existsSync(path)) return {};
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as StoredTokens;
    } catch (err) {
      this.logger.warn(`Could not parse token store at ${path}: ${String(err)}`);
      return {};
    }
  }

  writeRefreshToken(refreshToken: string): void {
    const path = this.config.tokenStorePath;
    mkdirSync(dirname(path), { recursive: true });
    const data: StoredTokens = { refreshToken, obtainedAt: new Date().toISOString() };
    writeFileSync(path, JSON.stringify(data, null, 2), { mode: 0o600 });
  }

  clear(): void {
    const path = this.config.tokenStorePath;
    if (existsSync(path)) writeFileSync(path, JSON.stringify({}), { mode: 0o600 });
  }
}