import { runAgent } from '../core/agentOrchestrator.ts';
import type { McpClientService } from '../mcp/mcp-client.service.ts';
import { Logger } from '../../logger.ts';
import { NOTIFICATION_AGENT_SYSTEM_PROMPT, buildNotificationPrompt } from './notificationPrompts.ts';
import type {
  DeliveryChannel,
  DispatchResult,
  NotificationConfig,
  NotificationDispatchContext,
  NotificationTypeSetting,
  TriggerKey,
} from './notificationTypes.ts';

import { mapActionItemOwners } from '../../../utils/mcpNameMapper.ts';

const logger = new Logger('NotificationDispatcher');

export class NotificationDispatcher {
  private repo: any;
  private mcpClient?: McpClientService;
  private modelOpts?: { provider?: string; model?: string; apiKey?: string };

  constructor(
    repo: any,
    mcpClient?: McpClientService,
    modelOpts?: { provider?: string; model?: string; apiKey?: string }
  ) {
    this.repo = repo;
    this.mcpClient = mcpClient;
    this.modelOpts = modelOpts;
  }

  /**
   * Dispatch a single notification trigger if enabled for the project.
   *
   * @param triggerKey The trigger to evaluate & dispatch
   * @param context Contextual data for composing the notification
   * @param options Options control error throwing (e.g. UI test button vs background automation)
   */
  async dispatch(
    triggerKey: TriggerKey,
    context: NotificationDispatchContext & { channel?: DeliveryChannel },
    options: { throwOnError?: boolean; channel?: DeliveryChannel } = {}
  ): Promise<DispatchResult> {
    let recipientName = 'Unknown';
    let targetProjectId = context.projectId || 'proj-default-gen-eng';

    try {
      if (!this.repo) {
        throw new Error('Repository is not available in NotificationDispatcher');
      }

      let project = await this.repo.getProject(context.projectId);
      if (!project && this.repo.listProjects) {
        const projects = await this.repo.listProjects();
        project =
          projects?.find(
            (p: any) => p.id === context.projectId || p.project_id === context.projectId
          ) || null;
      }

      if (!project) {
        const err = `Project not found: ${context.projectId}`;
        if (options.throwOnError) throw new Error(err);
        return {
          success: false,
          triggerKey,
          recipientName,
          content: '',
          status: 'failed',
          error: err,
        };
      }

      targetProjectId = project.id;
      const config = this.parseNotificationConfig(project.notification_settings);
      const triggerSetting: NotificationTypeSetting = config[triggerKey] || {
        enabled: true,
        channel: 'slack',
      };

      if (!triggerSetting.enabled && !options.channel) {
        logger.info(`Trigger '${triggerKey}' is disabled for project '${project.name}'; skipping.`);
        return {
          success: true,
          triggerKey,
          recipientName: '',
          content: '',
          status: 'skipped',
        };
      }

      const overrideChannel = options.channel || context.channel;
      const channel: DeliveryChannel =
        overrideChannel === 'email'
          ? 'email'
          : overrideChannel === 'slack'
          ? 'slack'
          : triggerSetting.channel === 'email'
          ? 'email'
          : 'slack';

      const slackChannel = context.slackChannelId || project.slack_channel_id || '';
      recipientName =
        channel === 'email'
          ? config.teamEmails?.trim()
            ? `Email (${config.teamEmails.trim()})`
            : 'Email (Team via MCP Resolution)'
          : slackChannel.trim()
          ? `Slack (#${slackChannel.trim()})`
          : 'Slack (#general)';

      const mappedContext: NotificationDispatchContext = {
        ...context,
        slackChannelId: slackChannel,
        projectIdCode: project.project_id,
        actionItems: context.actionItems ? mapActionItemOwners(context.actionItems) : undefined,
        proposals: context.proposals ? mapActionItemOwners(context.proposals) : undefined,
      };

      const prompt = buildNotificationPrompt(
        triggerKey,
        mappedContext,
        channel,
        config.senderEmail,
        config.teamEmails
      );

      logger.info(`Dispatching AI notification for '${triggerKey}' via ${channel.toUpperCase()} to ${recipientName}`);

      const agentResult = await runAgent(
        {
          prompt,
          systemPrompt: NOTIFICATION_AGENT_SYSTEM_PROMPT,
          provider: this.modelOpts?.provider,
          model: this.modelOpts?.model,
          apiKey: this.modelOpts?.apiKey,
          maxSteps: 25,
        },
        this.mcpClient
      );

      const executedTools = agentResult.steps.flatMap((s) =>
        s.toolCalls.map((tc) => {
          const res = s.toolResults.find((r) => r.toolCallId === tc.toolCallId);
          return {
            toolName: tc.toolName,
            args: tc.args,
            result: res?.result,
          };
        })
      );

      const toolSummary =
        executedTools.length > 0
          ? `\n\n[MCP Tools Executed (${executedTools.length})]: ${executedTools.map((t) => t.toolName).join(', ')}`
          : '\n\n[MCP Tools Executed (0)]: No MCP tools were invoked by the LLM.';

      logger.info(
        `Notification agent run completed for '${triggerKey}'. Executed ${executedTools.length} MCP tool call(s): [${
          executedTools.map((t) => t.toolName).join(', ') || 'none'
        }]`
      );

      // executedTools.forEach((t, i) => {
      //   logger.info(
      //     `[NotificationDispatcher Tool #${i + 1}: ${t.toolName}]\nInput Args: ${JSON.stringify(
      //       t.args,
      //       null,
      //       2
      //     )}\nResult Output: ${JSON.stringify(t.result, null, 2)}`
      //   );
      // });

      const content =
        (agentResult.text?.trim() || `[Agile Coach Notification] Automated dispatch for '${triggerKey}' executed.`) +
        toolSummary;

      let notificationRecord: any = null;
      if (this.repo.saveSlackNotification) {
        notificationRecord = await this.repo.saveSlackNotification({
          project_id: targetProjectId,
          recipient_name: recipientName,
          recipient_slack_id: '',
          message_type: triggerKey,
          message_content: content,
          status: 'sent',
        });
      }

      return {
        success: true,
        triggerKey,
        recipientName,
        content,
        status: 'sent',
        notificationRecordId: notificationRecord?.id,
        toolCallsCount: agentResult.toolCallsCount,
        executedTools,
      };
    } catch (err: any) {
      const errorMsg = String(err?.message || err);
      logger.warn(`Failed to dispatch notification '${triggerKey}': ${errorMsg}`);

      if (this.repo?.saveSlackNotification) {
        try {
          await this.repo.saveSlackNotification({
            project_id: targetProjectId,
            recipient_name: recipientName,
            recipient_slack_id: '',
            message_type: triggerKey,
            message_content: `[Dispatch Failed] ${errorMsg}`,
            status: 'failed',
          });
        } catch (dbErr) {
          logger.error(`Failed to save audit failure record: ${String(dbErr)}`);
        }
      }

      if (options.throwOnError) {
        throw new Error(`Notification dispatch failed: ${errorMsg}`);
      }

      return {
        success: false,
        triggerKey,
        recipientName,
        content: '',
        status: 'failed',
        error: errorMsg,
      };
    }
  }

