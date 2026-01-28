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
- Gemini batch embeddings: batch status polling fails with "API key expired" even with valid key — disable batch or debug the batch status auth path in `embeddings-gemini.ts`
- Gemini non-batch also fails despite direct API calls working — suspect `npm link` vs published package mismatch or env var not reaching clawdbot process. Needs investigation.

## Current State

**Unified Memory (claude-sessions)** — code complete, not yet functional.

What's done:
- Beads epic `moltbot-sz1` with 12 tasks, all closed (`bd list`)
- `src/memory/claude-session-files.ts` — parser for Claude JSONL format
- `src/memory/sync-claude-sessions.ts` — sync pipeline with dedup
- Manager integration, `--project` filter, source type wired in
- Config set: `agents.defaults.memorySearch.provider=gemini`, `sources=["memory","sessions","claude-sessions"]`
- `GEMINI_API_KEY` set in `~/.profile`, API key verified working via direct fetch
- Node 22 installed, clawdbot linked via `npm link`
- `~/.claude/projects/` has 5,945 session files to index

What's blocked:
- `clawdbot memory index` fails with "API key expired" despite key working via direct `fetch()`
- Both batch and non-batch Gemini paths fail
- Debug: `CLAWDBOT_DEBUG_MEMORY_EMBEDDINGS=1 clawdbot memory index` shows client init is correct
- Suspect: `npm link` running stale dist, or env var not propagating through clawdbot's process tree
- Start here: `src/memory/embeddings-gemini.ts:resolveRemoteApiKey()` and `resolveGeminiEmbeddingClient()`

Spec docs: `docs/mods/unified-memory-beads.md`, rendered HTML in `output/index.html`

## Patterns
