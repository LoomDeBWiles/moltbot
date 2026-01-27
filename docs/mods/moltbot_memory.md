# Moltbot Memory Architecture

How moltbot processes messages and executes tools.

## End-to-End Flow

### Step 1: Telegram Receives Message

**File:** `src/telegram/bot.ts`

When you send a message to your Telegram bot, Telegram's servers forward it to moltbot via webhook or long-polling. Moltbot uses the **grammy** library (a Telegram Bot API framework for Node.js) to receive these updates.

The bot is created with `createTelegramBot()` which sets up:
- Bot token authentication with Telegram
- Message handlers via `bot.on("message", handler)`
- Sequentialization to ensure messages from the same chat process in order (not in parallel)

**What happens:**
```
Telegram servers → HTTP POST to moltbot → grammy parses update → bot.on("message") fires
```

The raw Telegram update contains: sender info, chat ID, message text, any media attachments, reply-to info, etc.

---

### Step 2: Routing & Validation

**File:** `src/telegram/bot-handlers.ts`

Before processing the message, moltbot validates it:

1. **Deduplication** - Telegram can send the same update multiple times. Moltbot tracks update IDs to skip duplicates.

2. **Permission checks** - Is this sender allowed to use the bot?
   - Group policy: Is the bot enabled for this group?
   - Sender allowlist: Is this specific user permitted?
   - Pairing mode: Does an unknown sender need to enter a pairing code?

3. **Media handling** - If the message has images, files, or voice notes:
   - Download media from Telegram's servers
   - Buffer media groups (multiple images sent together)
   - Validate file sizes

4. **Debounce queue** - Messages are queued briefly to batch rapid-fire messages from the same user (e.g., someone sending multiple lines quickly).

**What happens:**
```
Raw message → Is it a duplicate? → Is sender allowed? → Download any media → Queue for processing
```

If any check fails, the message is dropped or a rejection reply is sent.

---

### Step 3: Session Resolution & Agent Setup

**Files:** `src/auto-reply/reply/session.ts`, `src/config/sessions/session-key.ts`

Before calling the LLM, moltbot must decide: **start a new conversation or continue an existing one?**

#### How Session Keys Work

Every conversation is identified by a **session key** - a string that uniquely identifies the chat context. The key is derived from the incoming message:

```typescript
// src/config/sessions/session-key.ts
function resolveSessionKey(scope, ctx, mainKey) {
  // If message already has explicit session key, use it
  if (ctx.SessionKey) return ctx.SessionKey;

  // For groups: "agent:default:telegram:group:12345"
  // For DMs: "agent:default:main" (all DMs collapse to "main")
  const isGroup = raw.includes(":group:") || raw.includes(":channel:");
  if (!isGroup) return "agent:default:main";
  return `agent:default:${raw}`;
}
```

**Key insight:** All direct messages (DMs) share ONE session key (`agent:default:main`). Each group/channel gets its own key.

#### Session Store

Sessions are tracked in a JSON file at `~/.clawdbot/state/agents/{agentId}/sessions.json`:

```json
{
  "agent:default:main": {
    "sessionId": "abc-123-uuid",
    "sessionFile": "~/.clawdbot/state/agents/default/sessions/abc-123-uuid.jsonl",
    "updatedAt": 1706000000000,
    "systemSent": true
  },
  "agent:default:telegram:group:98765": {
    "sessionId": "def-456-uuid",
    "sessionFile": "...",
    "updatedAt": 1706000000000
  }
}
```

#### New vs Existing Decision

`initSessionState()` in `src/auto-reply/reply/session.ts` decides:

1. **Compute session key** from the message context
2. **Look up session key** in the session store
3. **Check freshness** - Is the session still "fresh" or has it timed out?
   - Configurable timeout (e.g., 24 hours of inactivity = stale)
   - Stale sessions start fresh
4. **Check for reset trigger** - Did user say `/new` or `/reset`?
   - If yes, force new session even if fresh exists
