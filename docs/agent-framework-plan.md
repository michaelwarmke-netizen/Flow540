# Agent Framework Implementation Plan

## Executive Summary

The example project copied into `src/helpers/{config,mcp,oauth}` uses **Google ADK (Agent Development Kit)** with NestJS to drive an agentic loop against the Nexus MCP sandbox. ADK is tightly coupled to the Gemini ecosystem and requires adapter work for local models; it's a poor fit for an Electron desktop app that already speaks to 8+ cloud providers and multiple local runtimes.

**Recommendation: Use the Vercel AI SDK (`ai`)** — the framework this project already depends on — to build the agent loop. The AI SDK provides a built-in multi-step tool-calling loop (`generateText` with `maxSteps`), native MCP integration (`@ai-sdk/mcp`), and seamless compatibility with every provider and local runtime the app already supports.

> [!IMPORTANT]
> This is a **zero new framework** approach. The `ai` package (v6) is already a production dependency. We add only `@ai-sdk/mcp` (~30 KB) for MCP tool bridging.

---

## Why Not Google ADK?

| Concern | Google ADK | Vercel AI SDK |
|---|---|---|
| **Model lock-in** | Designed for Gemini; other providers need LiteLLM proxy | All 8 installed providers work natively |
| **Local model support** | Requires translation layer for llama.cpp / MLX / Ollama | `@ai-sdk/openai` with custom `baseURL` — already in use |
| **Server coupling** | JS SDK designed around server contexts (the copied code used NestJS DI) | Runs headless in any Node.js process — Electron main process is first-class |
| **Dependency overhead** | New framework to install, learn, and maintain | Already installed; team knows the API from cleanup/reasoning/retro paths |
| **MCP support** | Built-in, but wrapped in its own abstractions | `@ai-sdk/mcp` bridges MCP tools directly into `generateText()` |

Other frameworks considered:

- **LangChain.js** — Feature-rich but heavyweight (tens of MBs), WASM tokenizer overhead, deep dependency tree. Overkill for our needs.
- **Mastra** — Interesting dual MCP client/server support, but heavy footprint and designed as a server framework.

---

## Current State of the Codebase

### What We Already Have

| Layer | Status | Files |
|---|---|---|
| **Vercel AI SDK** | ✅ Installed (v6) with 8 provider packages | `package.json` |
| **Cloud providers** | ✅ OpenAI, Gemini, Anthropic, Azure, Bedrock, Groq, Vertex | `@ai-sdk/*` packages |
| **Local runtimes** | ✅ llama.cpp, MLX, Ollama (via OpenAI-compat) | `llamaServer.js`, `mlxServer.js` |
| **MCP client** | ✅ Refactored (NestJS removed) — JSON-RPC over HTTP | `src/helpers/mcp/mcp-client.service.ts` |
| **OAuth / token management** | ✅ Refactored (NestJS removed) — PKCE + refresh | `src/helpers/oauth/token.service.ts` |
| **Agent config** | ✅ Environment-driven config with `maxToolTurns` | `src/helpers/config/agent-config.ts` |
| **Reasoning routing** | ✅ Routes to correct provider based on user settings | `reasoningRouting.js` |
| **Single-turn AI calls** | ✅ `generateText()` used for cleanup, enterprise reasoning | `ipcHandlers.js` |

### What's Missing

| Layer | Status | What's needed |
|---|---|---|
| **Multi-step agent loop** | ❌ | `generateText()` with `tools` + `maxSteps` |
| **MCP → AI SDK tool bridge** | ❌ | `@ai-sdk/mcp` or manual adapter wrapping `McpClientService` |
| **Agent orchestrator** | ❌ | Module that wires provider + MCP tools + system prompt + loop together |
| **IPC surface for agent** | ❌ | Electron IPC handlers to start/stream/cancel agent sessions |
| **Agent config generalization** | ❌ | Current `GeminiConfig` → provider-agnostic `AgentLlmConfig` |

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Electron Renderer                     │
│  (React UI — chat panel, agent status, tool call feed)  │
└────────────────────────┬────────────────────────────────┘
                         │ IPC (invoke / stream)
