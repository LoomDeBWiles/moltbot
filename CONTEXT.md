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
- Gemini embedding API confirmed working (768-dim vectors from `gemini-embedding-001`)
- Node 22 installed, clawdbot linked via `npm link`
- 4,105 Claude session files in `~/.claude/projects/`

### Previous provider: local embeddings

The DB was originally indexed with the local provider (`node-llama-cpp` + `embeddinggemma-300M-Q8_0.gguf`). 15,312 embedding cache entries remain from that era. Local is no longer viable:
- Config explicitly switched to `provider: "gemini"`
- `~/.cache/llama-cpp-agent/` doesn't exist (model not downloaded)
- `node-llama-cpp` has ESM top-level-await issues with `require()`
- Would need `pnpm approve-builds` + model download to restore

The stale local-provider cache entries in the DB are harmless but useless — cache lookups filter by `(provider, model, provider_key)` so gemini queries never hit them.

### Root cause and fix (2026-01-28)

`manager.ts:runSync()` triggered `runSafeReindex` (atomic temp DB swap) on every call because `needsFullReindex` included `(vectorReady && !meta?.vectorDims)`. The meta had no `vectorDims` (written during previous local-provider era). The atomic reindex tried to embed 4,105 files via Gemini, got killed before finishing, orphaned ~1.5GB of temp DBs. Main DB stayed empty.

**Fix applied:**
- Removed `vectorDims` from `needsFullReindex` — missing vectorDims no longer forces atomic reindex
- Added `dbIsEmpty` detection — when meta matches but chunks=0, all sources sync incrementally (progress survives kills)
- Write meta after incremental sync — persists `vectorDims` to prevent reindex loop
- Clean orphaned temp files on sync start
- Wrapped `doSyncClaudeSessions` in try/catch in both sync paths — one source failing doesn't block others

**Next:** Run `clawdbot memory index` and verify chunks populate:
```bash
node --experimental-sqlite -e '
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync(require("os").homedir() + "/.clawdbot/memory/main.sqlite", { open: true });
console.log("chunks:", db.prepare("SELECT count(*) as n FROM chunks").get().n);
console.log("files:", db.prepare("SELECT count(*) as n FROM files").get().n);
db.close();
'
```

Spec docs: `docs/mods/unified-memory-beads.md`, rendered HTML in `output/index.html`

## Patterns
