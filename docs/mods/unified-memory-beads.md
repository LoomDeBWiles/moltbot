# moltbot

## Unified Memory: Index Claude Code sessions

> Index ~/.claude/projects/ sessions into moltbot memory, enabling search across phone (Telegram) and direct CLI usage.

### Key Insight

**Separate parser for Claude format, not a format flag.** Claude JSONL uses `type: "user"/"assistant"` vs moltbot `type: "message"`. Rather than adding conditionals to existing parser, create `claude-session-files.ts` alongside `session-files.ts`. Keeps parsers focused and testable.

### Architecture

claude-sessions is a **file indexing pipeline** parallel to existing sessions source:

```
~/.claude/projects/*/*.jsonl
    → listClaudeSessionFiles()
    → buildClaudeSessionEntry() [extracts text, project slug]
    → deduplicateBySessionId() [skip moltbot-originated sessions]
    → indexFile() [existing chunking + embedding]
    → search() [with optional project filter]
```

### Public API

| Function | Signature | Purpose |
|----------|-----------|---------|
| `listClaudeSessionFiles` | `() -> Promise<string[]>` | Glob ~/.claude/projects/*/*.jsonl |
| `buildClaudeSessionEntry` | `(absPath: string) -> Promise<ClaudeSessionEntry \| null>` | Parse Claude JSONL, extract project |
| `extractProjectSlug` | `(sessionPath: string) -> string` | -home-ben-projects-mine → mine |
| `loadMoltbotSessionIds` | `(agentId: string) -> Promise<Set<string>>` | Get Claude session IDs from moltbot sessions.json |
| `syncClaudeSessionFiles` | `(params) -> Promise<void>` | Index with deduplication |

### Types

```typescript
type ClaudeSessionEntry = SessionFileEntry & {
  project: string;  // extracted slug (e.g., "mine", "moltbot")
  claudeSessionId: string;  // from filename for dedup
};

// Extended search options
interface MemorySearchOptions {
  maxResults?: number;
  minScore?: number;
  sessionKey?: string;
  project?: string;  // filter to specific Claude Code project
}
```

### Modules

| Module | Purpose |
|--------|---------|
| claude-session-files | Parse Claude Code JSONL format, extract project metadata |
| sync-claude-sessions | Index claude-sessions source with deduplication |
| memory-search (extend) | Add claude-sessions to sources type |
| manager (extend) | Integrate claude-sessions sync |
| memory-cli (extend) | Add --project flag |

### User Workflows

| ID | Workflow | Validates |
|----|----------|-----------|
| WF-1 | User runs `clawdbot memory sync` → Claude sessions indexed alongside moltbot sessions | UC-UM-1, UC-UM-2, UC-UM-3, UC-UM-4, UC-UM-5, UC-UM-6, UC-UM-8, UC-UM-9, UC-UM-12 |
| WF-2 | User runs `clawdbot memory search "query" --project mine` → Results filtered to project | UC-UM-7, UC-UM-10, UC-UM-11 |

### Config Schema

```json
{
  "sources": ["memory", "sessions", "claude-sessions"],
  "claudeSessions": {
    "enabled": true,
    "path": "~/.claude/projects"
  }
}
```

---
Exit criteria: `clawdbot memory search "query" --project mine` returns results from ~/.claude/projects/-home-ben-projects-mine/


**Status:** open

### Tasks

#### moltbot-sz1.2: UC-UM-2: Add claudeSessions config schema [closed]

**Contract:**
- Input: ``{ claudeSessions: { enabled: true, path: "~/.claude/projects" } }``
- Output: `resolved config with claudeSessions.enabled=true, claudeSessions.path expanded`
- Errors: `none (missing config uses defaults)`

**Acceptance:**
- [ ] `pnpm build && grep -q "claudeSessions" dist/agents/memory-search.js`

#### moltbot-sz1.1: UC-UM-1: Add claude-sessions source type [closed]

**Contract:**
- Input: `config with `sources: ["claude-sessions"]``
- Output: `resolved config includes `"claude-sessions"` in sources array`
- Errors: `none (invalid sources ignored)`

**Acceptance:**
- [ ] `pnpm build && grep -q "claude-sessions" dist/agents/memory-search.js`

#### moltbot-sz1.8: UC-UM-8: Sync Claude session files [closed]

**Contract:**
- Input: ``{ db, excludeSessionIds: Set<string>, indexFile, ... }` — same pattern as syncSessionFiles`
- Output: ``Promise<void>` — files indexed`
- Errors: `skips unreadable files, continues with others`

**Acceptance:**
- [ ] `pnpm test src/memory/sync-claude-sessions.test.ts`

#### moltbot-sz1.7: UC-UM-7: Add project column to chunks table [closed]

**Contract:**
- Input: ``chunk: { text: string, source: string, path: string, project?: string }` — project nullable for non-claude sources`
- Output: ``void` — chunk persisted with project column`
- Errors: ``Error` when migration fails on locked database`

**Acceptance:**
- [ ] `pnpm test src/memory/memory-schema.test.ts -t "project column"`

#### moltbot-sz1.5: UC-UM-5: Parse Claude JSONL format [closed]

**Contract:**
- Input: ``absPath: string` — path to Claude session .jsonl file`
- Output: ``Promise<ClaudeSessionEntry | null>` — entry with path, content, hash, project, claudeSessionId`
- Errors: `returns null if file unreadable or empty`

**Acceptance:**
- [ ] `pnpm test src/memory/claude-session-files.test.ts -t buildClaudeSessionEntry`

#### moltbot-sz1.4: UC-UM-4: List Claude session files [closed]

**Contract:**
- Input: ``basePath?: string` — defaults to ~/.claude/projects`
- Output: ``Promise<string[]>` — absolute paths to .jsonl files`
- Errors: `returns empty array if directory missing`

**Acceptance:**
- [ ] `pnpm test src/memory/claude-session-files.test.ts -t listClaudeSessionFiles`

#### moltbot-sz1.3: UC-UM-3: Extract project slug from session path [closed]

**Contract:**
- Input: ``sessionPath: string` — absolute path to Claude session file`
- Output: ``string` — project slug (e.g., "mine", "patent-search", "moltbot")`
- Errors: `returns directory name if no "projects-" found`

**Acceptance:**
- [ ] `pnpm test src/memory/claude-session-files.test.ts -t extractProjectSlug`

#### moltbot-sz1.11: UC-UM-11: Add --project flag to memory CLI [closed]

**Contract:**
- Input: ``--project slug: string` — optional CLI flag`
- Output: ``SearchResult[]` — filtered to specified project`
- Errors: `empty results when project has no matches`

**Acceptance:**
- [ ] `pnpm clawdbot memory search --help | grep -q "project"`

#### moltbot-sz1.10: UC-UM-10: Add project filter to search [closed]

**Contract:**
- Input: ``options: { query: string, project?: string, maxResults?: number }` — search options`
- Output: ``SearchResult[]` — filtered to specified project`
- Errors: `empty array when project has no indexed content`

**Acceptance:**
- [ ] `pnpm test src/memory/manager-search.test.ts -t "project filter"`

#### moltbot-sz1.9: UC-UM-9: Integrate claude-sessions sync into manager [closed]

**Contract:**
- Input: `resolved config with sources including "claude-sessions"`
- Output: `claude sessions indexed`
- Errors: `failure in claude-sessions sync does not block other sources`

**Acceptance:**
- [ ] `pnpm test src/memory/manager.test.ts -t "claude-sessions"`

#### moltbot-sz1.6: UC-UM-6: Load moltbot session IDs for dedup [closed]

**Contract:**
- Input: ``agentId: string` — moltbot agent ID`
- Output: ``Promise<Set<string>>` — set of Claude session IDs to skip`
- Errors: `returns empty set if sessions.json missing or malformed`

**Acceptance:**
- [ ] `pnpm test src/memory/claude-session-files.test.ts -t loadMoltbotClaudeSessionIds`

#### moltbot-sz1.12: UC-UM-12: Add file watcher for Claude projects [closed]

**Contract:**
- Input: `config with sync.watch=true and sources includes claude-sessions`
- Output: `watcher on ~/.claude/projects/**/*.jsonl`
- Errors: `watcher failure logged but does not crash`

**Acceptance:**
- [ ] `pnpm test src/memory/manager.test.ts -t "claude watcher"`

## Uncategorized

Tasks without a parent epic

**Status:** open

### Tasks

#### moltbot-g5p: Zod schema missing claudeSessions and claude-sessions source [closed]

