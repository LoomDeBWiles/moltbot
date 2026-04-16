<!-- Scope: moltbot CLI backend (claude -p). How system prompts, TTS directives, session continuity, and workspace bootstrap files flow. -->

# CLI Runner (claude -p backend)

## Overview

Bridges moltbot's reply pipeline to the `claude -p` (Claude Code CLI) subprocess. For each incoming message on a `claude-cli` provider session, it loads workspace bootstrap files, builds a full system prompt (including TTS directives), resolves session continuity via `--session-id`/`--resume`, spawns `claude -p` with `cwd: ~/clawd`, parses the JSON stdout, and returns payloads to the reply pipeline. TTS voice bubbles work via directive lines (`[[audio_as_voice]]` + `MEDIA:`) that the reply pipeline strips and routes to Telegram.

## Key Files

| File | What | Key lines |
|------|------|-----------|
| `src/agents/cli-runner.ts` | Entry point: loads bootstrap, builds prompt, resolves session, spawns subprocess | L90 buildSystemPrompt, L104 resolveSessionIdToSend, L108 useResume, L146 buildCliArgs, L216 spawn |
| `src/agents/cli-runner/helpers.ts` | All construction + parsing helpers | L20 sanitizeCliPrompt, L178 buildSystemPrompt, L210 ttsHint, L377 resolveSystemPromptUsage, L452 buildCliArgs |
| `src/agents/cli-backends.ts` | DEFAULT_CLAUDE_BACKEND config (argv flags, resume args, defaults) | L28 defaults, L31 resumeArgs, L44 sessionMode, L46 systemPromptArg, L48 systemPromptWhen |
| `src/agents/cli-session.ts` | cliSessionId get/set | L4 getCliSessionId, L19 setCliSessionId |
| `src/agents/system-prompt.ts` | buildAgentSystemPrompt, buildVoiceSection | L106 buildVoiceSection, L129 buildAgentSystemPrompt |
| `src/agents/workspace.ts` | Loads workspace bootstrap files (AGENTS.md, MEMORY.md, etc.) | L224 loadWorkspaceBootstrapFiles, L261 memory entries |
| `src/auto-reply/reply/agent-runner-execution.ts` | Calls runCliAgent with cliSessionId | L155 isCliProvider check, L165 getCliSessionId |
| `src/auto-reply/reply/session-usage.ts` | Persists returned cliSessionId after each run | L46 setCliSessionId |
| `src/auto-reply/reply/agent-runner-payloads.ts` | Parses reply directives incl. `[[audio_as_voice]]` | L66 parseReplyDirectives |
| `src/media/parse.ts` | Extracts `MEDIA:` tokens from agent output | L44 splitMediaFromOutput |
| `scripts/tts-cli.mjs` | Standalone TTS script the agent calls via Bash | — |

## System Prompt Flow

Per CLI turn:

1. **Provider check**: `isCliProvider(provider, cfg)` (`agent-runner-execution.ts:155`) routes to `runCliAgent()` instead of the embedded runner.
2. **Bootstrap loading**: `loadWorkspaceBootstrapFiles(~/clawd)` (`workspace.ts:224-278`) reads `AGENTS.md`, `SOUL.md`, `TOOLS.md`, `IDENTITY.md`, `USER.md`, `HEARTBEAT.md`, `BOOTSTRAP.md`, and `MEMORY.md` (or `memory.md`). Missing files are fine. Content is passed as `contextFiles`.
3. **System prompt assembly**: `buildSystemPrompt()` (`helpers.ts:178`) calls `buildAgentSystemPrompt()` with:
   - `ttsHint` — only generated when `params.config` is truthy (`helpers.ts:210`). Contains the bash directive instructions.
   - `contextFiles` — the workspace bootstrap files as a `# Project Context` section.
