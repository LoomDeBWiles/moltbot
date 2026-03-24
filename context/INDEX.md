# Context Index

| File | What | When to read |
|------|------|--------------:|
| `commands.md` | `pnpm dev/build/test/lint`, `m chunks` semantic search (2160 TS + 298 docs), `clawdbot memory search` with Gemini embeddings | Before running builds, tests, or querying memory |
| `gotchas.md` | `memory index` not `sync`, Node 22+ required, Gemini asyncBatch broken (use sync), spec verify Python-only, gateway auth tokens must match, pairing CLI lazy-loads channels, batch-gemini state nesting | Before touching memory indexing, gateway config, or CLI commands |
| `patterns.md` | Plugin SDK conventions, commit via `scripts/committer`, JSON5 config with Zod, session keys `channel:peer`, extension deps in own package.json | Before adding plugins, commands, or config changes |

## Project Structure

See `CODEMAP.md` for full directory tree and architecture.

**Runtime:** Node 22+ / TypeScript ESM. Package manager: pnpm. Lint: oxlint. Format: oxfmt.

**State:** `~/.clawdbot/clawdbot.json` (config, JSON5), `~/.clawdbot/sessions/` (Pi sessions), `~/.clawdbot/agents/` (agent logs).

**Deployment:** Gateway on port 18789 (WebSocket). macOS runs via menubar app. Linux/exe.dev runs via `nohup clawdbot gateway run`. Docs hosted on Mintlify (docs.clawd.bot).