5. **Result:**
   - **Fresh session exists**: Load it, continue conversation
   - **No session or stale**: Create new session ID, start fresh

```typescript
// Simplified logic from session.ts
const entry = sessionStore[sessionKey];
const freshEntry = entry
  ? evaluateSessionFreshness({ updatedAt: entry.updatedAt, now, policy: resetPolicy }).fresh
  : false;

if (!isNewSession && freshEntry) {
  // Continue existing session
  sessionId = entry.sessionId;
  systemSent = entry.systemSent;
} else {
  // Start new session
  sessionId = crypto.randomUUID();
  isNewSession = true;
  systemSent = false;
}
```

#### Session Transcript Files

Each session has a JSONL transcript file storing the full conversation:
- Location: `~/.clawdbot/state/agents/{agentId}/sessions/{sessionId}.jsonl`
- Format: One JSON object per line (user messages, assistant messages, tool calls, etc.)
- Loaded on each message to provide conversation history to the LLM

**What happens:**
```
Message arrives
  → Compute session key (e.g., "agent:default:main" for DM)
  → Look up in session store
  → Fresh? Continue with existing sessionId
  → Stale or /new? Create new sessionId
  → Load transcript JSONL file for history
```

#### Agent Setup (Part of Step 3)

**File:** `src/auto-reply/reply/get-reply.ts`

Once the session is resolved, moltbot prepares to call the LLM:

1. **Agent resolution** - Which "agent" handles this chat? Moltbot supports multiple agents (different personalities/configs). The agent ID is derived from the session key.

2. **Model selection** - Which LLM model to use? Loaded from config (e.g., `claude-sonnet-4-20250514`).

3. **Session transcript loading** - Using the session ID, load the JSONL transcript file so the LLM has context of prior messages.

4. **System prompt building** - Constructs the system prompt that tells the LLM who it is, what tools it has, and how to behave:
   - Base personality/instructions
   - Available tool descriptions
   - Memory recall instructions (if memory tools are enabled)

**What happens:**
```
Session ID → Load transcript JSONL → Resolve agent config → Load model config → Build system prompt
```

The output is a prepared context ready for the LLM call.

---

### Step 4: Tool Creation

**File:** `src/agents/pi-embedded-runner/run/attempt.ts` (line ~202)

Before calling the LLM, moltbot creates the tool objects. Tools are JavaScript functions that the LLM can invoke.

`createClawdbotCodingTools()` assembles all available tools:
- **File tools**: read, write, edit (for filesystem access)
- **Bash/exec**: run shell commands
- **Memory tools**: memory_search, memory_get (from memory-core plugin)
- **Browser tools**: web search, web fetch
- **Messaging tools**: send messages to other chats
- **And more**: canvas, cron, nodes, etc.

Each tool has:
- A **name** (e.g., `memory_search`)
- A **description** (tells LLM when to use it)
- A **JSON schema** (defines parameters)
- An **execute function** (the actual code that runs)

**What happens:**
```
Config + session context → createClawdbotCodingTools() → Array of tool objects with execute functions
```

The tools are NOT Bash commands. They're JavaScript functions that run in the same Node.js process as moltbot.

---

### Step 5: LLM Call

**File:** `src/agents/pi-embedded-runner/run/attempt.ts` (line 782)

This is where moltbot actually calls Claude. It uses the `@mariozechner/pi-ai` library, which wraps the Anthropic API.

The call looks like:
```typescript
activeSession.prompt(effectivePrompt)
```

What gets sent to Claude:
- **System prompt**: The instructions built in step 3
- **Message history**: All prior user/assistant messages from the transcript
- **Tools schema**: JSON schema of all available tools (so Claude knows what it can call)
- **Current user message**: The new message being processed
- **Images** (if any): Attached media

Claude's API is streaming - responses come back in chunks. Moltbot subscribes to these events:
- `onPartialReply`: Text chunks as they stream
- `onToolResult`: When a tool finishes executing
- `onBlockReply`: Complete response blocks

