<!-- Scope: Traps, conventions, and hard-won lessons for moltbot. See commands.md for build/test. -->

# Gotchas

- `clawdbot memory sync`: not a command — use `clawdbot memory index`
- Node 22+ required to run clawdbot — enforced by `src/infra/runtime-guard.ts`
- `npm link` from repo root to use dev version globally
- `spec verify`: only supports Python codebases, not TypeScript — run acceptance criteria manually
- Gemini `asyncBatchEmbedContent`: returns "API key expired" despite valid key — Gemini API limitation with API keys. Async batch disabled by default. Sync `batchEmbedContents` works fine.
- `batch-gemini.ts`: Gemini batch status response nests `state` under `metadata` (not top-level) and prefixes values with `BATCH_STATE_` (e.g., `BATCH_STATE_PENDING` not `PENDING`). Fixed in `extractBatchState()`/`extractOutputFileId()`.
- `pairing-cli.ts:registerPairingCli()`: `listPairingChannels()` must be called inside action handlers (lazy), not at registration time — the plugin registry isn't populated yet during CLI setup.
- Gateway config: `gateway.auth.token` and `gateway.remote.token` must match or CLI commands can't connect to the running gateway (token mismatch error).
- `@buape/carbon` dependency: never update — patched version, update breaks things.
- `bash-tools.exec.ts`: 51KB — surgical edits only, never full rewrites.
- Tool schemas: avoid `Type.Union` in tool input schemas (google-antigravity validator rejects `anyOf`/`oneOf`/`allOf`). Use `stringEnum`/`optionalStringEnum`.
- Tool schemas: avoid raw `format` property names — some validators treat it as a reserved keyword.
- Telegram session keys: use `:topic:` marker, other platforms use `:thread:`.
- Patched dependencies (`pnpm.patchedDependencies`): must use exact versions (no `^`/`~`).
- macOS gateway: runs only as the menubar app, no separate LaunchAgent. Restart via app or `scripts/restart-mac.sh`.
- `canvas-host/a2ui/.bundle.hash`: auto-generated, only regenerate via `pnpm canvas:a2ui:bundle`.
- ~~`cli-runner/helpers.ts:466`~~ **FIXED (w14, `0cfcf42`):** `!params.useResume &&` guard removed. System prompt now delivered on every turn. `systemPromptWhen: "always"` works as intended.
- `~/clawd/` workspace markdown overrides code: agents trust bootstrap files (MEMORY.md, USER.md, TOOLS.md) and context files (entities/, gotchas.md) over code-generated system prompt hints. One contradicting file is enough to collapse agent confidence. When changing CLI-mode behavior, audit ALL bootstrap files for conflicting instructions — fixing a subset is equivalent to fixing none. See `entities/cli-runner.md` for the full list from w14.