┌────────────────────────▼────────────────────────────────┐
│                   Electron Main Process                  │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │              Agent Orchestrator                    │   │
│  │  ┌──────────┐  ┌───────────┐  ┌──────────────┐  │   │
│  │  │ Provider  │  │   Tool    │  │   Session    │  │   │
│  │  │ Resolver  │  │  Registry │  │   Manager    │  │   │
│  │  └─────┬─────┘  └─────┬─────┘  └──────┬───────┘  │   │
│  │        │              │               │           │   │
│  │        ▼              ▼               ▼           │   │
│  │   ┌─────────────────────────────────────────┐    │   │
│  │   │     Vercel AI SDK  generateText()       │    │   │
│  │   │     model + tools + maxSteps            │    │   │
│  │   └───────────┬──────────────┬──────────────┘    │   │
│  │               │              │                    │   │
│  └───────────────┼──────────────┼────────────────────┘   │
│                  │              │                         │
│       ┌──────────▼───┐   ┌─────▼──────────┐             │
│       │  LLM Provider │   │  MCP Tools     │             │
│       │  (any of 8+   │   │  (via bridge)  │             │
│       │  cloud or     │   │                │             │
│       │  local)       │   │  ┌───────────┐ │             │
│       └──────────────┘   │  │ OAuth      │ │             │
│                          │  │ Bearer     │ │             │
│                          │  └──────┬──────┘ │             │
│                          └─────────┼────────┘             │
└────────────────────────────────────┼─────────────────────┘
                                     │ HTTPS + JSON-RPC
                              ┌──────▼──────┐
                              │  Nexus MCP  │
                              │  Sandbox    │
                              └─────────────┘
```

### Key Components

#### 1. Provider Resolver (`agentProviderResolver.ts`)

Reuses the existing reasoning routing logic to select the correct Vercel AI SDK model instance based on user settings. Supports all current modes:

- **Cloud (OpenWhispr)** — `@ai-sdk/google`, `@ai-sdk/openai`, etc.
- **BYOK** — User's own API key + any provider
- **Local** — llama.cpp / MLX server via `@ai-sdk/openai` with `baseURL`
- **Self-hosted** — Ollama or custom OpenAI-compatible endpoint
- **Enterprise** — Azure, Bedrock, Vertex with corporate credentials

#### 2. MCP Tool Bridge (`mcpToolBridge.ts`)

Two implementation paths (choose based on project needs):

**Option A — Use `@ai-sdk/mcp` directly (recommended if the MCP server supports SSE/HTTP transport):**
```typescript
import { createMCPClient } from '@ai-sdk/mcp';

const client = await createMCPClient({
  transport: {
    type: 'sse',
    url: config.mcpServerUrl,
    headers: { Authorization: `Bearer ${await tokens.getAccessToken()}` },
  },
});
const mcpTools = await client.tools(); // AI SDK tool format
```

**Option B — Wrap existing `McpClientService` (preserves the OAuth + stateless HTTP JSON-RPC client we already refactored):**
```typescript
import { tool } from 'ai';
import { z } from 'zod';

function bridgeMcpTools(mcpTools: McpTool[], mcpClient: McpClientService) {
  return Object.fromEntries(
    mcpTools.map((t) => [
      t.name,
      tool({
        description: t.description ?? '',
        parameters: z.object({}), // or convert inputSchema
        execute: async (args) => {
          const result = await mcpClient.callTool(t.name, args);
          return result.content.map((c) => c.text).join('\n');
        },
      }),
    ])
  );
}
```

> [!TIP]
> Option B keeps the existing `McpClientService` (with its stateless JSON-RPC transport and OAuth token injection) and wraps each MCP tool as a Vercel AI SDK `tool()`. This is the safest path since the MCP client is already tested and working.

#### 3. Agent Orchestrator (`agentOrchestrator.ts`)

The core loop — a thin wrapper around `generateText()`:

```typescript
import { generateText } from 'ai';

export interface AgentRunOptions {
  prompt: string;
  systemPrompt?: string;
  maxSteps?: number;       // maps to agent-config maxToolTurns
  maxOutputTokens?: number;
  onStepFinish?: (step: StepResult) => void;
  abortSignal?: AbortSignal;
}