**What happens:**
```
System prompt + history + tools + user message → Anthropic API → Streaming response chunks
```

---

### Step 6: Tool Execution

**File:** Tool execution is handled by the SessionManager from `@mariozechner/pi-coding-agent`

When Claude decides to use a tool, it returns a `tool_use` block in its response:
```json
{
  "type": "tool_use",
  "name": "memory_search",
  "input": { "query": "what did we discuss about authentication?" }
}
```

The SessionManager intercepts this and:

1. **Finds the tool** by name from the tools array created in step 4
2. **Validates parameters** against the tool's JSON schema
3. **Executes the tool's function**:
   ```typescript
   // memory-tool.ts execute function
   const results = await manager.search(query, { maxResults, minScore });
   return jsonResult({ results });
   ```
4. **Returns the result** to Claude as a `tool_result` message
5. **Claude continues** - sees the result and generates more response (or calls another tool)

This loop continues until Claude returns a final text response without tool calls.

**What happens:**
```
Claude returns tool_use → SessionManager executes tool function → Result sent back to Claude → Claude continues
```

For memory_search specifically:
```
tool_use: memory_search({query: "auth"})
  → manager.search("auth")
  → SQLite FTS + vector search
  → Returns matching snippets
  → Claude sees results and responds
```

---

### Step 7: Response Delivery

**File:** `src/telegram/bot-message-dispatch.ts`

Once Claude finishes responding, moltbot sends the reply back to Telegram:

1. **Streaming drafts** (optional, for private chats) - As Claude streams text, moltbot can update a "draft" message in real-time so you see the response being typed.

2. **Chunking** - Telegram has a 4096 character limit per message. Long responses are split into multiple messages.

3. **Markdown formatting** - Claude's markdown is converted to Telegram's supported format.

4. **Reply threading** - The response is sent as a reply to your original message (reply_to_message_id).

5. **Media attachments** - If Claude generated images or files, they're uploaded to Telegram.

**What happens:**
```
Claude's response → Chunk by Telegram limits → Format markdown → Send via bot.api → You see the reply
```

---

## Memory System Deep Dive

### Where Memory Data Lives

- **Memory files**: `{workspaceDir}/MEMORY.md` and `{workspaceDir}/memory/*.md` - Markdown files you can edit
- **Session transcripts**: `~/.clawdbot/state/agents/{agentId}/sessions/*.jsonl` - Conversation history
- **SQLite index**: `~/.clawdbot/state/memory/{agentId}.sqlite` - Vector + FTS search index

### How Memory Search Works

`MemoryIndexManager` in `src/memory/manager.ts`:

1. **Indexing**: Watches memory files and sessions, chunks them into ~400 token pieces, generates embeddings via OpenAI/Gemini, stores in SQLite with sqlite-vec extension

2. **Hybrid search**: Combines:
   - **Vector search**: Semantic similarity via embeddings
   - **FTS search**: Keyword matching via SQLite FTS5
   - Results merged with configurable weights (default: 70% vector, 30% text)

3. **Results**: Returns snippets with file path, line numbers, relevance score

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `src/telegram/bot.ts` | Telegram bot init, grammy handlers |
| `src/telegram/bot-handlers.ts` | Message validation, dedup, permissions |
| `src/auto-reply/reply/get-reply.ts` | Agent setup, session loading, system prompt |
| `src/agents/pi-embedded-runner/run/attempt.ts` | Tool creation and **LLM call** |
| `src/agents/pi-tools.ts` | Tool assembly and policy filtering |
| `src/agents/tools/memory-tool.ts` | memory_search and memory_get implementation |
| `src/memory/manager.ts` | MemoryIndexManager - indexing and search |
| `src/cli/memory-cli.ts` | CLI commands: `clawdbot memory search` |
| `extensions/memory-core/index.ts` | Plugin that registers memory tools |

---

## Questions

<!-- Add your questions below -->

