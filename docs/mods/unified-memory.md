# Unified Memory

Index Claude Code CLI sessions into moltbot's memory system, enabling shared context across phone (Telegram) and direct CLI usage.

## Goals

1. **Unified index** - All Claude Code sessions indexed in moltbot's memory
2. **Telegram access** - Search memory via moltbot on phone
3. **CLI access** - Search memory from direct Claude Code CLI via Bash

## Problem

When using both moltbot (via Telegram) and Claude Code CLI directly:

```
Phone (Telegram) → Moltbot → Claude CLI → ~/.clawdbot/state/*/sessions/
Direct CLI       → Claude CLI           → ~/.claude/projects/*/
```

These create separate session stores. Moltbot's memory only indexes its own sessions, so:
- Conversations via Telegram have memory
- Direct CLI work is invisible to moltbot

Users who switch between phone and CLI lose context continuity.

## Solution

Add a new memory source `"claude-sessions"` that indexes Claude Code's native session files alongside moltbot's existing sources.

### Current Sources

| Source | Location | Format |
|--------|----------|--------|
| `memory` | `{workspace}/MEMORY.md`, `{workspace}/memory/` | Markdown |
| `sessions` | `~/.clawdbot/state/agents/{agentId}/sessions/` | JSONL |

### New Source

| Source | Location | Format |
|--------|----------|--------|
| `claude-sessions` | `~/.claude/projects/*/` | JSONL |

## Architecture

### Files to Modify

**`src/agents/memory-search.ts`**
- Add `"claude-sessions"` to `ResolvedMemorySearchConfig.sources` type
- Add config option for Claude sessions path (default: `~/.claude/projects`)

**`src/memory/manager.ts`**
- Add `listClaudeSessionFiles()` - glob `~/.claude/projects/*/*.jsonl`
- Add `buildClaudeSessionEntry()` - parse Claude Code JSONL format
- Add `syncClaudeSessionFiles()` - index alongside existing sources
- Extend `ensureSessionListener()` to watch Claude's directory

### JSONL Format Compatibility

**Moltbot's existing parser expects:**
```json
{"type": "message", "message": {"role": "user", "content": "..."}}
{"type": "message", "message": {"role": "assistant", "content": [{"type": "text", "text": "..."}]}}
```

**Claude Code's actual format:**
```json
{"type": "user", "message": {"role": "user", "content": "..."}}
{"type": "assistant", "message": {"role": "assistant", "content": [{"type": "text", "text": "..."}]}}
{"type": "assistant", "message": {"role": "assistant", "content": [{"type": "tool_use", "name": "Read", ...}]}}
{"type": "user", "message": {"role": "user", "content": [{"type": "tool_result", ...}]}}
```

**Differences:**
1. Top-level `type` is `"user"`/`"assistant"` (not `"message"`)
2. Content can include `tool_use` and `tool_result` blocks

**Parser adaptation:**
- Accept `type: "user"` and `type: "assistant"` as valid message types
- Extract only `text` blocks from content arrays
- Skip `tool_use` and `tool_result` blocks (not useful for search)

### Config Schema

```json
{
  "agents": {
    "defaults": {
      "memorySearch": {
        "sources": ["memory", "sessions", "claude-sessions"],
        "claudeSessions": {
          "enabled": true,
          "path": "~/.claude/projects",
          "watch": true
        }
      }
    }
  }
}
```

## Implementation Steps

1. **Verify Claude Code JSONL format** - Read sample session files, confirm parser compatibility
2. **Add source type** - Extend types in `memory-search.ts`, add `"claude-sessions"` source
3. **Add project extraction** - Implement `extractProjectSlug()` from session path
4. **Add file discovery** - Implement `listClaudeSessionFiles()` to glob `~/.claude/projects/*/*.jsonl`
5. **Add parser** - Implement or adapt `buildClaudeSessionEntry()` with project metadata
6. **Add deduplication** - Skip sessions that originated from moltbot (by `claudeSessionId`)
7. **Extend schema** - Add `project` column to chunks table for filtering
8. **Add sync logic** - Implement `syncClaudeSessionFiles()`
9. **Add file watcher** - Watch `~/.claude/projects/` for changes
10. **Add search filter** - Support `project` option in `search()` method
11. **Extend CLI** - Add `--project` flag to `clawdbot memory search`
12. **Test** - Verify indexing, deduplication, and project-scoped search

