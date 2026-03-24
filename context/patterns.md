<!-- Scope: Cross-cutting conventions and idioms in moltbot. See gotchas.md for traps. -->

# Patterns

- **Plugin SDK**: `defineChannelPlugin()`, `defineHook()`, `defineTool()`, `defineApiRoute()` from `moltbot/plugin-sdk`. Extensions live under `extensions/`, each with own `package.json`.
- **Extension deps**: Plugin-only deps go in the extension `package.json`, not root. Runtime deps in `dependencies`. Put `clawdbot` in `devDependencies` or `peerDependencies` (jiti alias resolves at runtime).
- **Commit workflow**: Use `scripts/committer "<msg>" <file...>` — avoids manual `git add`/`git commit`, keeps staging scoped.
- **Config schema**: Zod schemas in `src/config/zod-schema*.ts`, TypeBox schemas for tool params in `src/agents/tools/`. Config file is JSON5 (`~/.clawdbot/clawdbot.json`).
- **Session keys**: `<channel>:<peer>` or `<channel>:thread:<threadId>`. Telegram uses `:topic:` instead of `:thread:`.
- **CLI commands**: Create `src/commands/<name>.ts`, register in `src/cli/program/command-registry.ts`. Progress: use `src/cli/progress.ts` (osc-progress + clack spinner).
- **Status output**: Tables via `src/terminal/table.ts` (ANSI-safe). Colors via `src/terminal/palette.ts` (no hardcoded colors).
- **Channel refactors**: Always consider all built-in + extension channels (routing, allowlists, pairing, command gating, onboarding, docs).
- **Naming**: "Clawdbot" for product/app/docs headings; `clawdbot` for CLI/package/paths/config keys.
- **Agent tools**: TypeBox schemas for params, `jsonResult()`/`imageResultFromFile()` result builders. New tool: `src/agents/tools/<name>-tool.ts`.
- **Skills**: `skills/<name>/SKILL.md` manifest + optional implementation files. Loaded from workspace by `src/agents/skills.ts`.
- **Docs**: Mintlify at docs.clawd.bot. Internal links root-relative, no `.md` suffix. No em dashes/apostrophes in headings (breaks anchors).
