import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AgentConfig } from '../config/agent-config.ts';
import { loadAgentConfig } from '../config/agent-config.ts';
import { Logger } from '../../logger.ts';

export interface StoredTokens {
  refreshToken?: string;
  obtainedAt?: string;
}

/**
 * Persists the OAuth refresh token to a JSON file so `agent login`
 * survives restarts. Access tokens are kept in memory only.
 */
export class TokenStore {
  private readonly logger = new Logger(TokenStore.name);
  private readonly config: AgentConfig;

  constructor(config: AgentConfig = loadAgentConfig()) {
    this.config = config;
  }

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
