const path = require("path");
const fs = require("fs");
const { app } = require("electron");
const { RetroRepository } = require("./retroRepository");
const debugLogger = require("./debugLogger");
const { chunkTranscript } = require("../utils/retroChunking.ts");
const { deduplicateProposals } = require("../utils/retroDedup.ts");
const { parseRetroResponse, buildRepairPrompt } = require("../utils/retroResponseParser.ts");
const { runActionItemAgent } = require("./agent/agents/actionItemAgent.ts");
const { runSuggestionsAgent } = require("./agent/agents/suggestionsAgent.ts");

class RetroAgentHandlers {
  constructor(databaseManager, broadcastToWindows, mcpClient) {
    this.databaseManager = databaseManager;
    this.broadcastToWindows = broadcastToWindows || (() => {});
    this._mcpClient = mcpClient || null;
    this._retroRepository = null;
  }

  _getMcpClient() {
    if (!this._mcpClient) {
      try {
        const { getAgentSessionManager } = require("./agent/ipc/agentIpcHandlers.ts");
        this._mcpClient = getAgentSessionManager().getMcpClient();
      } catch (err) {
        debugLogger.warn("Could not obtain McpClientService", { error: err.message });
      }
    }
    return this._mcpClient;
  }

  _getNotificationDispatcher(settings = {}) {
    const { NotificationDispatcher } = require("./agent/notifications/notificationDispatcher.ts");
    const repo = this._getRetroRepository();
    const mcpClient = this._getMcpClient();
    const modelOpts = this._resolveAgentModelSettings(settings);
    return new NotificationDispatcher(repo, mcpClient, modelOpts);
  }

  _getRetroRepository() {
    if (!this._retroRepository && this.databaseManager?.db) {
      this._retroRepository = new RetroRepository(this.databaseManager.db);
    }
    return this._retroRepository;
  }

