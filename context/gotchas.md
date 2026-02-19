<!-- Scope: Traps, conventions, and hard-won lessons for moltbot. -->

# Gotchas

- `clawdbot memory sync`: not a command — use `clawdbot memory index`
- Node 22+ required to run clawdbot
- `npm link` from repo root to use dev version globally
- `spec verify`: only supports Python codebases, not TypeScript — run acceptance criteria manually
- Gemini `asyncBatchEmbedContent`: returns "API key expired" despite valid key — Gemini API limitation with API keys. Async batch disabled by default. Sync `batchEmbedContents` works fine.
- `batch-gemini.ts`: Gemini batch status response nests `state` under `metadata` (not top-level) and prefixes values with `BATCH_STATE_` (e.g., `BATCH_STATE_PENDING` not `PENDING`). Fixed in `extractBatchState()`/`extractOutputFileId()`.
- `pairing-cli.ts:registerPairingCli()`: `listPairingChannels()` must be called inside action handlers (lazy), not at registration time — the plugin registry isn't populated yet during CLI setup. Fixed: channels now queried at execution time.
- Gateway config: `gateway.auth.token` and `gateway.remote.token` must match or CLI commands can't connect to the running gateway (token mismatch error).
