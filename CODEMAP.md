# Codemap: Clawdbot (moltbot)

> Multi-channel AI chat bot with gateway server, agent runtime, and plugin system.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              CLI (entry.ts)                             │
│  clawdbot <command> [options]  →  commander program (cli/program/)      │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
        ┌────────────────────────────┼────────────────────────────────┐
        ▼                            ▼                                ▼
┌───────────────┐          ┌─────────────────┐              ┌─────────────────┐
│   Gateway     │◄────────►│  Agent Runtime  │              │    Channels     │
│  (WebSocket)  │          │  (pi-embedded)  │              │   (plugins/)    │
│  server/      │          │  agents/        │              │                 │
└───────┬───────┘          └────────┬────────┘              └────────┬────────┘
        │                           │                                │
        │ RPC/WS                    │ tools                          │ events
        ▼                           ▼                                ▼
┌───────────────┐          ┌─────────────────┐              ┌─────────────────┐
│  Control UI   │          │   Tool System   │              │  Telegram/      │
│  (ui/)        │          │  agents/tools/  │              │  Discord/Slack/ │
│               │          │  bash, browser, │              │  Signal/iMessage│
│               │          │  message, etc.  │              │  WhatsApp/Web   │
└───────────────┘          └─────────────────┘              └─────────────────┘
                                     │
                           ┌─────────┴─────────┐
                           ▼                   ▼
                    ┌────────────┐      ┌────────────┐
                    │  Sessions  │      │   Config   │
                    │  config/   │      │  config/   │
                    │  sessions  │      │  io.ts     │
                    └────────────┘      └────────────┘
```

## Directory Tree

```
src/
  entry.ts                        # CLI entry, respawns with NODE_OPTIONS
  index.ts                        # Main exports, builds commander program
  agents/                         # Agent runtime
    pi-embedded-runner/run/        # Pi agent execution engine
    pi-embedded-helpers/           # Agent helper utilities
    pi-extensions/context-pruning/ # Context pruning extensions
    auth-profiles/                 # Multi-provider auth rotation
    cli-runner/                    # CLI agent execution
    skills/                        # Workspace skill loading
    tools/                         # 18+ tools: browser, cron, memory, message, canvas, nodes
    sandbox/                       # Sandboxed execution
    schema/                        # Tool schema utilities
  auto-reply/                     # Automatic response system
    reply/                         # Core: get-reply, agent-runner, directives
      exec/                        # Agent execution
      queue/                       # Reply queuing
  gateway/                        # WebSocket gateway server
    server/ws-connection/          # HTTP/WS server + message routing
    server-methods/                # RPC handlers
    protocol/schema/               # Protocol types + validation
  channels/                       # Channel plugin abstraction
    plugins/                       # Registry, types, catalog
      actions/ normalize/ onboarding/ outbound/ status-issues/ agent-tools/
    allowlists/                    # Channel allowlists
    web/                           # Web channel
  cli/                            # CLI framework
    program/message/               # Commander program + command registry
    daemon-cli/ gateway-cli/ node-cli/ nodes-cli/ cron-cli/
  commands/                       # Chat commands (100+ files)
  config/                         # Zod schemas, sessions, paths, validation, legacy migrations
  plugins/                        # Discovery, loading, registry, hooks, runtime
  plugin-sdk/                     # Public SDK: defineChannelPlugin, defineHook, defineTool
  cron/                           # Scheduled tasks: store, schedule, service, isolated-agent
  daemon/                         # System service: launchd, systemd, schtasks
  memory/                         # Embeddings, sqlite-vec, sync (claude-sessions, memory files)
  telegram/ discord/ slack/ signal/ imessage/ whatsapp/  # Per-channel code
  browser/                        # Playwright automation
  infra/                          # Ports, env, device pairing, binaries, runtime guard
  media/ media-understanding/ link-understanding/  # Media pipeline + analysis
  pairing/                        # Device pairing
  providers/                      # OAuth + API key providers
  routing/                        # Message routing
  sessions/                       # Session management
  tui/                            # Terminal UI
  tts/                            # Text-to-speech
  terminal/                       # Tables, palette, ANSI rendering
  logging/                        # Subsystem loggers
  hooks/                          # Lifecycle hooks
  security/                       # Security utilities
  canvas-host/                    # Canvas rendering host (a2ui bundle)
  node-host/                      # Mobile node hosting
  acp/                            # Agent communication protocol
  web/ wizard/ macos/ markdown/ shared/ types/ utils/
extensions/                       # Channel + feature extensions (29 dirs)
  discord/ telegram/ whatsapp/ slack/ signal/ imessage/  # Major channels
  matrix/ msteams/ googlechat/ bluebubbles/ line/ nostr/ mattermost/
  nextcloud-talk/ tlon/ twitch/ zalo/ zalouser/ voice-call/
  memory-core/ memory-lancedb/    # Memory backends
  llm-task/ diagnostics-otel/ copilot-proxy/ lobster/ open-prose/
  google-antigravity-auth/ google-gemini-cli-auth/ qwen-portal-auth/
