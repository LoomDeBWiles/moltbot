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

**Unified Memory (claude-sessions)** — code complete, NOT WORKING. Database is empty.

What's done:
- Beads epic `moltbot-sz1` with 12 tasks, all closed (`bd list`)
- `src/memory/claude-session-files.ts` — parser for Claude JSONL format
- `src/memory/sync-claude-sessions.ts` — sync pipeline with dedup
- Manager integration, `--project` filter, source type wired in
- Config set: `agents.defaults.memorySearch.provider=gemini`, `sources=["memory","sessions","claude-sessions"]`
- `GEMINI_API_KEY` set in `~/.profile`, API key verified working via direct fetch
- Node 22 installed, clawdbot linked via `npm link`
- 5,945 Claude session files in `~/.claude/projects/`

What's broken:
- `clawdbot memory status` reports 17,266 chunks but **the database has 0 rows**
- Every `clawdbot memory search` returns "No matches"
- `clawdbot memory index` reports success but writes nothing to DB
- Verified with: `node --experimental-sqlite -e` querying `~/.clawdbot/memory/main.sqlite` directly — chunks table is empty

How to verify DB state (don't trust `clawdbot memory status`):
```bash
node --experimental-sqlite -e '
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync(require("os").homedir() + "/.clawdbot/memory/main.sqlite", { open: true, readOnly: true });
console.log("chunks:", db.prepare("SELECT count(*) as n FROM chunks").get().n);
db.close();
'
```

Where to debug:
- `src/memory/manager.ts` — `sync()` and `indexFile()` methods
- `src/memory/sync-claude-sessions.ts` — does it call indexFile?
- `src/memory/embeddings-gemini.ts` — API key resolves correctly, embeddings API works via direct fetch
- Check if `npm link` is running stale dist/ — rebuild with `npx tsc` and retry

Spec docs: `docs/mods/unified-memory-beads.md`, rendered HTML in `output/index.html`

## Patterns