4. **Sanitization**: `sanitizeCliPrompt()` (`helpers.ts:20-28`) replaces `sessions_*`, `HEARTBEAT_OK`, and `running inside Clawdbot` with safe equivalents to avoid the Anthropic streaming classifier (see w13). Does NOT touch TTS content.
5. **Session ID resolution**: `resolveSessionIdToSend()` (`helpers.ts:391`) generates a new UUID or returns the existing `cliSessionId`.
6. **Resume mode**: `useResume = Boolean(cliSessionId && cliSessionIdToSend && resumeArgs.length > 0)` (`cli-runner.ts:108-113`). `DEFAULT_CLAUDE_BACKEND.resumeArgs` is non-empty, so **any existing session ID triggers resume**.
7. **System prompt delivery**: `resolveSystemPromptUsage()` (`helpers.ts:377-389`) returns full prompt when `systemPromptWhen === "always"` (the default). `buildCliArgs()` at `helpers.ts:466` appends `--append-system-prompt` on every turn, including resumed turns (the `!useResume` guard was removed in `0cfcf42`, w14).
8. **Spawn**: `runCommandWithTimeout([backend.command, ...args], { cwd: ~/clawd, ... })` at `cli-runner.ts:216`.
9. **Reply parsing**: `parseCliJson()` extracts text + `session_id` from JSON output. Text flows through `parseReplyDirectives()` → `splitMediaFromOutput()` → `audioAsVoice` + `mediaUrls`.
10. **Session persistence**: `setCliSessionId()` (`session-usage.ts:46`) stores the returned session ID for use on the next turn.

### First-turn vs resumed-turn argv

First turn of a new CLI session:
```
claude -p --output-format json --dangerously-skip-permissions
       --model <modelId>
       --append-system-prompt "<full system prompt with TTS hint + context files>"
       --session-id <newUUID>
       "<user prompt>"
```

All subsequent turns:
```
claude -p --output-format json --dangerously-skip-permissions
       --resume <existingSessionId>
       --append-system-prompt "<full system prompt with TTS hint + context files>"
       "<user prompt>"
```

**No model flag. No session-id flag.** System prompt IS delivered on every resumed turn (fixed in `0cfcf42`, w14). Model and session-id flags still only appear on turn 1 — they conflict with `--resume`.

### `systemPromptWhen` semantics

`DEFAULT_CLAUDE_BACKEND.systemPromptWhen = "always"` (`cli-backends.ts:48`) controls the resolver. The resolver returns the full prompt every time. The argv builder passes it via `--append-system-prompt` on every turn (the old `!useResume` gate was removed in `0cfcf42`, w14). `"always"` now works as intended — system prompt on every turn. `"first"` would still work only on turn 1 (resolver returns `undefined` after that).

## TTS Directives (w14)

**Design:** agent calls `node /home/ben/projects/moltbot/scripts/tts-cli.mjs "text"` via Bash, the script generates a `.opus` file, prints `[[audio_as_voice]]` + `MEDIA:/tmp/tts-xxx/voice.opus` to stdout, and the agent copies those two lines verbatim into its response. The reply pipeline strips the directives and routes the audio to Telegram as a voice bubble.

**Parsing flow:**
1. Agent response text hits `buildReplyPayloads()` (`agent-runner-payloads.ts:66`).
2. `parseReplyDirectives()` extracts directive lines.
3. `splitMediaFromOutput()` (`media/parse.ts:44`) pulls `MEDIA:` paths line-by-line.
4. `parseAudioTag()` (`media/audio-tags.ts:8`) sets `audioAsVoice = true` if `[[audio_as_voice]]` is found.
5. Payload with `audioAsVoice: true` → Telegram `sendVoice()` instead of `sendMessage()`.

**All blockers resolved (w14 plan_v9, 2026-04-15):**
- ~~`~/clawd/MEMORY.md:12`~~ Updated: now documents both-runner TTS approach, prohibits old `tts()` + `message(asVoice=true)` API.
- ~~`~/clawd/context/entities/moltbot.md:9,11`~~ Updated: CLI runner TTS documented as first-class path.
- ~~`buildCliArgs()` at `helpers.ts:466`~~ Fixed in `0cfcf42`: `!params.useResume &&` guard removed from systemPrompt gate. System prompt (including TTS hint) delivered on every turn.
- Additionally fixed: `~/clawd/USER.md:7`, `~/clawd/TOOLS.md:5-11`, `~/clawd/context/gotchas.md:3-4`, `~/clawd/memory/2026-02-03.md:3-6` — all updated to document both-runner approach.

Work log: `/home/ben/projects/investing/work/w14_moltbot-tts/`.

## cliSessionId Lifecycle

