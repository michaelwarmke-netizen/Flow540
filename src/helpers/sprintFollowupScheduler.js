const debugLogger = require("./debugLogger");

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

class SprintFollowupScheduler {
  constructor(getRetroAgentHandlers) {
    this.getRetroAgentHandlers = getRetroAgentHandlers;
    this.intervalId = null;
  }

  start() {
    if (this.intervalId) return;

    loggerInfo("Starting Sprint Follow-up Scheduler (6-hour interval)");
    // Run an initial check shortly after app startup (e.g. after 30s)
    setTimeout(() => this.checkAndTriggerFollowups(), 30000);

    this.intervalId = setInterval(() => {
      this.checkAndTriggerFollowups();
    }, SIX_HOURS_MS);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      loggerInfo("Stopped Sprint Follow-up Scheduler");
    }
  }

  async checkAndTriggerFollowups() {
    try {
      const handlers = this.getRetroAgentHandlers();
      if (!handlers) return;

      const repo = handlers._getRetroRepository();
      if (!repo) return;

      const sprints = await repo.listSprints();
      if (!sprints || sprints.length === 0) return;

      const projects = await repo.listProjects();
      const projectList = projects && projects.length > 0 ? projects : [{ id: "proj-default-gen-eng", name: "Default Project" }];

      const now = Date.now();

      for (const sprint of sprints) {
        if (!sprint.created_at) continue;
        const sprintStart = new Date(sprint.created_at).getTime();
        if (isNaN(sprintStart)) continue;

        for (const project of projectList) {
          const config = this.parseNotificationConfig(project.notification_settings);
          if (!config.actionFollowup?.enabled) continue;

          const daysOffset = config.actionFollowupDaysAfterSprintStart ?? 7;
          const targetTime = sprintStart + daysOffset * 24 * 60 * 60 * 1000;

          // Only fire if we are past the scheduled target time
          if (now < targetTime) continue;

          // Dedup check: query coach_slack_notifications to ensure actionFollowup was not sent for this sprint/project
          const existingLogs = await repo.listSlackNotifications(project.id);
          const alreadySent = existingLogs.some(
            (log) =>
              log.message_type === "actionFollowup" &&
              new Date(log.sent_at).getTime() >= sprintStart
          );

          if (!alreadySent) {
            debugLogger.info(`Sprint Followup Scheduler triggering 'actionFollowup' for project '${project.id}', sprint '${sprint.id}'`);
            await handlers.runMidSprintFollowup(project.id, sprint.id);
          }
        }
      }
    } catch (err) {
      debugLogger.warn("Sprint Followup Scheduler check failed", { error: err?.message || err });
    }
  }

  parseNotificationConfig(rawSettings) {
    if (!rawSettings) return { actionFollowup: { enabled: true }, actionFollowupDaysAfterSprintStart: 7 };
    try {
      const parsed = typeof rawSettings === "string" ? JSON.parse(rawSettings) : rawSettings;
      return {
        actionFollowup:
          typeof parsed.actionFollowup === "object"
            ? parsed.actionFollowup
            : { enabled: parsed.actionFollowup ?? true },
        actionFollowupDaysAfterSprintStart:
          typeof parsed.actionFollowupDaysAfterSprintStart === "number"
            ? parsed.actionFollowupDaysAfterSprintStart
            : 7,
      };
    } catch (_) {
      return { actionFollowup: { enabled: true }, actionFollowupDaysAfterSprintStart: 7 };
    }
  }
}

function loggerInfo(msg) {
  debugLogger.info(`[SprintFollowupScheduler] ${msg}`);
}

module.exports = { SprintFollowupScheduler };
