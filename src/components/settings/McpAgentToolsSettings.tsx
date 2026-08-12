import React, { useState, useEffect } from "react";
import {
  Server,
  Shield,
  Zap,
  Key,
  Save,
  Wrench,
  Loader2,
  AlertCircle,
  Terminal,
  Play,
  CheckCircle2,
} from "lucide-react";
import { Button } from "../ui/button";

export default function McpAgentToolsSettings() {
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
          setToolsError(
            "OAuth login flow launched in your browser. Complete consent and click 'List Available Agent Tools' again."
          );
        } else {
          setToolsError(res?.error || "Failed to launch OAuth login flow.");
        }
      }
    } catch (err: any) {
      setToolsError(err?.message || "Failed to start OAuth login.");
    }
  };

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

  return (
    <div className="space-y-6">
      {/* MCP Sandbox Endpoint & OAuth Gateway Configuration */}
      <div className="rounded-xl border border-border/50 bg-card p-5 space-y-4 shadow-xs">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Server size={16} className="text-emerald-500" /> Nexus MCP Sandbox & OAuth Gateway Configuration
            </h3>
            <p className="text-xs text-muted-foreground">
              Configure the HTTP endpoint for your Nexus MCP Sandbox server and OAuth Authorization Gateway.
            </p>
          </div>

          <Button
            size="sm"
            variant="outline"
            onClick={handleSaveMcpConfig}
            disabled={isConfigSaving}
            className="gap-1.5 text-xs font-semibold border-emerald-500/40 hover:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          >
            <Save size={13} />
            {isConfigSaving ? "Saving..." : configSaveSuccess ? "Saved!" : "Save Sandbox Endpoint"}
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div className="space-y-1.5">
            <label className="font-medium text-foreground flex items-center gap-1">
              <Server size={12} className="text-muted-foreground" /> MCP Server URL
            </label>
            <input
              type="text"
              value={mcpServerUrl}
              onChange={(e) => setMcpServerUrl(e.target.value)}
              placeholder="http://localhost:3005 or https://nexus-sandbox.example.com/mcp"
              className="w-full h-8 px-2.5 rounded border border-border/60 bg-background text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary font-mono"
            />
            <span className="text-[10px] text-muted-foreground block">
              JSON-RPC HTTP endpoint for the Nexus MCP sandbox server.
            </span>
          </div>

          <div className="space-y-1.5">
            <label className="font-medium text-foreground flex items-center gap-1">
              <Shield size={12} className="text-muted-foreground" /> OAuth Issuer / Auth Gateway Base URL
            </label>
            <input
              type="text"
              value={oauthIssuer}
              onChange={(e) => setOauthIssuer(e.target.value)}
              placeholder="http://localhost:3003 or https://auth.example.com"
              className="w-full h-8 px-2.5 rounded border border-border/60 bg-background text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary font-mono"
            />
            <span className="text-[10px] text-muted-foreground block">
              OAuth2 Authorization Server base URL.
            </span>
          </div>

          <div className="space-y-1.5">
            <label className="font-medium text-foreground flex items-center gap-1">
              <Zap size={12} className="text-muted-foreground" /> OAuth Client ID
            </label>
            <input
              type="text"
              value={oauthClientId}
              onChange={(e) => setOauthClientId(e.target.value)}
              placeholder="OAuth Client ID for Nexus Sandbox"
              className="w-full h-8 px-2.5 rounded border border-border/60 bg-background text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary font-mono"
            />
          </div>

          <div className="space-y-1.5">
            <label className="font-medium text-foreground flex items-center gap-1">
              <Shield size={12} className="text-muted-foreground" /> OAuth Client Secret
            </label>
            <input
              type="password"
              value={oauthClientSecret}
              onChange={(e) => setOauthClientSecret(e.target.value)}
              placeholder="Leave blank to keep existing secret"
              className="w-full h-8 px-2.5 rounded border border-border/60 bg-background text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary font-mono"
            />
          </div>

          <div className="space-y-1.5 md:col-span-2 pt-2 border-t border-border/30">
            <label className="font-medium text-foreground flex items-center gap-1">
              <Key size={12} className="text-amber-500" /> Static Access Token / Bearer Token (Manual Auth Bypass)
            </label>
            <input
              type="password"
              value={manualAccessToken}
              onChange={(e) => setManualAccessToken(e.target.value)}
              placeholder="Paste Bearer token here if OAuth server is unreachable on this machine"
              className="w-full h-8 px-2.5 rounded border border-border/60 bg-background text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary font-mono"
            />
            <span className="text-[10px] text-muted-foreground block">
              Bypasses live OAuth login. When set, this token is passed as <code>Authorization: Bearer &lt;token&gt;</code> directly to your MCP Sandbox server.
            </span>
          </div>
        </div>
      </div>

      {/* Agent Framework Available Tools Panel */}
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-5 space-y-4 shadow-xs">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Wrench size={16} className="text-primary" /> Agent Framework Tools
            </h3>
            <p className="text-xs text-muted-foreground">
              Inspect all Model Context Protocol (MCP) & Agent SDK tools currently available to the AI Agent.
            </p>
          </div>

          <Button
            size="sm"
            variant="outline"
            onClick={handleFetchAgentTools}
            disabled={isLoadingTools}
            className="gap-2 text-xs font-medium border-primary/40 hover:bg-primary/10"
          >
            {isLoadingTools ? (
              <>
                <Loader2 size={14} className="animate-spin text-primary" />
                Loading Tools...
              </>
            ) : (
              <>
                <Wrench size={14} className="text-primary" />
                List Available Agent Tools
              </>
            )}
          </Button>
        </div>

        {toolsError && (
          <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-xs flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <AlertCircle size={15} className="shrink-0" />
              <span>{toolsError}</span>
            </div>
            {(toolsError.includes("credentials") || toolsError.includes("authorize") || toolsError.includes("Login") || toolsError.includes("OAuth")) && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleAuthorizeAgent}
                className="gap-1.5 text-xs font-semibold border-amber-500/50 hover:bg-amber-500/20 shrink-0"
              >
                <Shield size={12} />
                Authorize Agent (OAuth Login)
              </Button>
            )}
          </div>
        )}

        {agentTools !== null && (
          <div className="space-y-2 pt-1">
            {agentTools.length === 0 ? (
              <div className="p-3 rounded-lg bg-surface-1 border border-border/40 text-xs text-muted-foreground text-center italic">
                No active external MCP tools connected. Connect an MCP server or verify OAuth login status.
              </div>
            ) : (
              <div className="space-y-3">
                {agentTools.map((t: any, idx: number) => {
                  const isExecuting = executingToolName === t.name;
                  const isExpanded = activeToolForRun === t.name;
                  const runResult = toolRunResults[t.name];

                  return (
                    <div
                      key={t.name || idx}
                      className="p-4 rounded-xl bg-card border border-border/60 space-y-3 shadow-2xs transition-all"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-primary flex items-center gap-1.5 bg-primary/10 px-2 py-0.5 rounded border border-primary/20">
                            <Terminal size={12} /> {t.name}
                          </span>
                          <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-surface-2 text-muted-foreground border border-border/40">
                            MCP Tool
                          </span>
                        </div>

                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setActiveToolForRun(isExpanded ? null : t.name)}
                          className="h-7 text-xs gap-1 text-primary hover:bg-primary/10"
                        >
                          <Play size={12} />
                          {isExpanded ? "Hide Test Runner" : "Test Tool"}
                        </Button>
                      </div>

                      <p className="text-xs text-foreground font-medium">{t.description}</p>

                      {isExpanded && (
                        <div className="pt-3 border-t border-border/40 space-y-3">
                          <div className="space-y-1.5">
                            <label className="text-[11px] font-semibold text-muted-foreground flex items-center justify-between">
                              <span>Tool Arguments (JSON or plain text input)</span>
                              <span className="font-mono text-[10px] text-primary">e.g. &#123;"query": "my search"&#125;</span>
                            </label>
                            <textarea
                              rows={2}
                              value={toolRunArgs[t.name] || ""}
                              onChange={(e) => setToolRunArgs((prev) => ({ ...prev, [t.name]: e.target.value }))}
                              placeholder='{"input": "parameter value"}'
                              className="w-full p-2 rounded border border-border/60 bg-background text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                          </div>

                          <div className="flex items-center justify-between">
                            <Button
                              size="sm"
                              onClick={() => handleExecuteTool(t.name)}
                              disabled={isExecuting}
                              className="gap-1.5 text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground"
                            >
                              {isExecuting ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                              {isExecuting ? "Executing..." : `Run ${t.name}`}
                            </Button>

                            {runResult && (
                              <button
                                type="button"
                                onClick={() => setShowRawResult((prev) => ({ ...prev, [t.name]: !prev[t.name] }))}
                                className="text-[11px] text-muted-foreground hover:text-foreground underline cursor-pointer"
                              >
                                {showRawResult[t.name] ? "View Clean Result" : "View Raw JSON"}
                              </button>
                            )}
                          </div>

                          {runResult && (
                            <div
                              className={`p-3 rounded-lg border text-xs font-mono overflow-x-auto max-h-60 ${
                                runResult.success
                                  ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300"
                                  : "border-red-500/30 bg-red-500/5 text-red-600 dark:text-red-400"
                              }`}
                            >
                              <div className="flex items-center gap-1.5 font-bold mb-1">
                                {runResult.success ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                                <span>{runResult.success ? "Execution Output" : "Execution Error"}</span>
                              </div>
                              <pre className="whitespace-pre-wrap text-[11px] font-mono">
                                {showRawResult[t.name]
                                  ? JSON.stringify(runResult, null, 2)
                                  : formatMcpResult(runResult)}
                              </pre>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
