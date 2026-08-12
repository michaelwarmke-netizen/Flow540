import React, { useState, useEffect } from "react";
import {
  type Project,
  type CoachSlackNotification,
  retroClient,
} from "../../services/retro/client";
import {
  Bell,
  MessageSquare,
  Send,
  Save,
  CheckCircle2,
  AlertCircle,
  Hash,
  Folder,
  Shield,
  Zap,
  Users,
  TrendingUp,
  Mail,
  Server,
  Play,
  Loader2,
  Wrench,
  Terminal,
  Key,
} from "lucide-react";
import { Button } from "../ui/button";

interface NotificationsViewProps {
  currentProject: Project | null;
  onProjectUpdate: () => void;
}

export type DeliveryChannel = "slack" | "email";

export type NotificationTriggerKey =
  | "preRetroPreview"
  | "ownerReminder"
  | "postRetroSummary"
  | "actionFollowup"
  | "insightShare";

export interface NotificationTypeSetting {
  enabled: boolean;
  channel: DeliveryChannel;
}

export interface NotificationConfig {
  senderEmail?: string;
  teamEmails?: string;
  actionFollowupDaysAfterSprintStart?: number;
  preRetroPreview: NotificationTypeSetting;
  ownerReminder: NotificationTypeSetting;
  postRetroSummary: NotificationTypeSetting;
  actionFollowup: NotificationTypeSetting;
  insightShare: NotificationTypeSetting;
}

const DEFAULT_TYPE_SETTING: NotificationTypeSetting = {
  enabled: true,
  channel: "slack",
};

const DEFAULT_CONFIG: NotificationConfig = {
  senderEmail: "",
  teamEmails: "",
  actionFollowupDaysAfterSprintStart: 7,
  preRetroPreview: { enabled: true, channel: "slack" },
  ownerReminder: { enabled: true, channel: "slack" },
  postRetroSummary: { enabled: true, channel: "slack" },
  actionFollowup: { enabled: true, channel: "slack" },
  insightShare: { enabled: true, channel: "slack" },
};

function normalizeSetting(val: any): NotificationTypeSetting {
  if (typeof val === "boolean") {
    return { enabled: val, channel: "slack" };
  }
  if (val && typeof val === "object") {
    const ch = val.channel === "email" ? "email" : "slack";
    return {
      enabled: val.enabled ?? true,
      channel: ch,
    };
  }
  return DEFAULT_TYPE_SETTING;
}

