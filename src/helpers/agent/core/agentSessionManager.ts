import { Logger } from '../../logger.ts';
import { McpClientService } from '../mcp/mcp-client.service.ts';
import type { AgentRunOptions, AgentRunResult, AgentSessionInfo, AgentStepResult } from './agentTypes.ts';
import { runAgent } from './agentOrchestrator.ts';

/**
 * Manages the lifecycle, execution, and cancellation of active agent sessions.
 */
export class AgentSessionManager {
  private readonly logger = new Logger(AgentSessionManager.name);
  private readonly activeSessions = new Map<string, AgentSessionInfo>();
  private readonly abortControllers = new Map<string, AbortController>();
  private readonly mcpClient: McpClientService;

  constructor(mcpClient: McpClientService = new McpClientService()) {
    this.mcpClient = mcpClient;
  }

  /**
   * Starts a new agent session. Supports cancellation and step progress callbacks.
   */
  async startSession(
    options: AgentRunOptions,
    onStepFinish?: (step: AgentStepResult) => void,
  ): Promise<AgentRunResult> {
    const sessionId = options.sessionId ?? `session-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const abortController = new AbortController();

    this.abortControllers.set(sessionId, abortController);
    const sessionInfo: AgentSessionInfo = {
      sessionId,
      prompt: options.prompt,
      status: 'running',
      startedAt: new Date().toISOString(),
    };
    this.activeSessions.set(sessionId, sessionInfo);

    try {
      const result = await runAgent(
        {
          ...options,
          sessionId,
          abortSignal: abortController.signal,
          onStepFinish: (step) => {
            onStepFinish?.(step);
          },
        },
        this.mcpClient,
      );

      sessionInfo.status = 'completed';
      sessionInfo.completedAt = new Date().toISOString();
      return result;
    } catch (err: any) {
      if (err?.name === 'AbortError' || abortController.signal.aborted) {
        sessionInfo.status = 'cancelled';
        sessionInfo.completedAt = new Date().toISOString();
        throw new Error(`Agent session [${sessionId}] was cancelled.`);
      }
      sessionInfo.status = 'error';
      sessionInfo.error = String(err?.message || err);
      sessionInfo.completedAt = new Date().toISOString();
      throw err;
    } finally {
      this.abortControllers.delete(sessionId);
    }
  }

  /**
   * Cancels a running session by ID.
   */
  cancelSession(sessionId: string): boolean {
    const controller = this.abortControllers.get(sessionId);
    if (!controller) return false;

    this.logger.info(`Cancelling session [${sessionId}]`);
    controller.abort();
    this.abortControllers.delete(sessionId);

    const session = this.activeSessions.get(sessionId);
    if (session) {
      session.status = 'cancelled';
      session.completedAt = new Date().toISOString();
    }
    return true;
  }

  /** Gets metadata for a specific session. */
  getSession(sessionId: string): AgentSessionInfo | undefined {
    return this.activeSessions.get(sessionId);
  }

  /** Lists all sessions. */
  listSessions(): AgentSessionInfo[] {
    return Array.from(this.activeSessions.values());
  }

  /** Returns the underlying {@link McpClientService}. */
  getMcpClient(): McpClientService {
    return this.mcpClient;
  }
}