  private parseNotificationConfig(rawSettings: any): NotificationConfig {
    const defaultConfig: NotificationConfig = {
      senderEmail: '',
      teamEmails: '',
      actionFollowupDaysAfterSprintStart: 7,
      preRetroPreview: { enabled: true, channel: 'slack' },
      ownerReminder: { enabled: true, channel: 'slack' },
      postRetroSummary: { enabled: true, channel: 'slack' },
      actionFollowup: { enabled: true, channel: 'slack' },
      insightShare: { enabled: true, channel: 'slack' },
    };

    if (!rawSettings) return defaultConfig;

    try {
      const parsed = typeof rawSettings === 'string' ? JSON.parse(rawSettings) : rawSettings;

      const normalize = (val: any): NotificationTypeSetting => {
        if (typeof val === 'boolean') return { enabled: val, channel: 'slack' };
        if (val && typeof val === 'object') {
          return {
            enabled: val.enabled ?? true,
            channel: val.channel === 'email' ? 'email' : 'slack',
          };
        }
        return { enabled: true, channel: 'slack' };
      };

      return {
        senderEmail: parsed.senderEmail || '',
        teamEmails: parsed.teamEmails || '',
        actionFollowupDaysAfterSprintStart:
          typeof parsed.actionFollowupDaysAfterSprintStart === 'number'
            ? parsed.actionFollowupDaysAfterSprintStart
            : 7,
        preRetroPreview: normalize(parsed.preRetroPreview),
        ownerReminder: normalize(parsed.ownerReminder),
        postRetroSummary: normalize(parsed.postRetroSummary),
        actionFollowup: normalize(parsed.actionFollowup),
        insightShare: normalize(parsed.insightShare),
      };
    } catch (_) {
      return defaultConfig;
    }
  }
}
