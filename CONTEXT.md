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

## Patterns
