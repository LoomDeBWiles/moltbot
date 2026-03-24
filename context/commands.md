<!-- Scope: How to build, test, run, and search moltbot. See CODEMAP.md for architecture. -->

# Commands

| Task | Command |
|------|---------|
| Dev server | `pnpm dev` |
| Build | `pnpm build` |
| Test (unit) | `pnpm test` |
| Test (coverage) | `pnpm test:coverage` |
| Test (e2e) | `pnpm test:e2e` |
| Test (live) | `CLAWDBOT_LIVE_TEST=1 pnpm test:live` |
| Test (extensions) | `pnpm test:extensions` |
| Test (gateway) | `pnpm test:gateway` |
| Test (UI) | `pnpm test:ui` |
| Test (docker) | `pnpm test:docker:all` |
| Lint | `pnpm lint` (oxlint) |
| Format | `pnpm format:fix` (oxfmt) |
| UI build | `pnpm ui:build` |
| Plugins sync | `pnpm plugins:sync` |
| Protocol gen | `pnpm protocol:gen` |
| Commit | `scripts/committer "<msg>" <file...>` |

## Code Search

The codebase is indexed in mine for semantic search:

```bash
m chunks "your query" --project moltbot
```

2160 TypeScript/Python code files + 298 docs markdown files (text kind) indexed. Docs files (R2941-R3260) were added with `--skip-index` — 123 indexed, 297 still in `preprocessing` status awaiting GPU reindex.

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