## Design Decisions

1. **Project metadata** - Index all projects, but store project slug as metadata on each chunk. The slug is extracted from the session path (e.g., `-home-ben-projects-mine` → `mine`). Searches can filter by project.

2. **Session deduplication** - Dedupe by session ID at index time. Moltbot stores Claude session IDs in the session store:
   - Location: `~/.clawdbot/state/agents/{agentId}/sessions/sessions.json`
   - Field: `entry.cliSessionIds["claude-cli"]` or `entry.claudeCliSessionId`
   - At index time: load all moltbot Claude session IDs, skip those files when indexing `~/.claude/projects/`

## Project Filtering

Claude Code organizes sessions by project:

```
~/.claude/projects/
├── -home-ben-projects-moltbot/      ← project: "moltbot"
├── -home-ben-projects-mine/         ← project: "mine"
├── -home-ben-projects-patent-search/← project: "patent-search"
```

### Indexing

Extract project slug from path and store on each chunk:

```typescript
// -home-ben-projects-mine → mine
// -home-ben-projects-patent-search → patent-search
function extractProjectSlug(sessionPath: string): string {
  const dirName = path.basename(path.dirname(sessionPath));
  // Claude slugifies paths: /home/ben/projects/mine → -home-ben-projects-mine
  // Extract everything after the last "projects-"
  const match = dirName.match(/projects-(.+)$/);
  return match?.[1] ?? dirName;
}
```

### Search Filtering

Support optional project filter at query time:

```typescript
interface MemorySearchOptions {
  maxResults?: number;
  minScore?: number;
  sessionKey?: string;
  project?: string;  // filter to specific Claude Code project
}
```

### Config

```json
{
  "agents": {
    "defaults": {
      "memorySearch": {
        "sources": ["memory", "sessions", "claude-sessions"],
        "claudeSessions": {
          "enabled": true,
          "path": "~/.claude/projects",
          "defaultProject": null
        }
      }
    }
  }
}
```

### Query Examples

```bash
# Via clawdbot CLI
clawdbot memory search "How did I implement embeddings?" --project mine

# Via Telegram
"How did I implement embeddings? #mine"
```

## Design Decisions (continued)

3. **Bulk indexing** - Initial indexing of all historical sessions can run overnight or on GPU (runpod). After that, incremental indexing handles new sessions in the background.

## CLI Access

Moltbot already has `clawdbot memory search`. Add `--project` filter for Claude Code projects.

### Existing CLI

```bash
clawdbot memory search "query" --agent <id> --max-results <n> --json
```

### Extended CLI

```bash
clawdbot memory search "how did I implement X" --project mine --json
```

Same pattern as `m chunks "query"` (mine) and patent-search. Claude Code calls via Bash - no MCP overhead.

### Implementation

Extend `src/cli/memory-cli.ts`:
1. Add `--project <slug>` option to search command
2. Pass to `manager.search()` which filters by project metadata on chunks

## Alternatives Considered

### Symlink Hack
Symlink Claude sessions into moltbot's watched directory. Rejected: still needs JSONL parsing which only happens for `sessions` source.

### Moltbot Extension
Build as a plugin. Rejected: memory sources aren't pluggable in current architecture.

### Separate Tool (claude-log)
Build standalone search tool. Rejected: doesn't provide unified memory for moltbot conversations.

### Replace Claude CLI with clawdbot agent
Use `clawdbot agent` instead of `claude` CLI. Rejected: loses Claude Code's skills, hooks, and established workflow.