export function NotificationsView({ currentProject, onProjectUpdate }: NotificationsViewProps) {
  const [projectIdCode, setProjectIdCode] = useState<string>("");
  const [slackChannelId, setSlackChannelId] = useState<string>("");
  const [senderEmail, setSenderEmail] = useState<string>("");
  const [teamEmails, setTeamEmails] = useState<string>("");
  const [actionFollowupDays, setActionFollowupDays] = useState<number>(7);

  const [config, setConfig] = useState<NotificationConfig>(DEFAULT_CONFIG);
  const [notifications, setNotifications] = useState<CoachSlackNotification[]>([]);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);
  const [testingKey, setTestingKey] = useState<string | null>(null);
  const [testSuccessKey, setTestSuccessKey] = useState<string | null>(null);

  const [agentTools, setAgentTools] = useState<any[] | null>(null);
  const [isLoadingTools, setIsLoadingTools] = useState<boolean>(false);
  const [toolsError, setToolsError] = useState<string | null>(null);

  const [mcpServerUrl, setMcpServerUrl] = useState<string>("http://localhost:3005");
  const [oauthIssuer, setOauthIssuer] = useState<string>("http://localhost:3003");
  const [oauthClientId, setOauthClientId] = useState<string>("");
  const [oauthClientSecret, setOauthClientSecret] = useState<string>("");
  const [manualAccessToken, setManualAccessToken] = useState<string>("");
  const [isConfigSaving, setIsConfigSaving] = useState<boolean>(false);
  const [configSaveSuccess, setConfigSaveSuccess] = useState<boolean>(false);

  const [activeToolForRun, setActiveToolForRun] = useState<string | null>(null);
  const [toolRunArgs, setToolRunArgs] = useState<Record<string, string>>({});
  const [executingToolName, setExecutingToolName] = useState<string | null>(null);
  const [toolRunResults, setToolRunResults] = useState<Record<string, any>>({});
  const [showRawResult, setShowRawResult] = useState<Record<string, boolean>>({});

  const formatMcpResult = (runResult: any) => {
    if (!runResult) return "";
    if (!runResult.success) {
      return runResult.error || JSON.stringify(runResult, null, 2);
    }

    const rawObj = runResult.result || runResult;
    const content = rawObj?.content || rawObj?.result?.content;

    if (Array.isArray(content)) {
      const unescapedBlocks = content.map((item: any) => {
        if (item && item.type === "text" && typeof item.text === "string") {
          const trimmed = item.text.trim();
          if (
            (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
            (trimmed.startsWith("[") && trimmed.endsWith("]"))
          ) {
            try {
              const parsed = JSON.parse(trimmed);
              return JSON.stringify(parsed, null, 2);
            } catch (_) {}
          }
          return item.text;
        }
        return typeof item === "string" ? item : JSON.stringify(item, null, 2);
      });

      return unescapedBlocks.join("\n\n---\n\n");
    }

    return JSON.stringify(rawObj, null, 2);
  };

  const handleExecuteTool = async (toolName: string) => {
    setExecutingToolName(toolName);
    try {
      let parsedArgs: Record<string, unknown> = {};
      const rawInput = toolRunArgs[toolName] || "";
      if (rawInput.trim().startsWith("{")) {
        parsedArgs = JSON.parse(rawInput);
      } else if (rawInput.trim()) {
        parsedArgs = { input: rawInput.trim() };
      } else {
        parsedArgs = {};
      }

      const api = (window as any).electronAPI;
      if (api?.agentCallTool) {
        const res = await api.agentCallTool(toolName, parsedArgs);
        setToolRunResults((prev) => ({
          ...prev,
          [toolName]: res,
        }));
      }
    } catch (err: any) {
      setToolRunResults((prev) => ({
        ...prev,
        [toolName]: { success: false, error: err?.message || String(err) },
      }));
    } finally {
      setExecutingToolName(null);
    }
  };

  useEffect(() => {
    const api = (window as any).electronAPI;
    if (api?.agentGetConfig) {
      api.agentGetConfig().then((res: any) => {
        if (res?.success && res.config) {
          if (res.config.mcpServerUrl) setMcpServerUrl(res.config.mcpServerUrl);
          if (res.config.oauth?.issuer) setOauthIssuer(res.config.oauth.issuer);
          if (res.config.oauth?.clientId) setOauthClientId(res.config.oauth.clientId);
          if (res.config.oauth?.manualAccessToken) setManualAccessToken(res.config.oauth.manualAccessToken);
        }
      });
    }
  }, []);

  const handleSaveMcpConfig = async () => {
    setIsConfigSaving(true);
    setConfigSaveSuccess(false);
    try {
      const api = (window as any).electronAPI;
      if (api?.agentUpdateConfig) {
        const res = await api.agentUpdateConfig({
          mcpServerUrl: mcpServerUrl.trim(),
          oauth: {
            issuer: oauthIssuer.trim(),
            clientId: oauthClientId.trim(),
            manualAccessToken: manualAccessToken.trim(),
            ...(oauthClientSecret ? { clientSecret: oauthClientSecret.trim() } : {}),
          },
        });
        if (res?.success) {
          setConfigSaveSuccess(true);
          setTimeout(() => setConfigSaveSuccess(false), 3000);
          handleFetchAgentTools();
        }
      }
    } catch (err) {
      console.error("Failed to update MCP agent config:", err);
    } finally {
      setIsConfigSaving(false);
    }
  };

  const handleFetchAgentTools = async () => {
    setIsLoadingTools(true);
    setToolsError(null);
    try {
      const api = (window as any).electronAPI;
      if (api?.agentListTools) {
        const res = await api.agentListTools();
        if (res?.success) {
          setAgentTools(res.tools || []);
        } else {
          setToolsError(res?.error || "Failed to retrieve agent tools.");
        }
      } else {
        setToolsError("Agent IPC interface not available.");
      }
    } catch (err: any) {
      setToolsError(err?.message || "Error fetching agent tools.");
    } finally {
      setIsLoadingTools(false);
    }
  };

  const handleAuthorizeAgent = async () => {
    try {
      const api = (window as any).electronAPI;
      if (api?.agentLogin) {
        const res = await api.agentLogin();
        if (res?.success) {
          setToolsError("OAuth login flow launched in your browser. Complete consent and click 'List Available Agent Tools' again.");
        } else {
          setToolsError(res?.error || "Failed to launch OAuth login flow.");
        }
      }
    } catch (err: any) {
      setToolsError(err?.message || "Failed to start OAuth login.");
    }
  };

  useEffect(() => {
    if (currentProject) {
      setProjectIdCode(currentProject.project_id || "");
      setSlackChannelId(currentProject.slack_channel_id || "");

      let parsedConfig = DEFAULT_CONFIG;
      if (currentProject.notification_settings) {
        try {
          const raw =
            typeof currentProject.notification_settings === "string"
              ? JSON.parse(currentProject.notification_settings)
              : currentProject.notification_settings;

          parsedConfig = {
            senderEmail: raw.senderEmail || "",
            teamEmails: raw.teamEmails || "",
            actionFollowupDaysAfterSprintStart:
              typeof raw.actionFollowupDaysAfterSprintStart === "number"
                ? raw.actionFollowupDaysAfterSprintStart
                : 7,
            preRetroPreview: normalizeSetting(raw.preRetroPreview),
            ownerReminder: normalizeSetting(raw.ownerReminder),
            postRetroSummary: normalizeSetting(raw.postRetroSummary),
            actionFollowup: normalizeSetting(raw.actionFollowup),
            insightShare: normalizeSetting(raw.insightShare),
          };
        } catch (_) {}
      }

      setSenderEmail(parsedConfig.senderEmail || "");
      setTeamEmails(parsedConfig.teamEmails || "");
      setActionFollowupDays(parsedConfig.actionFollowupDaysAfterSprintStart ?? 7);
      setConfig(parsedConfig);
      loadSlackLogs(currentProject.id);
    }
  }, [currentProject?.id]);

  const loadSlackLogs = async (projId: string) => {
    try {
      const logs = await retroClient.listSlackNotifications(projId);
      setNotifications(logs || []);
    } catch (err) {
      console.error("Failed to load delivery logs", err);
    }
  };

  const handleToggle = (key: NotificationTriggerKey) => {
    setConfig((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        enabled: !prev[key].enabled,
      },
    }));
  };

  const handleChannelChange = (
    key: NotificationTriggerKey,
    channel: DeliveryChannel
  ) => {
    setConfig((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        channel,
      },
    }));
  };

  const handleTestTrigger = async (key: string, title: string, channel: DeliveryChannel) => {
    if (!currentProject) return;
    setTestingKey(key);
    setTestSuccessKey(null);
    try {
      const recipient =
        channel === "email"
          ? teamEmails.trim()
            ? `Email (${teamEmails.trim()})`
            : "Email (Team Member)"
          : slackChannelId.trim()
          ? `Slack (#${slackChannelId.trim()})`
          : "Slack (#general)";

      await retroClient.sendSlack({
        projectId: currentProject.id,
        recipientName: recipient,
        messageType: key,
        channel,
        content: `[TEST TRIGGER] Sample automated dispatch for '${title}' via ${channel.toUpperCase()}${
          channel === "email" && senderEmail ? ` (From: ${senderEmail})` : ""
        }.`,
      });
      await loadSlackLogs(currentProject.id);
      setTestSuccessKey(key);
      setTimeout(() => setTestSuccessKey(null), 3000);
    } catch (err) {
      console.error("Failed to trigger test notification", err);
    } finally {
      setTestingKey(null);
    }
  };

  const handleSaveSettings = async () => {
    if (!currentProject) return;
    setIsSaving(true);
    setSaveSuccess(false);

    const payloadConfig = {
      ...config,
      senderEmail,
      teamEmails,
      actionFollowupDaysAfterSprintStart: actionFollowupDays,
    };

    try {
      await retroClient.updateProject(currentProject.id, {
        project_id: projectIdCode,
        slack_channel_id: slackChannelId,
        notification_settings: JSON.stringify(payloadConfig),
      });
      setSaveSuccess(true);
      onProjectUpdate();
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      console.error("Failed to save notification settings", err);
    } finally {
      setIsSaving(false);
    }
  };

  if (!currentProject) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        Please select a project to configure notification settings.
      </div>
    );
  }

  const notificationTypes: {
    key: NotificationTriggerKey;
    title: string;
    icon: React.ReactNode;
    description: string;
    badge: string;
  }[] = [
    {
      key: "preRetroPreview",
      title: "Pre-Retro Topic Preview",
      icon: <Zap size={16} className="text-amber-500" />,
      description: "Sends the coaching discussion agenda preview to team members prior to the retro meeting.",
      badge: "24h Before Retro",
    },
    {
      key: "ownerReminder",
      title: "Action Item Owner Reminders",
      icon: <Users size={16} className="text-blue-500" />,
      description: "Sends reminders to team members who own open carried-over action items before retro.",
      badge: "Owner Notification",
    },
    {
      key: "postRetroSummary",
      title: "Post-Retro Personal Summaries",
      icon: <CheckCircle2 size={16} className="text-emerald-500" />,
      description: "Sends personalized summaries to participants with their assigned action items after retro analysis.",
      badge: "Post Analysis",
    },
    {
      key: "actionFollowup",
      title: "Mid-Sprint Action Follow-Up",
      icon: <TrendingUp size={16} className="text-teal-500" />,
      description: "Sends mid-sprint progress check-ins to action owners regarding item completion.",
      badge: "Mid-Sprint",
    },
    {
      key: "insightShare",
      title: "Coach Insight Share",
      icon: <Shield size={16} className="text-purple-500" />,
      description: "Posts coach-detected team patterns, blind spots, and positive trends to the team.",
      badge: "Team Share",
    },
  ];

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header Banner */}
      <div className="flex items-center justify-between border-b border-border/40 pb-4">
        <div className="space-y-1">
          <h2 className="text-base font-bold text-foreground flex items-center gap-2">
            <Bell className="text-primary" size={20} /> Project Notification Settings
          </h2>
          <p className="text-xs text-muted-foreground">
            Configure Slack MCP & Email connections and delivery preferences for{" "}
            <span className="font-semibold text-foreground">{currentProject.name}</span>.
          </p>
        </div>

        <Button
          size="sm"
          onClick={handleSaveSettings}
          disabled={isSaving}
          className="gap-2 text-xs font-semibold bg-primary hover:bg-primary/90"
        >
          <Save size={14} /> {isSaving ? "Saving..." : "Save Settings"}
        </Button>
      </div>

      {saveSuccess && (
        <div className="p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-medium flex items-center gap-2">
          <CheckCircle2 size={16} /> Notification settings updated successfully for {currentProject.name}.
        </div>
      )}

      {/* Expanded Integration Connections Panel */}
      <div className="rounded-xl border border-border/50 bg-card p-5 space-y-5 shadow-xs">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Server size={16} className="text-primary" /> Integration Connections
        </h3>

        {/* Connection Options Grid: Slack & Email */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
          {/* Slack Connection Box */}
          <div className="p-4 rounded-xl border border-blue-500/30 bg-blue-500/5 space-y-3">
            <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 font-semibold text-xs">
              <MessageSquare size={16} /> Slack Integration (MCP)
            </div>

            <div className="space-y-1.5">
              <label className="font-medium text-foreground flex items-center gap-1">
                <Hash size={13} className="text-muted-foreground" /> Target Slack Channel ID
              </label>
              <input
                type="text"
                value={slackChannelId}
                onChange={(e) => setSlackChannelId(e.target.value)}
                placeholder="e.g. C098765432"
                className="w-full h-8 px-2.5 rounded border border-border/60 bg-background text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary font-mono"
              />
              <span className="text-[10px] text-muted-foreground block">
                Target Slack channel used by Slack MCP for broadcasts.
              </span>
            </div>

            <div className="space-y-1.5 pt-1">
              <label className="font-medium text-foreground flex items-center gap-1">
                <Folder size={13} className="text-muted-foreground" /> MCP Project ID Code
              </label>
              <input
                type="text"
                value={projectIdCode}
                onChange={(e) => setProjectIdCode(e.target.value)}
                placeholder="e.g. PROJ-PAYMENTS-01"
                className="w-full h-8 px-2.5 rounded border border-border/60 bg-background text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary font-mono"
              />
              <span className="text-[10px] text-muted-foreground block">
                Used by Project MCP to match speaker & owner names for DMs.
              </span>
            </div>
          </div>

          {/* Email Connection Box */}
          <div className="p-4 rounded-xl border border-purple-500/30 bg-purple-500/5 space-y-3">
            <div className="flex items-center gap-2 text-purple-600 dark:text-purple-400 font-semibold text-xs">
              <Mail size={16} /> Email Notification Service
            </div>

            <div className="space-y-1.5">
              <label className="font-medium text-foreground flex items-center gap-1">
                <Mail size={13} className="text-muted-foreground" /> Sender Email Address
              </label>
              <input
                type="email"
                value={senderEmail}
                onChange={(e) => setSenderEmail(e.target.value)}
                placeholder="e.g. coach@openwhispr.ai"
                className="w-full h-8 px-2.5 rounded border border-border/60 bg-background text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary font-mono"
              />
              <span className="text-[10px] text-muted-foreground block">
                Email address used as 'From' sender for email notifications.
              </span>
            </div>

            <div className="space-y-1.5 pt-1">
              <label className="font-medium text-foreground flex items-center gap-1">
                <TrendingUp size={13} className="text-muted-foreground" /> Mid-Sprint Follow-Up Schedule (Days Offset)
              </label>
              <input
                type="number"
                min={1}
                max={30}
                value={actionFollowupDays}
                onChange={(e) => setActionFollowupDays(parseInt(e.target.value, 10) || 7)}
                className="w-full h-8 px-2.5 rounded border border-border/60 bg-background text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary font-mono"
              />
              <span className="text-[10px] text-muted-foreground block">
                Days after sprint start when mid-sprint action follow-up triggers automatically.
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Notification Types Config List */}
      <div className="rounded-xl border border-border/50 bg-card p-5 space-y-4 shadow-xs">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Send size={16} className="text-primary" /> Agile Coach Notification Triggers
          </h3>
          <span className="text-xs text-muted-foreground">Toggle dispatches, select channel, and test triggers</span>
        </div>

        <div className="space-y-3">
          {notificationTypes.map((item) => {
            const itemSetting = config[item.key] || DEFAULT_TYPE_SETTING;
            const isEnabled = itemSetting.enabled;
            const channel = itemSetting.channel || "slack";
            const isTesting = testingKey === item.key;
            const isSuccess = testSuccessKey === item.key;

            return (
              <div
                key={item.key}
                className={`p-4 rounded-xl border transition-all flex items-center justify-between gap-4 ${
                  isEnabled ? "border-border/60 bg-surface-1/40" : "border-border/30 bg-muted/20 opacity-70"
                }`}
              >
                {/* Left Side: Icon, Title, Badge, Description */}
                <div className="space-y-1 min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {item.icon}
                    <span className="font-semibold text-xs text-foreground">{item.title}</span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-surface-1 border border-border/40 text-muted-foreground">
                      {item.badge}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">{item.description}</p>
                </div>

                {/* Right Side: Test Trigger button + Channel Toggle (Slack / Email) + ON/OFF Toggle */}
                <div className="flex items-center gap-3 shrink-0">
                  {/* Test Button */}
                  <Button
                    size="sm"
                    variant={isSuccess ? "default" : "outline"}
                    onClick={() => handleTestTrigger(item.key, item.title, channel)}
                    disabled={!isEnabled || isTesting}
                    className={`gap-1.5 text-xs h-8 px-2.5 font-medium transition-all ${
                      isSuccess
                        ? "bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600"
                        : "border-border/60 hover:bg-surface-1"
                    }`}
                    title="Send a sample test notification"
                  >
                    {isTesting ? (
                      <>
                        <Loader2 size={12} className="animate-spin" />
                        Testing...
                      </>
                    ) : isSuccess ? (
                      <>
                        <CheckCircle2 size={12} className="text-white" />
                        Sent!
                      </>
                    ) : (
                      <>
                        <Play size={12} className="text-primary fill-primary" />
                      </>
                    )}
                  </Button>

                  {/* Channel Toggle (Slack vs Email) - rendered when enabled */}
                  {isEnabled && (
                    <div className="flex items-center p-0.5 rounded-lg bg-surface-1 border border-border/60 text-xs font-medium">
                      <button
                        type="button"
                        onClick={() => handleChannelChange(item.key, "slack")}
                        className={`px-2.5 py-1 rounded-md text-xs font-medium flex items-center gap-1 transition-all cursor-pointer ${
                          channel === "slack"
                            ? "bg-blue-600 text-white font-semibold shadow-xs"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <MessageSquare size={12} /> Slack
                      </button>

                      <button
                        type="button"
                        onClick={() => handleChannelChange(item.key, "email")}
                        className={`px-2.5 py-1 rounded-md text-xs font-medium flex items-center gap-1 transition-all cursor-pointer ${
                          channel === "email"
                            ? "bg-purple-600 text-white font-semibold shadow-xs"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <Mail size={12} /> Email
                      </button>
                    </div>
                  )}

                  {/* Enable / Disable ON/OFF Toggle */}
                  <button
                    type="button"
                    onClick={() => handleToggle(item.key)}
                    className={`w-11 h-6 shrink-0 rounded-full p-0.5 transition-colors duration-200 ease-in-out cursor-pointer ${
                      isEnabled ? "bg-primary" : "bg-muted"
                    }`}
                  >
                    <div
                      className={`w-5 h-5 rounded-full bg-white shadow-md transform transition-transform duration-200 ease-in-out ${
                        isEnabled ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Notification Delivery Audit Trail */}
      <div className="rounded-xl border border-border/50 bg-card p-5 space-y-4 shadow-xs">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <MessageSquare size={16} className="text-blue-500" /> Recent Delivery Logs
        </h3>

        <div className="space-y-2">
          {notifications.length === 0 ? (
            <p className="text-xs text-muted-foreground italic py-3 text-center border border-dashed border-border/50 rounded-lg">
              No notifications dispatched for this project yet.
            </p>
          ) : (
            notifications.map((n) => (
              <div key={n.id} className="p-3 rounded-lg bg-surface-1 border border-border/40 text-xs space-y-1">
                <div className="flex items-center justify-between font-semibold">
                  <span className="text-blue-600 dark:text-blue-400 capitalize">
                    {n.message_type.replace(/_/g, " ")} → {n.recipient_name}
                  </span>
                  <span className="text-[10px] text-muted-foreground font-normal">
                    {new Date(n.sent_at).toLocaleString()}
                  </span>
                </div>
                <p className="text-foreground font-mono text-[11px] bg-background/50 p-2 rounded border border-border/30">
                  {n.message_content}
                </p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