skills/                           # 54+ skill plugins (SKILL.md + optional code)
  coding-agent/ github/ bear-notes/ canvas/ food-order/ model-usage/ ...
ui/                               # Web control UI (Lit + Vite)
  src/ui/ src/styles/              # Web components + styles
apps/                             # Native apps
  ios/ android/ macos/            # Swift (iOS/macOS), Kotlin (Android)
  shared/ClawdbotKit/             # Shared Swift framework
packages/clawdbot/                # Monorepo core package
docs/                             # Documentation (Mintlify, 27+ dirs)
test/                             # E2E + integration tests
```

## Key Files

### Entry Points + Gateway

| File | Purpose |
|------|---------|
| `src/entry.ts` | CLI entry point, respawns with NODE_OPTIONS |
| `src/index.ts` | Main exports, builds commander program |
| `src/cli/program/build-program.ts` | Creates commander program instance |
| `src/cli/program/command-registry.ts` | Registers all CLI commands |
| `src/gateway/server/ws-connection/message-handler.ts` | WebSocket message routing |
| `src/gateway/server/http-listen.ts` | HTTP server setup |
| `src/gateway/auth.ts` | Token/password authentication |
| `src/gateway/protocol/index.ts` | Protocol types + validation |
| `src/gateway/server-restart-sentinel.ts` | Restart notification handling |

### Agent Runtime + Tools

| File | Purpose |
|------|---------|
| `src/agents/pi-embedded.ts` | Embedded Pi agent runner (barrel) |
| `src/agents/cli-runner.ts` | CLI-based agent execution |
| `src/agents/model-selection.ts` | Model resolution + fallback |
| `src/agents/auth-profiles.ts` | Multi-provider auth rotation |
| `src/agents/skills.ts` | Workspace skill loading |
| `src/agents/compaction.ts` | Context window management |
| `src/agents/agent-scope.ts` | Agent config + workspace resolution |
| `src/agents/bash-tools.exec.ts` | Shell execution (51KB — surgical edits only) |
| `src/agents/bash-tools.process.ts` | Background process management |
| `src/agents/tools/browser-tool.ts` | Browser automation (25KB) |
| `src/agents/tools/message-tool.ts` | Cross-channel messaging |
| `src/agents/tools/cron-tool.ts` | Scheduled task tool |
| `src/agents/tools/memory-tool.ts` | Memory search tool |
| `src/agents/tools/sessions-send-tool.ts` | Session message delivery |
| `src/agents/tools/canvas-tool.ts` | Canvas rendering |
| `src/agents/tools/nodes-tool.ts` | Mobile node control |
| `src/agents/tools/image-tool.ts` | Image processing/analysis |
| `src/agents/tools/gateway-tool.ts` | Gateway RPC calls |

### Channels + Auto-Reply

| File | Purpose |
|------|---------|
| `src/channels/plugins/index.ts` | Channel plugin registry |
| `src/channels/plugins/types.core.ts` | Plugin interface definitions |
| `src/channels/plugins/catalog.ts` | Built-in channel catalog |
| `src/telegram/bot.ts` | Telegram bot (grammY) |
| `src/telegram/bot-handlers.ts` | Telegram message handlers |
| `src/telegram/send.ts` | Telegram outbound messages |
| `extensions/discord/src/channel.ts` | Discord channel plugin |
| `extensions/whatsapp/src/channel.ts` | WhatsApp Web plugin |
| `src/signal/daemon.ts` | Signal CLI daemon bridge |
| `src/slack/http/index.ts` | Slack HTTP integration |
| `src/auto-reply/reply/get-reply.ts` | Main reply dispatcher |
| `src/auto-reply/reply/agent-runner.ts` | Agent execution for replies |
| `src/auto-reply/reply/directive-handling.ts` | Reply directives parser |
| `src/auto-reply/command-detection.ts` | Command parsing |
| `src/auto-reply/dispatch.ts` | Message routing to reply system |

### Config + Plugins + Memory

| File | Purpose |
|------|---------|
| `src/config/io.ts` | Config load/save (JSON5) |
| `src/config/zod-schema.ts` | Full config schema (Zod, master ref) |
| `src/config/sessions.ts` | Session store CRUD |
| `src/config/paths.ts` | State/config path resolution |
| `src/config/validation.ts` | Config object validation |
| `src/plugins/loader.ts` | Plugin discovery + loading |
| `src/plugins/registry.ts` | Plugin registry types |
| `src/plugins/runtime.ts` | Active registry singleton |
| `src/plugins/hooks.ts` | Hook execution system |
| `src/plugins/discovery.ts` | Plugin scanning (extensions/ + paths) |
| `src/memory/manager.ts` | Memory manager implementation |
| `src/memory/search-manager.ts` | Memory search interface |
| `src/memory/embeddings.ts` | Embedding provider abstraction |
| `src/memory/sqlite-vec.ts` | Vector DB (sqlite-vec) |

## Data Flow: Message Handling

```
[Channel Event] → Monitor → Session Lookup → Command Detection
    → [Direct Reply | Gateway RPC | Agent Command] → Agent Runner (pi-embedded)
    → [LLM Call (model-selection) | Tool Use (agents/tools/) | Response (send.ts)]
