// Defaults for agent metadata when upstream does not supply them.
// Model id uses pi-ai's built-in Anthropic catalog.
export const DEFAULT_PROVIDER = "claude-cli";
export const DEFAULT_MODEL = "claude-opus-4-6[1m]";
// Context window: Opus 4.5 supports ~200k tokens (per pi-ai models.generated.ts).
export const DEFAULT_CONTEXT_TOKENS = 200_000;