  async handleInvoke(op, payload = {}, event = null) {
    const repo = this._getRetroRepository();
    const ALLOWED_OPS = new Set([
      "sprints.list",
      "sprints.get",
      "sprints.updateMetrics",
      "retro.create",
      "retro.get",
      "retro.update",
      "retro.list",
      "retro.copyAudio",
      "proposals.list",
      "proposals.accept",
      "proposals.dismiss",
      "actions.list",
      "actions.createManual",
      "actions.update",
      "actions.delete",
      "actions.listOwners",
      "jira.createMock",
      "models.describe",
      "analysis.run",
      "projects.list",
      "projects.get",
      "projects.create",
      "projects.update",
      "projects.delete",
      "coach.suggestTopics",
      "coach.listTopics",
      "coach.updateTopic",
      "coach.acceptTopic",
      "coach.dismissTopic",
      "coach.listOutcomes",
      "coach.listInsights",
      "coach.listSlackNotifications",
      "coach.sendSlack",
      "coach.runMidSprintFollowup",
      "demo.resetData",
    ]);

    if (!ALLOWED_OPS.has(op)) {
      throw new Error(`Invalid retro operation: ${op}`);
    }

    switch (op) {
      case "sprints.list":
        return repo.listSprints();
      case "sprints.get":
        return repo.getSprintSnapshot(payload.sprintId);
      case "sprints.updateMetrics":
        return repo.updateSprintMetrics(payload.sprintId, payload.metrics);
      case "retro.create":
        return repo.createRetrospective(payload);
      case "retro.get":
        return repo.getRetrospective(payload.id);
      case "retro.update":
        return repo.updateRetrospective(payload.id, payload.updates);
      case "retro.list":
        return repo.listRetrospectives();
      case "retro.copyAudio": {
        const { sourcePath, retrospectiveId } = payload;
        const ext = path.extname(sourcePath) || ".wav";
        const retroAudioDir = path.join(app.getPath("userData"), "retro-audio");
        fs.mkdirSync(retroAudioDir, { recursive: true });
        const destPath = path.join(retroAudioDir, `${retrospectiveId}${ext}`);
        fs.copyFileSync(sourcePath, destPath);
        return { copiedPath: destPath };
      }
      case "proposals.list":
        return repo.listProposals(payload.retrospectiveId);
      case "proposals.accept":
        return repo.acceptProposal(payload.proposalId, payload.editedData);
      case "proposals.dismiss":
        return repo.dismissProposal(payload.proposalId);
      case "actions.list":
        return repo.listTrackedActions(payload);
      case "actions.createManual":
        return repo.createManualAction(payload);
      case "actions.update":
        return repo.updateTrackedAction(payload.id, payload.updates);
      case "actions.delete":
        return repo.deleteTrackedAction(payload.id);
      case "actions.listOwners":
        return repo.listOwners();
      case "jira.createMock":
        return repo.createMockJiraTicket(
          payload.trackedActionId,
          payload.summary,
          payload.description
        );
      case "models.describe":
        return this.describeRetroModel(payload || {});
      case "analysis.run":
        return this.runRetroAnalysis(
          payload.retrospectiveId,
          payload.settings || {},
          event?.sender
        );
      case "projects.list":
        return repo.listProjects();
      case "projects.get":
        return repo.getProject(payload.id);
      case "projects.create":
        return repo.createProject(payload);
      case "projects.update":
        return repo.updateProject(payload.id, payload.updates);
      case "projects.delete":
        return repo.deleteProject(payload.id);
      case "coach.suggestTopics":
        return this.suggestCoachTopics(payload.projectId, payload.sprintId, payload.settings);
      case "coach.listTopics":
        return repo.listTopics(payload?.projectId, payload?.sprintId);
      case "coach.updateTopic":
        return repo.updateTopic(payload.id, payload.updates);
      case "coach.acceptTopic":
        return repo.acceptTopic(payload.id);
      case "coach.dismissTopic":
        return repo.dismissTopic(payload.id);
      case "coach.listOutcomes":
        return repo.listTopicOutcomes(payload.retrospectiveId);
      case "coach.listInsights":
        return repo.listInsights(payload?.projectId);
      case "coach.listSlackNotifications":
        return repo.listSlackNotifications(payload?.projectId);
      case "coach.sendSlack":
        return this.sendSlackNotification(payload);
      case "coach.runMidSprintFollowup":
        return this.runMidSprintFollowup(payload.projectId, payload.sprintId);
      case "demo.resetData":
        return repo.resetDemoData();
      default:
        throw new Error(`Unsupported retro op: ${op}`);
    }
  }

  cancelAnalysis(retrospectiveId) {
    const localBridge = require("../services/localReasoningBridge").default;
    localBridge.cancelAnalysis(retrospectiveId);
    return { success: true };
  }