```

## CLI Commands

| Command | Purpose |
|---------|---------|
| `clawdbot gateway` | Start/stop/status of WebSocket gateway |
| `clawdbot agent` | Run agent turn (--local or via gateway) |
| `clawdbot tui` | Terminal chat interface |
| `clawdbot status` | Channel health + recent sessions |
| `clawdbot doctor` | Diagnostics + auto-fixes |
| `clawdbot config get/set` | Config manipulation |
| `clawdbot channels login/logout/status` | Channel authentication |
| `clawdbot message send` | Send via any channel |
| `clawdbot memory index/search/status` | Memory management |
| `clawdbot cron add/list/run` | Scheduled task management |
| `clawdbot plugins list/enable/disable` | Plugin management |

## NPM Exports

```typescript
import { loadConfig, monitorWebChannel, runExec } from "moltbot";
import { defineChannelPlugin, defineHook, defineTool } from "moltbot/plugin-sdk";
```

## Configuration

Config file: `~/.clawdbot/clawdbot.json` (JSON5). Schema: `src/config/zod-schema.ts`.

| Path | Default | Purpose |
|------|---------|---------|
| `agents.defaults.model` | `claude-sonnet-4-20250514` | Default LLM model |
| `agents.defaults.provider` | `anthropic` | Default provider |
| `agents.defaults.workspace` | `~/.clawdbot/workspace` | Agent workspace |
| `gateway.mode` | `local` | `local` or `remote` |
| `gateway.port` | `18789` | WebSocket server port |
| `gateway.auth.token` | - | Gateway authentication |
| `browser.headless` | `true` | Browser automation mode |
| `logging.level` | `info` | Log verbosity |

## Dependencies

| Package | Purpose |
|---------|---------|
| `@mariozechner/pi-*` | Agent runtime (pi-agent-core, pi-ai, pi-tui) |
| `grammy` | Telegram bot framework |
| `@buape/carbon` | Discord client (never update) |
| `@slack/bolt` | Slack app framework |
| `@whiskeysockets/baileys` | WhatsApp Web client |
| `playwright-core` | Browser automation |
| `commander` | CLI framework |
| `zod` | Schema validation |
| `ws` | WebSocket server |
| `hono` | HTTP routing |
| `croner` | Cron expression parsing |
| `sharp` | Image processing |
| `sqlite-vec` | Vector DB for memory |

## Common Tasks

| Task | Solution |
|------|----------|
| Add CLI command | Create `src/commands/<name>.ts`, register in `cli/program/command-registry.ts` |
| Add agent tool | Create `src/agents/tools/<name>-tool.ts`, export from barrel |
| Add channel plugin | Create `extensions/<channel>/`, implement `ChannelPlugin` |
| Add skill | Create `skills/<name>/SKILL.md`, optionally add hooks |
| Modify config schema | Edit `src/config/zod-schema*.ts`, regenerate types |
| Add gateway RPC | Add handler in `src/gateway/server-methods/`, register in index |

## Testing

| Type | Location | Command |
|------|----------|---------|
| Unit | `src/**/*.test.ts` | `pnpm test` |
| E2E | `src/**/*.e2e.test.ts` | `pnpm test:e2e` |
| Live | `src/**/*.live.test.ts` | `pnpm test:live` |
| Extensions | `extensions/**/*.test.ts` | `pnpm test:extensions` |
| Gateway | `src/gateway/**/*.test.ts` | `pnpm test:gateway` |
| Docker | `scripts/e2e/*.sh` | `pnpm test:docker:all` |
| UI | `ui/src/**/*.test.ts` | `pnpm test:ui` |

## Gotchas

**Node 22+ required**: Runtime guard in `src/infra/runtime-guard.ts`.

**Gateway token sync**: `gateway.auth.token` and `gateway.remote.token` must match.

**Plugin registry timing**: `listPairingChannels()` must be lazy — registry isn't populated during CLI setup.

**Gemini async batch**: Returns "API key expired" despite valid key. Use sync `batchEmbedContents`.

**Large files**: `bash-tools.exec.ts` (51KB) — surgical edits only, not full rewrites.

**State isolation**: `--dev` or `--profile <name>` isolates state under `~/.clawdbot-<profile>`.

**Telegram topics**: Session keys use `:topic:`, other platforms use `:thread:`.

**Carbon dep**: Never update the `@buape/carbon` dependency.

**Tool schemas**: Avoid `Type.Union` in tool input schemas (google-antigravity breaks). Use `stringEnum`/`optionalStringEnum`.