export async function runAgent(options: AgentRunOptions) {
  const model = await resolveAgentModel();  // Provider Resolver
  const tools = await loadMcpTools();        // MCP Tool Bridge

  const result = await generateText({
    model,
    system: options.systemPrompt ?? DEFAULT_AGENT_SYSTEM_PROMPT,
    prompt: options.prompt,
    tools,
    maxSteps: options.maxSteps ?? agentConfig.gemini.maxToolTurns,
    maxOutputTokens: options.maxOutputTokens ?? agentConfig.gemini.maxOutputTokens,
    onStepFinish: options.onStepFinish,
    abortSignal: options.abortSignal,
  });

  return {
    text: result.text,
    steps: result.steps,
    toolCalls: result.steps.flatMap((s) => s.toolCalls),
    usage: result.usage,
  };
}
```

#### 4. Session Manager (`agentSessionManager.ts`)

Manages agent lifecycle within the Electron app:

- Tracks active agent sessions (one per chat/conversation)
- Provides `AbortController` per session for cancellation
- Streams `onStepFinish` events to the renderer via IPC
- Manages conversation history for multi-turn agent sessions

#### 5. IPC Handlers (`agentIpcHandlers.ts`)

Exposes the agent to the renderer process:

```typescript
ipcMain.handle('agent:run', async (event, { prompt, sessionId }) => { ... });
ipcMain.handle('agent:cancel', async (event, { sessionId }) => { ... });
ipcMain.handle('agent:list-tools', async () => { ... });
ipcMain.handle('agent:token-info', async () => { ... }); // OAuth introspection
ipcMain.handle('agent:login', async () => { ... });       // OAuth PKCE flow
```

---

## Config Changes

### Generalize `GeminiConfig` → `AgentLlmConfig`

The current `agent-config.ts` has a `gemini` section hardcoded for Gemini. Generalize it to be provider-agnostic while keeping backward compatibility:

```typescript
export interface AgentLlmConfig {
  /** Provider identifier: 'gemini', 'openai', 'local', 'ollama', etc. */
  provider: string;
  /** API key (for cloud providers) */
  apiKey: string;
  /** Model identifier */
  model: string;
  /** Base URL override (for local/self-hosted) */
  baseUrl?: string;
  /** Max agentic loop iterations */
  maxToolTurns: number;
  /** Max output tokens per generation */
  maxOutputTokens: number;
}
```

The `loadAgentConfig()` function maps from env vars:

| Env Var | Default | Description |
|---|---|---|
| `AGENT_LLM_PROVIDER` | `gemini` | Which provider to use |
| `AGENT_LLM_API_KEY` / `GEMINI_API_KEY` | — | API key (falls back to `GEMINI_API_KEY` for compat) |
| `AGENT_LLM_MODEL` / `GEMINI_MODEL` | `gemini-2.5-flash` | Model ID |
| `AGENT_LLM_BASE_URL` | — | Custom endpoint (for local/Ollama) |
| `AGENT_MAX_TOOL_TURNS` | `8` | Max agentic steps |
| `AGENT_MAX_OUTPUT_TOKENS` | `4096` | Max tokens per generation |

---

## Dependencies

### New Packages

| Package | Size | Purpose |
|---|---|---|
| `@ai-sdk/mcp` | ~30 KB | Bridge MCP tools into Vercel AI SDK tool format |

> [!NOTE]
> This is the **only** new dependency. Everything else is already installed.

### Already Installed (No Changes)

| Package | Version | Used For |
|---|---|---|
| `ai` | ^6.0.116 | Core `generateText()`, `streamText()`, `tool()` |
| `@ai-sdk/openai` | ^3.0.41 | Cloud OpenAI + local models via `baseURL` |
| `@ai-sdk/google` | ^3.0.43 | Google Gemini |
| `@ai-sdk/anthropic` | ^3.0.58 | Anthropic Claude |
| `@ai-sdk/groq` | ^3.0.29 | Groq inference |
| `@ai-sdk/azure` | ^3.0.53 | Azure OpenAI |
| `@ai-sdk/amazon-bedrock` | ^4.0.93 | AWS Bedrock |
| `@ai-sdk/google-vertex` | ^4.0.108 | Google Vertex AI |
| `axios` | ^1.19.0 | Used by existing MCP client |
| `zod` | ^4.3.6 | Tool parameter schemas |

---

## Implementation Phases

### Phase 1 — Agent Core (Foundation)

**Goal:** A working agent loop that can call MCP tools using any configured provider.

**Files to create:**

| File | Description |
|---|---|
| `src/helpers/agent/agentProviderResolver.ts` | Resolves user settings → AI SDK model instance |
| `src/helpers/agent/mcpToolBridge.ts` | Wraps `McpClientService` tools as AI SDK tools |
| `src/helpers/agent/agentOrchestrator.ts` | Core `runAgent()` function using `generateText()` with `maxSteps` |
| `src/helpers/agent/agentTypes.ts` | Shared TypeScript interfaces for agent sessions, results, events |
| `src/helpers/agent/index.ts` | Public barrel export |

**Files to modify:**

| File | Change |
|---|---|
| `src/helpers/config/agent-config.ts` | Generalize `GeminiConfig` → `AgentLlmConfig` (backward-compat) |

**Acceptance criteria:**
- [ ] `runAgent({ prompt: "List available tools" })` works with Gemini API key
- [ ] `runAgent()` works with a local llama.cpp / Ollama endpoint
- [ ] MCP tools from the Nexus sandbox are discovered and callable
- [ ] `maxSteps` limits the agentic loop correctly
- [ ] Unit tests for provider resolver, tool bridge, and orchestrator

---

### Phase 2 — Electron Integration

**Goal:** The agent is accessible from the renderer via IPC, with streaming step updates.

**Files to create:**

| File | Description |
|---|---|
| `src/helpers/agent/agentSessionManager.ts` | Tracks active sessions, cancellation, conversation history |
| `src/helpers/agent/agentIpcHandlers.ts` | IPC `handle` registrations for `agent:*` channels |

**Files to modify:**

| File | Change |
|---|---|
| `src/helpers/ipcHandlers.js` | Register agent IPC handlers during app init |
| `preload.js` | Expose `agent:*` IPC channels to renderer |

**Acceptance criteria:**
- [ ] Renderer can invoke `agent:run` and receive streamed step updates
- [ ] Renderer can cancel a running agent session via `agent:cancel`
- [ ] `agent:list-tools` returns available MCP tools for display
- [ ] Multiple concurrent sessions are isolated

---

### Phase 3 — OAuth Login Flow

**Goal:** End-to-end `agent login` → OAuth PKCE → token persistence → authenticated MCP calls.

**Files to create/modify:**

| File | Description |
|---|---|
| `src/helpers/agent/agentLoginHandler.ts` | Orchestrates `buildAuthorizeUrl()` → open browser → local callback server → `handleCallback()` |

**Acceptance criteria:**
- [ ] `agent:login` IPC opens the browser for OAuth consent
- [ ] Callback captures the authorization code and exchanges for tokens
- [ ] Refresh token persists across app restarts
- [ ] `agent:token-info` returns decoded token claims (scopes, expiry)
- [ ] `agent:logout` clears tokens

---

### Phase 4 — UI Integration

**Goal:** A chat-like agent panel in the app where users can interact with the MCP-connected agent.

**Scope:** (Deliberately left high-level — depends on UI design decisions)

- Agent chat panel component
- Tool call visualization (collapsible step-by-step view)
- Provider/model selector (reuse existing settings infrastructure)
- Status indicators (authenticated, tool count, model info)

---

## File Tree (After Phase 2)

```
src/helpers/
├── agent/
│   ├── agentIpcHandlers.ts       # IPC surface
│   ├── agentOrchestrator.ts      # Core loop (generateText + tools + maxSteps)
│   ├── agentProviderResolver.ts  # User settings → AI SDK model
│   ├── agentSessionManager.ts    # Session lifecycle, cancellation, history
│   ├── agentTypes.ts             # Shared interfaces
│   ├── mcpToolBridge.ts          # McpClientService → AI SDK tools
│   └── index.ts                  # Barrel export
├── config/
│   └── agent-config.ts           # (modified) generalized LLM config
├── mcp/
│   ├── mcp-client.service.ts     # (existing) JSON-RPC MCP client
│   ├── mcp-client.service.spec.ts
│   └── mcp.types.ts              # (existing) MCP type definitions
├── oauth/
│   ├── pkce.util.ts              # (existing) PKCE helpers
│   ├── token-store.ts            # (existing) refresh token persistence
│   ├── token.service.ts          # (existing) OAuth token management
│   └── token.service.spec.ts
└── logger.ts                     # (existing) lightweight Logger
```

---

## Risk Mitigation

| Risk | Mitigation |
|---|---|
| Local models may not support tool calling reliably | Implement a fallback mode where the agent parses structured text output instead of relying on native tool_call API |
| MCP server downtime blocks the agent | Graceful degradation — agent responds without tools; surface connection status in UI |
| Token expiry mid-session | `TokenService` already handles transparent refresh; add a pre-flight token check before each agent run |
| Large tool lists exceed context window | Filter/paginate MCP tools; let the agent request tool discovery on demand |
| Provider-specific tool calling quirks | The AI SDK's provider abstraction handles format differences (OpenAI function calling vs Gemini tool use vs Anthropic tool_use) |

---

## Summary

The Vercel AI SDK is the **natural and only sensible choice** for this project:

1. **Already installed** — zero framework migration risk
2. **`generateText()` + `maxSteps`** — the multi-step agent loop is a single function call
3. **Provider-agnostic** — same code drives Gemini, GPT, Claude, llama.cpp, Ollama, MLX
4. **`@ai-sdk/mcp`** — official MCP bridge (one new package, ~30 KB)
5. **Electron-native** — no server framework, runs in the main process

The Google ADK would be a second framework to install, learn, and maintain — solving a problem the existing stack already solves better.