  async describeRetroModel(settings = {}) {
    const mode = settings.retroAnalystMode || "local";
    const provider = settings.retroAnalystProvider || settings.cleanupProvider || "qwen";
    const rawModelId = settings.retroAnalystModel || settings.retroReasoningModel || settings.cleanupModel || null;

    const isCloudMode = mode === "providers" || mode === "cloud" || mode === "byok" || mode === "openwhispr";
    const isCloudProvider = ["gemini", "openai", "anthropic", "groq", "tinfoil", "openrouter", "custom"].includes(provider);

    if (isCloudMode || isCloudProvider) {
      let displayName = rawModelId;
      if (provider === "gemini") {
        displayName = rawModelId ? `Google Gemini (${rawModelId})` : "Google Gemini";
      } else if (provider === "openai") {
        displayName = rawModelId ? `OpenAI (${rawModelId})` : "OpenAI";
      } else if (provider === "anthropic") {
        displayName = rawModelId ? `Anthropic (${rawModelId})` : "Anthropic";
      } else if (provider === "groq") {
        displayName = rawModelId ? `Groq (${rawModelId})` : "Groq";
      } else if (provider === "tinfoil") {
        displayName = rawModelId ? `Tinfoil (${rawModelId})` : "Tinfoil";
      } else if (provider === "openrouter") {
        displayName = rawModelId ? `OpenRouter (${rawModelId})` : "OpenRouter";
      } else if (!displayName) {
        displayName = `${provider || "Cloud"} Model`;
      }
      return {
        available: true,
        modelId: displayName,
        providerId: provider,
        contextLength: 32768,
      };
    }

    const modelManager = require("./modelManagerBridge").default;
    const localBridge = require("../services/localReasoningBridge").default;
    const isAvailable = await localBridge.isAvailable();

    let targetModelId = rawModelId;

    let isDownloaded = false;
    if (targetModelId) {
      isDownloaded = await modelManager.isModelDownloaded(targetModelId);
    }

    if (!isDownloaded) {
      try {
        const allModels = await modelManager.getAllModels();
        const downloadedModel = allModels.find((m) => m.isDownloaded);
        if (downloadedModel) {
          targetModelId = downloadedModel.id;
          isDownloaded = true;
        }
      } catch (err) {
        debugLogger.error("Failed to query downloaded local models", { error: err.message });
      }
    }

    if (!targetModelId || !isDownloaded || !isAvailable) {
      return { available: false, modelId: targetModelId || null, providerId: "local", contextLength: 4096 };
    }

    const modelInfo = modelManager.findModelById(targetModelId);
    const contextLength = modelInfo?.model?.contextLength || 4096;

    return {
      available: true,
      modelId: targetModelId,
      providerId: "local",
      contextLength,
    };
  }

  async runRetroAnalysis(retrospectiveId, settings = {}, senderWindow) {
    const repo = this._getRetroRepository();
    const retro = await repo.getRetrospective(retrospectiveId);
    if (!retro) throw new Error("Retrospective not found");

    const sprint = await repo.getSprintSnapshot(retro.sprint_id);

    await repo.updateRetrospective(retrospectiveId, { processing_state: "analyzing" });

    const emitProgress = (stage, chunkIndex = 0, chunkCount = 1, error = null) => {
      const data = { retrospectiveId, stage, chunkIndex, chunkCount, error };
      if (senderWindow && !senderWindow.isDestroyed()) {
        senderWindow.send("retro:analysis-progress", data);
      }
      this.broadcastToWindows("retro:analysis-progress", data);
    };

    emitProgress("analyzing", 0, 2);

    const meetingOwner = retro.meeting_owner || settings.meetingOwner || settings.uploaderIdentity || "Unassigned";
    const modelOpts = this._resolveAgentModelSettings(settings);

    const context = {
      meetingTitle: retro.title || `Retrospective ${retrospectiveId}`,
      sprintId: retro.sprint_id,
      projectContext: sprint ? `Sprint: ${sprint.name}` : undefined,
      sprintMetrics: sprint
        ? {
            name: sprint.name,
            committedPoints: sprint.committed_points,
            completedPoints: sprint.completed_points,
            velocity: sprint.velocity,
            completedIssues: sprint.completed_issues,
            totalIssues: sprint.total_issues,
            blockedIssues: sprint.blocked_issues,
            burndownTrend: sprint.burndown_trend,
            blockers: sprint.blockers,
          }
        : undefined,
    };

    // Agent 1: Run ActionItemAgent to extract explicit commitments
    const actionResult = await runActionItemAgent({
      transcript: retro.transcript || "",
      context,
      provider: modelOpts.provider,
      model: modelOpts.model,
    });

    if (!actionResult.success) {
      debugLogger.warn("ActionItemAgent extraction failed", { error: actionResult.error });
    }

    emitProgress("analyzing", 1, 2);

    // Agent 2: Run SuggestionsAgent to generate suggestions & team improvements
    const coachResult = await runSuggestionsAgent({
      transcript: retro.transcript || "",
      context,
      provider: modelOpts.provider,
      model: modelOpts.model,
    });

    if (!coachResult.success) {
      debugLogger.warn("SuggestionsAgent analysis failed", { error: coachResult.error });
    }

    emitProgress("parsing", 2, 2);

    const rawParsedItems = [];

    // Map Action Items
    if (actionResult.success && actionResult.actionItems) {
      for (const item of actionResult.actionItems) {
        rawParsedItems.push({
          title: item.task,
          description: item.quote || item.task,
          owner: item.assignee && item.assignee !== "Unassigned" ? item.assignee : meetingOwner,
          estimateValue: 1,
          estimateUnit: "hours",
          source: "explicit",
        });
      }
    }

    // Map Coach Suggestions
    if (coachResult.success && coachResult.suggestions) {
      for (const item of coachResult.suggestions) {
        rawParsedItems.push({
          title: item.title,
          description: item.description,
          basis: item.basis,
          owner: item.owner && item.owner !== "Unassigned" ? item.owner : meetingOwner,
          estimateValue: 1,
          estimateUnit: "hours",
          source: "coach",
        });
      }
    }

    const existingProposals = await repo.listProposals(retrospectiveId);
    const existingActions = await repo.listTrackedActions();
    const excludeTitlesSet = new Set([
      ...existingProposals.map((p) => p.title),
      ...existingActions.map((a) => a.title),
    ]);

    const deduped = deduplicateProposals(rawParsedItems, excludeTitlesSet);

    const nextRunCount = (retro.analysis_run_count || 0) + 1;
    const saved = await repo.saveProposals(retrospectiveId, deduped, nextRunCount);

    await repo.updateRetrospective(retrospectiveId, { processing_state: "completed" });
    emitProgress("completed", 2, 2);

    // --- Autonomous Notification Trigger Dispatch ---
    try {
      if (retro.project_id) {
        const dispatcher = this._getNotificationDispatcher(settings);
        const insights = await repo.listInsights(retro.project_id);

        // 1. Dispatch postRetroSummary
        await dispatcher.dispatch("postRetroSummary", {
          projectId: retro.project_id,
          proposals: saved.map((p) => ({ title: p.title, owner: p.owner, description: p.description })),
          retroTitle: retro.title,
          sprintName: sprint?.name,
        });

        // 2. Dispatch insightShare
        await dispatcher.dispatch("insightShare", {
          projectId: retro.project_id,
          insights: insights,
          sprintName: sprint?.name,
        });
      }
    } catch (dispatchErr) {
      debugLogger.warn("Post-analysis notification dispatch failed (non-fatal)", { error: dispatchErr.message });
    }

    return saved;
  }