- **Created**: `resolveSessionIdToSend()` (`helpers.ts:391`) generates `randomUUID()` on first turn when the session entry has no prior `cliSessionId`.
- **Stored**: `setCliSessionId()` (`session-usage.ts:46-48`) persists `runResult.meta.agentMeta.sessionId` from the claude -p JSON output after each successful run.
- **Retrieved**: `getCliSessionId(sessionEntry, provider)` (`agent-runner-execution.ts:165`); presence triggers resume mode.
- **`/new` behavior**: Partial clear. `initSessionState()` (`session.ts:235`) sets `baseEntry = undefined` when `isNewSession`, so the fresh `sessionEntry` has no `cliSessionIds`. But the store update at `session.ts:332-335` uses `{ ...store[sessionKey], ...sessionEntry }` — the spread preserves old `cliSessionIds` in the on-disk store. Whether this matters depends on whether `getActiveSessionEntry()` re-reads from disk. Probably not turn-1 breaking but deserves its own investigation.

## Gotchas

- ~~`helpers.ts:466`~~ **FIXED (w14, `0cfcf42`):** `!params.useResume &&` guard removed. System prompt now delivered on every turn including resume. `systemPromptWhen: "always"` works as intended.
- ~~`~/clawd/MEMORY.md`~~ **FIXED (w14):** Updated to document both-runner TTS approach. Old `tts()` + `message(asVoice=true)` references replaced with conditional guidance.
- ~~`~/clawd/context/entities/moltbot.md`~~ **FIXED (w14):** "not available" claims replaced with both-runner facts. CLI runner TTS is a first-class path.
- `~/clawd/` workspace markdown drift: agents trust workspace markdown over code-generated system prompt hints. If any bootstrap file (MEMORY.md, USER.md, TOOLS.md) or context file (entities/, gotchas.md) contradicts the system prompt, the agent sides with the persistent docs. Fixing a subset of conflicting files is equivalent to fixing none — one contradiction collapses agent confidence. Keep ~/clawd/ aligned with CLI-mode behavior.
- `session.ts:332-335`: `/new` reset merges `{ ...store[sessionKey], ...sessionEntry }` which can preserve old `cliSessionIds` in the on-disk store even when the in-memory entry is reset.
- `helpers.ts:210`: `ttsHint` only generated when `params.config` is truthy. A missing/undefined config silently drops the hint entirely — no warning.
- `system-prompt.ts:106` + `helpers.ts:210`: `buildVoiceSection` wraps the hint with a `## Voice (TTS)` header, but the hint itself starts with `## Voice Bubbles (TTS)` — cosmetic double heading, not functional.
- `~/clawd/CLAUDE.md` contains `@context/INDEX.md` (18 bytes). Claude Code's `@` include auto-expansion requires `hasClaudeMdExternalIncludesApproved` in CLI settings — if not set, the agent sees literal `@context/INDEX.md` text, not the included content.
- `cli-backends.ts:46`: `systemPromptArg: "--append-system-prompt"` is the flag name. If this string ever goes out of sync with the claude CLI (flag rename, deprecation), the entire system prompt is silently dropped.
- `sanitizeCliPrompt()` at `helpers.ts:20-28` only handles six phrases (all from w13 streaming classifier work). New moltbot-internal identifiers added to system prompts would need to be added here to avoid classifier rejection.

## Reference

- Workspace dir: `~/clawd` (or `~/clawd-<profile>` when `CLAWDBOT_PROFILE` is set)
- Bootstrap files candidates: AGENTS.md, SOUL.md, TOOLS.md, IDENTITY.md, USER.md, HEARTBEAT.md, BOOTSTRAP.md, MEMORY.md, memory.md
- CLI flag: `--append-system-prompt` (positional: value follows as separate argv element)
- Related commits: `b1da39f` (w14: add CLI TTS tool), `27f783e` (w14: fix system prompt delivery + improve hint), `0cfcf42` (w14: deliver system prompt on resumed CLI turns — the fix), `4243c72` (w13: sanitize CLI prompt for streaming classifier)
- Related work: `investing/work/w14_moltbot-tts/` (TTS voice bubbles — DONE), `w13_moltbot-cli-backend/` (CLI backend switch + sanitization)
