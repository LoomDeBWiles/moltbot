# Context

## Commands

| Task | Command |
|------|---------|
| Dev server | `pnpm dev` |
| Build | `pnpm build` |
| Test | `pnpm test` |
| Lint | `pnpm lint` |

## Code Search

The codebase is indexed in mine for semantic search:

```bash
m chunks "your query" --project moltbot
```

2160 TypeScript/Python files indexed. Use this to find relevant code before diving into files.

## Memory Search

Search across Claude Code sessions from all projects:

```bash
# Index all sources
clawdbot memory index

# Search with optional project filter
clawdbot memory search "how to parse JSONL"
clawdbot memory search "authentication flow" --project moltbot

# Check status
clawdbot memory status
```

Provider: Gemini (`gemini-embedding-001`), requires `GEMINI_API_KEY` env var (set in `~/.profile`).

Sources:
- `memory` - Manually added memories (MEMORY.md, memory/*.md)
- `sessions` - Moltbot conversation sessions
- `claude-sessions` - Claude Code sessions from ~/.claude/projects/

## Architecture

Multi-channel chat bot framework supporting Discord, Telegram, Slack, Signal, iMessage, WhatsApp, and web.

Key directories:
- `src/` - Core TypeScript source
  - `agents/` - AI agent implementations
  - `channels/` - Channel adapters (discord, telegram, etc.)
  - `gateway/` - WebSocket gateway server
  - `config/` - Configuration handling
  - `commands/` - Chat command system
- `ui/` - Web UI (Lit components)
- `extensions/` - Browser/platform extensions
- `skills/` - Skill plugins

## Gotchas

- `clawdbot memory sync`: not a command — use `clawdbot memory index`
- Node 22+ required to run clawdbot
- `npm link` from repo root to use dev version globally
- `spec verify`: only supports Python codebases, not TypeScript — run acceptance criteria manually
- Gemini async batch API (`asyncBatchEmbedContent`): returns "API key expired" despite valid key — this is a Gemini API limitation with API keys. Async batch is now disabled by default. Sync `batchEmbedContents` works fine.
- `batch-gemini.ts`: Gemini batch status response nests `state` under `metadata` (not top-level) and prefixes values with `BATCH_STATE_` (e.g., `BATCH_STATE_PENDING` not `PENDING`). Fixed in `extractBatchState()`/`extractOutputFileId()`.

## Current State

**Unified Memory (claude-sessions)** — WORKING. 17,268 chunks from 4,021 files indexed with Gemini.

- Provider: `gemini-embedding-001` (3072-dim vectors), `GEMINI_API_KEY` in `~/.profile`
- Config: `agents.defaults.memorySearch.provider=gemini`, `sources=["memory","sessions","claude-sessions"]`
- DB: `~/.clawdbot/memory/main.sqlite` — meta has `vectorDims: 3072`
- Incremental sync: new sessions indexed on next `clawdbot memory index` run

Spec docs: `docs/mods/unified-memory-beads.md`

## Patterns