  _resolveAgentModelSettings(settings = {}) {
    const s = settings.settings || settings;
    const provider = s.provider || s.retroAnalystProvider || s.cloudTranscriptionProvider || null;
    const model = s.model || s.retroAnalystModel || s.retroReasoningModel || null;
    const apiKey = s.apiKey || s.geminiApiKey || s.openaiApiKey || s.anthropicApiKey || undefined;
    debugLogger.info(`Resolved Agent model settings: provider="${provider}", model="${model}"`);
    return { provider, model, apiKey };
  }

  async suggestCoachTopics(projectId, sprintId, settings = {}) {
    const repo = this._getRetroRepository();
    const sprint = await repo.getSprintSnapshot(sprintId);
    const existingActions = await repo.listTrackedActions({ sprintId });
    const modelOpts = this._resolveAgentModelSettings(settings);

    const defaultTopics = [
      {
        project_id: projectId || "proj-default-gen-eng",
        sprint_id: sprintId,
        title: "Sprint Blocker Resolution & PR Review Delays",
        rationale: `Metrics show velocity impacted by blockers (${sprint?.blockers || "PR review delays"}).`,
        category: "metric_driven",
        priority: 1,
        state: "suggested",
      },
      {
        project_id: projectId || "proj-default-gen-eng",
        sprint_id: sprintId,
        title: "Capacity Planning & Commitment vs Completion Gap",
        rationale: `Team completed ${sprint?.completed_points || 0} out of ${sprint?.committed_points || 0} committed points.`,
        category: "metric_driven",
        priority: 2,
        state: "suggested",
      },
      {
        project_id: projectId || "proj-default-gen-eng",
        sprint_id: sprintId,
        title: "Carried-Over Action Item Follow-Through",
        rationale: `${existingActions.length} action items carried over from previous sprints need attention.`,
        category: "carryover",
        priority: 3,
        state: "suggested",
      },
    ];

    try {
      const context = {
        meetingTitle: `Retrospective Agenda Planning for Sprint ${sprint?.name || sprintId || 'Current'}`,
        sprintMetrics: sprint
          ? {
              name: sprint.name,
              committedPoints: sprint.committed_points,
              completedPoints: sprint.completed_points,
              velocity: sprint.velocity,
              completedIssues: sprint.completed_issues,
              totalIssues: sprint.total_issues,
              blockedIssues: sprint.blocked_issues,
              burndownTrend: sprint.burndown_trend,
              blockers: sprint.blockers,
            }
          : undefined,
        previousActionItems: existingActions.map((a) => a.title),
      };

      const agentResult = await runSuggestionsAgent({
        context,
        provider: modelOpts.provider,
        model: modelOpts.model,
      });

      if (agentResult.success && agentResult.suggestions && agentResult.suggestions.length > 0) {
        const generatedTopics = agentResult.suggestions.map((s, idx) => ({
          project_id: projectId || "proj-default-gen-eng",
          sprint_id: sprintId,
          title: s.title,
          rationale: s.basis || s.description,
          category: s.category || "metric_driven",
          priority: idx + 1,
          state: "suggested",
        }));
        await repo.saveTopics(generatedTopics);
      } else {
        await repo.saveTopics(defaultTopics);
      }
    } catch (err) {
      debugLogger.warn("Failed SuggestionsAgent topic generation; falling back to default topics", { error: err.message });
      await repo.saveTopics(defaultTopics);
    }

    // --- Autonomous Notification Trigger Dispatch ---
    try {
      const targetProjectId = projectId || "proj-default-gen-eng";
      const topics = await repo.listTopics(targetProjectId, sprintId);
      const carriedActions = existingActions.filter((a) => a.status !== "completed");
      const dispatcher = this._getNotificationDispatcher(settings);

      // 1. Dispatch preRetroPreview
      await dispatcher.dispatch("preRetroPreview", {
        projectId: targetProjectId,
        topics: topics.map((t) => ({ title: t.title, rationale: t.rationale, state: t.state })),
        sprintName: sprint?.name,
      });

      // 2. Dispatch ownerReminder
      await dispatcher.dispatch("ownerReminder", {
        projectId: targetProjectId,
        actionItems: carriedActions.map((a) => ({ title: a.title, owner: a.owner, status: a.status })),
        sprintName: sprint?.name,
      });
    } catch (dispatchErr) {
      debugLogger.warn("Pre-retro notification dispatch failed (non-fatal)", { error: dispatchErr.message });
    }

    return repo.listTopics(projectId, sprintId);
  }

