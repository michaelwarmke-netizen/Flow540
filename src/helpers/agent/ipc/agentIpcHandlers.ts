import { AgentSessionManager } from '../core/agentSessionManager.ts';
import type { AgentRunOptions } from '../core/agentTypes.ts';
import { getAgentConfig, updateAgentConfig } from '../config/agent-config.ts';
import { Logger } from '../../logger.ts';
import { runActionItemAgent, type ActionItemExtractionOptions } from '../agents/actionItemAgent.ts';
import { runSuggestionsAgent, type SuggestionsAgentOptions } from '../agents/suggestionsAgent.ts';

const logger = new Logger('AgentIpcHandlers');
let sessionManagerInstance: AgentSessionManager | null = null;

export function getAgentSessionManager(): AgentSessionManager {
  if (!sessionManagerInstance) {
    sessionManagerInstance = new AgentSessionManager();
  }
  return sessionManagerInstance;
}

/**
 * Registers Electron IPC handlers for the Agent subsystem.
 *
 * @param ipcMain Electron `ipcMain` instance
 * @param shell Optional Electron `shell` instance to open browser URLs
 */
export function registerAgentIpcHandlers(ipcMain: any, shell?: any): void {
  const manager = getAgentSessionManager();
  const mcpClient = manager.getMcpClient();
  const tokenService = (mcpClient as any).tokens;

  /** Run an agent session, streaming step results back to the sender window. */
  ipcMain.handle('agent:run', async (event: any, options: AgentRunOptions) => {
    try {
      return await manager.startSession(options, (step) => {
        if (event.sender && !event.sender.isDestroyed()) {
          event.sender.send('agent:step', {
            sessionId: options.sessionId,
            step,
          });
        }
      });
    } catch (err: any) {
      logger.error(`Error during agent run: ${err?.message || err}`);
      return {
        sessionId: options.sessionId ?? '',
        error: String(err?.message || err),
      };
    }
  });

  /** Cancel an active session. */
  ipcMain.handle('agent:cancel', async (_event: any, sessionId: string) => {
    const cancelled = manager.cancelSession(sessionId);
    return { success: cancelled, sessionId };
  });

  /** List session metadata. */
  ipcMain.handle('agent:list-sessions', async () => {
    return manager.listSessions();
  });

  /** List available tools from the MCP server. */
  ipcMain.handle('agent:list-tools', async () => {
    try {
      const tools = await mcpClient.listTools();
      return { success: true, tools };
    } catch (err: any) {
      return { success: false, error: String(err?.message || err) };
    }
  });

  /** Execute a specific tool directly by name and arguments. */
  ipcMain.handle('agent:call-tool', async (_event: any, toolName: string, args: Record<string, unknown>) => {
    try {
      const result = await mcpClient.callTool(toolName, args || {});
      return { success: true, result };
    } catch (err: any) {
      return { success: false, error: String(err?.message || err) };
    }
  });

  /** Fetch token from sidecar endpoint (http://localhost:3540/oauth/token-info-raw). */
  ipcMain.handle('agent:login', async () => {
    try {
      const token = await tokenService.getAccessToken();
      return { success: true, token };
    } catch (err: any) {
      return { success: false, error: String(err?.message || err) };
    }
  });

  /** Extract action items directly from a transcript using ActionItemAgent. */
  ipcMain.handle('agent:extract-action-items', async (_event: any, options: ActionItemExtractionOptions) => {
    try {
      return await runActionItemAgent(options, mcpClient);
    } catch (err: any) {
      return {
        success: false,
        actionItems: [],
        summary: 'Extraction failed',
        rawText: '',
        error: String(err?.message || err),
        durationMs: 0,
      };
    }
  });

  /** Run Suggestions Agent analysis directly on a transcript or sprint metrics. */
  ipcMain.handle('agent:run-suggestions', async (_event: any, options: SuggestionsAgentOptions) => {
    try {
      return await runSuggestionsAgent(options, mcpClient);
    } catch (err: any) {
      return {
        success: false,
        suggestions: [],
        summary: 'Suggestions analysis failed',
        rawText: '',
        error: String(err?.message || err),
        durationMs: 0,
      };
    }
  });

  /** Process OAuth authorization code callback. */
  ipcMain.handle('agent:oauth-callback', async (_event: any, code: string, state: string) => {
    try {
      await tokenService.handleCallback(code, state);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: String(err?.message || err) };
    }
  });

  /** Get current access token claims & scope info. */
  ipcMain.handle('agent:token-info', async () => {
    try {
      const info = await tokenService.getTokenInfo();
      return { success: true, tokenInfo: info };
    } catch (err: any) {
      return { success: false, error: String(err?.message || err) };
    }
  });

  /** Clear session tokens (logout). */
  ipcMain.handle('agent:logout', async () => {
    try {
      tokenService.clearTokens();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: String(err?.message || err) };
    }
  });

  /** Get current agent configuration. */
  ipcMain.handle('agent:get-config', async () => {
    try {
      const config = getAgentConfig();
      return {
        success: true,
        config: {
          mcpServerUrl: config.mcpServerUrl,
          oauth: {
            issuer: config.oauth.issuer,
            authorizeUrl: config.oauth.authorizeUrl,
            tokenUrl: config.oauth.tokenUrl,
            redirectUri: config.oauth.redirectUri,
            clientId: config.oauth.clientId,
            clientSecret: config.oauth.clientSecret ? '***' : '',
            scopes: config.oauth.scopes,
            manualAccessToken: config.oauth.manualAccessToken ?? '',
          },
          llm: config.llm,
        },
      };
    } catch (err: any) {
      return { success: false, error: String(err?.message || err) };
    }
  });

  /** Update agent configuration. */
  ipcMain.handle('agent:update-config', async (_event: any, updates: any) => {
    try {
      const updated = updateAgentConfig(updates);
      mcpClient.reset();
      return { success: true, config: updated };
    } catch (err: any) {
      return { success: false, error: String(err?.message || err) };
    }
  });

  logger.info('Registered agent IPC handlers.');
}
