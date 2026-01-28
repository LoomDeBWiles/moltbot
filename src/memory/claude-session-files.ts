import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

/** Entry representing a Claude Code session for memory indexing */
export interface ClaudeSessionEntry {
  path: string;
  content: string;
  hash: string;
  project: string;
  claudeSessionId: string;
}

/**
 * Lists all Claude Code session files (.jsonl) from ~/.claude/projects/.
 *
 * @param basePath - Optional base path, defaults to ~/.claude/projects
 * @returns Array of absolute paths to .jsonl files
 */
export async function listClaudeSessionFiles(basePath?: string): Promise<string[]> {
  const projectsDir = basePath ?? path.join(os.homedir(), ".claude", "projects");
  try {
    const projectDirs = await fs.readdir(projectsDir, { withFileTypes: true });
    const results: string[] = [];
    for (const entry of projectDirs) {
      if (!entry.isDirectory()) continue;
      const projectPath = path.join(projectsDir, entry.name);
      try {
        const files = await fs.readdir(projectPath, { withFileTypes: true });
        for (const file of files) {
          if (file.isFile() && file.name.endsWith(".jsonl")) {
            results.push(path.join(projectPath, file.name));
          }
        }
      } catch {
        // skip inaccessible project directories
      }
    }
    return results;
  } catch {
    return [];
  }
}

/**
 * Extract project slug from a Claude Code session path.
 *
 * Claude slugifies project paths: /home/ben/projects/mine → -home-ben-projects-mine
 * This extracts the final component after "projects-".
 *
 * @param sessionPath - Absolute path to Claude session file
 * @returns Project slug (e.g., "mine", "patent-search", "moltbot")
 *          or the directory name if no "projects-" pattern found
 *
 * @example
 * extractProjectSlug("~/.claude/projects/-home-ben-projects-mine/abc123.jsonl")
 * // => "mine"
 *
 * extractProjectSlug("~/.claude/projects/-home-ben-projects-patent-search/session.jsonl")
 * // => "patent-search"
 */
export function extractProjectSlug(sessionPath: string): string {
  const dirName = path.basename(path.dirname(sessionPath));
  const match = dirName.match(/projects-(.+)$/);
  return match?.[1] ?? dirName;
}

/**
 * Load Claude session IDs that originated from moltbot for deduplication.
 *
 * Reads moltbot's sessions.json and extracts Claude CLI session IDs
 * stored in either `entry.cliSessionIds["claude-cli"]` or `entry.claudeCliSessionId`.
 *
 * @param agentId - The moltbot agent ID
 * @returns Set of Claude session IDs to skip when indexing ~/.claude/projects
 */
export async function loadMoltbotClaudeSessionIds(agentId: string): Promise<Set<string>> {
  const stateDir = process.env.CLAWDBOT_STATE_DIR ?? path.join(os.homedir(), ".clawdbot", "state");
  const sessionsPath = path.join(stateDir, "agents", agentId, "sessions", "sessions.json");

  try {
    const content = await fs.readFile(sessionsPath, "utf-8");
    const store = JSON.parse(content) as Record<string, unknown>;

    if (!store || typeof store !== "object" || Array.isArray(store)) {
      return new Set();
    }

    const sessionIds = new Set<string>();
    for (const entry of Object.values(store)) {
      if (!entry || typeof entry !== "object") continue;
      const rec = entry as Record<string, unknown>;

      // Check cliSessionIds["claude-cli"]
      if (rec.cliSessionIds && typeof rec.cliSessionIds === "object") {
        const cliIds = rec.cliSessionIds as Record<string, unknown>;
        const claudeId = cliIds["claude-cli"];
        if (typeof claudeId === "string" && claudeId) {
          sessionIds.add(claudeId);
        }
      }

      // Check claudeCliSessionId
      if (typeof rec.claudeCliSessionId === "string" && rec.claudeCliSessionId) {
        sessionIds.add(rec.claudeCliSessionId);
      }
    }

    return sessionIds;
  } catch {
    return new Set();
  }
}

/** JSONL line structure for Claude Code session files */
interface ClaudeJsonlLine {
  type: string;
  sessionId?: string;
  message?: {
    role?: string;
    content?: string | Array<{ type: string; text?: string }>;
  };
}

/**
 * Extract text content from a Claude Code session JSONL file.
 *
 * Processes lines with type "user" or "assistant" and extracts
 * text blocks from their message.content arrays. Skips tool_use
 * and tool_result blocks.
 *
 * @param lines - Array of parsed JSONL line objects
 * @returns Concatenated text content from the session
 */
export function extractClaudeSessionText(lines: ClaudeJsonlLine[]): string {
  const parts: string[] = [];

  for (const line of lines) {
    if (line.type !== "user" && line.type !== "assistant") continue;
    const content = line.message?.content;
    if (!content) continue;

    if (typeof content === "string") {
      parts.push(content);
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === "text" && typeof block.text === "string") {
          parts.push(block.text);
        }
      }
    }
  }

  return parts.join("\n\n");
}

/**
 * Build a ClaudeSessionEntry from a JSONL session file.
 *
 * Reads the file, parses JSONL lines, extracts text content from
 * user and assistant messages, and returns an entry for indexing.
 *
 * @param absPath - Absolute path to Claude session .jsonl file
 * @returns Entry with path, content, hash, project, claudeSessionId
 *          or null if file unreadable or empty
 */
export async function buildClaudeSessionEntry(absPath: string): Promise<ClaudeSessionEntry | null> {
  let raw: string;
  try {
    raw = await fs.readFile(absPath, "utf-8");
  } catch {
    return null;
  }

  if (!raw.trim()) return null;

  const lines: ClaudeJsonlLine[] = [];
  let sessionId: string | undefined;

  for (const lineStr of raw.split("\n")) {
    if (!lineStr.trim()) continue;
    try {
      const parsed = JSON.parse(lineStr) as ClaudeJsonlLine;
      lines.push(parsed);
      if (!sessionId && parsed.sessionId) {
        sessionId = parsed.sessionId;
      }
    } catch {
      // skip malformed lines
    }
  }

  const content = extractClaudeSessionText(lines);
  if (!content) return null;

  const hash = createHash("sha256").update(content).digest("hex");
  const project = extractProjectSlug(absPath);
  const claudeSessionId = sessionId ?? path.basename(absPath, ".jsonl");

  return { path: absPath, content, hash, project, claudeSessionId };
}