  async evaluateTopicCoverage(retrospectiveId, sprintId, transcript, modelStatus) {
    const repo = this._getRetroRepository();
    const topics = await repo.listTopics(null, sprintId);
    const acceptedTopics = topics.filter((t) => t.state === "accepted");
    if (!acceptedTopics.length) return [];

    const localBridge = require("../services/localReasoningBridge").default;
    const topicListText = acceptedTopics
      .map((t, idx) => `${idx + 1}. [ID: ${t.id}] Title: "${t.title}" — Rationale: "${t.rationale}"`)
      .join("\n");

    const prompt =
      `Analyze the retrospective transcript below and evaluate how well the accepted coaching topics were discussed in the meeting:\n\n` +
      `COACHING TOPICS:\n${topicListText}\n\n` +
      `TRANSCRIPT:\n${transcript.slice(0, 8000)}\n\n` +
      `Return ONLY a JSON object with this exact schema:\n` +
      `{\n` +
      `  "outcomes": [\n` +
      `    {\n` +
      `      "topic_id": "...",\n` +
      `      "coverage_score": 0.8,\n` +
      `      "engagement_depth": "deep",\n` +
      `      "speaker_count": 3,\n` +
      `      "sentiment": "positive",\n` +
      `      "agent_notes": "...",\n` +
      `      "relevant_quotes": ["..."]\n` +
      `    }\n` +
      `  ]\n` +
      `}\n` +
      `coverage_score is 0.0 to 1.0. engagement_depth is "superficial", "moderate", or "deep". sentiment is "positive", "neutral", or "frustrated". Return valid JSON only with no prose.`;

    const output = await localBridge.processText(prompt, modelStatus.modelId, {
      priority: "batch",
      temperature: 0.1,
      maxTokens: 2048,
      timeoutMs: 60000,
    });

    const cleanJson = output.replace(/```json/gi, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleanJson);
    const outcomes = (parsed.outcomes || []).map((o) => ({
      topic_id: o.topic_id,
      retrospective_id: retrospectiveId,
      coverage_score: Number(o.coverage_score) || 0.5,
      engagement_depth: o.engagement_depth || "moderate",
      speaker_count: Number(o.speaker_count) || 1,
      sentiment: o.sentiment || "neutral",
      agent_notes: o.agent_notes || "",
      relevant_quotes: JSON.stringify(o.relevant_quotes || []),
    }));

    return repo.saveTopicOutcomes(outcomes);
  }

  async runMidSprintFollowup(projectId, sprintId) {
    const repo = this._getRetroRepository();
    const targetProjectId = projectId || "proj-default-gen-eng";
    const actions = await repo.listTrackedActions({ sprintId });
    const openActions = actions.filter((a) => a.status !== "completed");

    const dispatcher = this._getNotificationDispatcher();
    const result = await dispatcher.dispatch("actionFollowup", {
      projectId: targetProjectId,
      actionItems: openActions.map((a) => ({ title: a.title, owner: a.owner, status: a.status })),
      sprintName: sprintId,
    });

    return { dispatched: result.status === "sent", result };
  }

  async sendSlackNotification(payload) {
    const repo = this._getRetroRepository();
    const { projectId, messageType } = payload;
    const targetProjectId = projectId || "proj-default-gen-eng";

    const dispatcher = this._getNotificationDispatcher(payload);

    const context = { projectId: targetProjectId };

    try {
      if (messageType === "preRetroPreview") {
        const topics = await repo.listTopics(targetProjectId);
        context.topics = topics.map((t) => ({ title: t.title, rationale: t.rationale, state: t.state }));
      } else if (messageType === "ownerReminder" || messageType === "actionFollowup") {
        const actions = await repo.listTrackedActions();
        context.actionItems = actions.map((a) => ({ title: a.title, owner: a.owner, status: a.status }));
      } else if (messageType === "postRetroSummary") {
        const proposals = await repo.listProposals();
        context.proposals = proposals.map((p) => ({ title: p.title, owner: p.owner, description: p.description }));
      } else if (messageType === "insightShare") {
        const insights = await repo.listInsights(targetProjectId);
        context.insights = insights;
      }
    } catch (ctxErr) {
      debugLogger.warn("Context fetch error for test dispatch", { error: ctxErr.message });
    }

    const result = await dispatcher.dispatch(messageType, context, { throwOnError: true });

    if (result.notificationRecordId) {
      const savedRow = repo.db?.prepare("SELECT * FROM coach_slack_notifications WHERE id = ?")?.get(result.notificationRecordId);
      if (savedRow) {
        return {
          ...savedRow,
          tool_calls_count: result.toolCallsCount,
          executed_tools: result.executedTools,
        };
      }
    }

    return {
      id: "dispatch-" + Date.now(),
      project_id: targetProjectId,
      recipient_name: result.recipientName || "Team Channel",
      message_type: messageType,
      message_content: result.content || `[Result] Status: ${result.status}`,
      status: result.status,
      tool_calls_count: result.toolCallsCount,
      executed_tools: result.executedTools,
    };
  }
}

module.exports = { RetroAgentHandlers };
