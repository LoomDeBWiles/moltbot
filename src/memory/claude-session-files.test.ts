import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  listClaudeSessionFiles,
  extractProjectSlug,
  loadMoltbotClaudeSessionIds,
  extractClaudeSessionText,
  buildClaudeSessionEntry,
} from "./claude-session-files.js";

describe("listClaudeSessionFiles", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-sessions-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns array of absolute paths to .jsonl files", async () => {
    const projectA = path.join(tmpDir, "-home-ben-projects-mine");
    const projectB = path.join(tmpDir, "-home-ben-projects-moltbot");
    await fs.mkdir(projectA);
    await fs.mkdir(projectB);

    const fileA1 = path.join(projectA, "abc123.jsonl");
    const fileA2 = path.join(projectA, "def456.jsonl");
    const fileB1 = path.join(projectB, "ghi789.jsonl");

    await fs.writeFile(fileA1, '{"type":"user"}\n');
    await fs.writeFile(fileA2, '{"type":"assistant"}\n');
    await fs.writeFile(fileB1, '{"type":"user"}\n');

    const result = await listClaudeSessionFiles(tmpDir);

    expect(result).toHaveLength(3);
    expect(result).toContain(fileA1);
    expect(result).toContain(fileA2);
    expect(result).toContain(fileB1);
    for (const p of result) {
      expect(path.isAbsolute(p)).toBe(true);
    }
  });

  it("ignores non-.jsonl files", async () => {
    const projectDir = path.join(tmpDir, "-home-ben-projects-test");
    await fs.mkdir(projectDir);
    await fs.writeFile(path.join(projectDir, "session.jsonl"), "{}");
    await fs.writeFile(path.join(projectDir, "notes.txt"), "notes");
    await fs.writeFile(path.join(projectDir, "config.json"), "{}");

    const result = await listClaudeSessionFiles(tmpDir);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatch(/session\.jsonl$/);
  });

  it("returns empty array if directory missing", async () => {
    const nonexistent = path.join(tmpDir, "does-not-exist");
    const result = await listClaudeSessionFiles(nonexistent);
    expect(result).toEqual([]);
  });

  it("returns empty array if directory is empty", async () => {
    const result = await listClaudeSessionFiles(tmpDir);
    expect(result).toEqual([]);
  });

  it("skips inaccessible project directories", async () => {
    const goodProject = path.join(tmpDir, "-home-ben-projects-good");
    await fs.mkdir(goodProject);
    await fs.writeFile(path.join(goodProject, "session.jsonl"), "{}");

    const result = await listClaudeSessionFiles(tmpDir);
    expect(result).toHaveLength(1);
  });

  it("defaults to ~/.claude/projects when no basePath given", async () => {
    const result = await listClaudeSessionFiles();
    expect(Array.isArray(result)).toBe(true);
  });
});

describe("extractProjectSlug", () => {
  it("extracts project slug from standard Claude path", () => {
    const result = extractProjectSlug(
      "/home/ben/.claude/projects/-home-ben-projects-mine/abc123.jsonl",
    );
    expect(result).toBe("mine");
  });

  it("extracts multi-part project names with hyphens", () => {
    const result = extractProjectSlug(
      "/home/ben/.claude/projects/-home-ben-projects-patent-search/session.jsonl",
    );
    expect(result).toBe("patent-search");
  });

  it("handles moltbot project", () => {
    const result = extractProjectSlug(
      "/home/ben/.claude/projects/-home-ben-projects-moltbot/xyz.jsonl",
    );
    expect(result).toBe("moltbot");
  });

  it("returns directory name when no projects- pattern found", () => {
    const result = extractProjectSlug("/some/other/path/random-dir/session.jsonl");
    expect(result).toBe("random-dir");
  });

  it("handles path with ~ prefix", () => {
    const result = extractProjectSlug("~/.claude/projects/-home-ben-projects-mine/abc123.jsonl");
    expect(result).toBe("mine");
  });

  it("handles deeply nested project structures", () => {
    const result = extractProjectSlug(
      "/home/ben/.claude/projects/-home-ben-code-ai-projects-deep-nest/session.jsonl",
    );
    expect(result).toBe("deep-nest");
  });

  it("handles project name with multiple hyphens", () => {
    const result = extractProjectSlug(
      "/home/ben/.claude/projects/-home-ben-projects-my-cool-app/session.jsonl",
    );
    expect(result).toBe("my-cool-app");
  });
});

describe("loadMoltbotClaudeSessionIds", () => {
  let tmpDir: string;
  const originalEnv = process.env.CLAWDBOT_STATE_DIR;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "moltbot-sessions-test-"));
    process.env.CLAWDBOT_STATE_DIR = tmpDir;
  });

  afterEach(async () => {
    process.env.CLAWDBOT_STATE_DIR = originalEnv;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns set of Claude session IDs from cliSessionIds", async () => {
    const agentId = "test-agent";
    const sessionsDir = path.join(tmpDir, "agents", agentId, "sessions");
    await fs.mkdir(sessionsDir, { recursive: true });
    await fs.writeFile(
      path.join(sessionsDir, "sessions.json"),
      JSON.stringify({
        session1: {
          sessionId: "s1",
          cliSessionIds: { "claude-cli": "claude-abc123" },
        },
        session2: {
          sessionId: "s2",
          cliSessionIds: { "claude-cli": "claude-def456" },
        },
      }),
    );

    const result = await loadMoltbotClaudeSessionIds(agentId);

    expect(result).toBeInstanceOf(Set);
    expect(result.size).toBe(2);
    expect(result.has("claude-abc123")).toBe(true);
    expect(result.has("claude-def456")).toBe(true);
  });

  it("returns set of Claude session IDs from claudeCliSessionId", async () => {
    const agentId = "test-agent";
    const sessionsDir = path.join(tmpDir, "agents", agentId, "sessions");
    await fs.mkdir(sessionsDir, { recursive: true });
    await fs.writeFile(
      path.join(sessionsDir, "sessions.json"),
      JSON.stringify({
        session1: {
          sessionId: "s1",
          claudeCliSessionId: "claude-legacy-123",
        },
      }),
    );

    const result = await loadMoltbotClaudeSessionIds(agentId);

    expect(result.size).toBe(1);
    expect(result.has("claude-legacy-123")).toBe(true);
  });

  it("extracts from both cliSessionIds and claudeCliSessionId", async () => {
    const agentId = "test-agent";
    const sessionsDir = path.join(tmpDir, "agents", agentId, "sessions");
    await fs.mkdir(sessionsDir, { recursive: true });
    await fs.writeFile(
      path.join(sessionsDir, "sessions.json"),
      JSON.stringify({
        session1: {
          sessionId: "s1",
          cliSessionIds: { "claude-cli": "claude-from-cli-ids" },
        },
        session2: {
          sessionId: "s2",
          claudeCliSessionId: "claude-from-legacy",
        },
        session3: {
          sessionId: "s3",
          cliSessionIds: { "claude-cli": "claude-both" },
          claudeCliSessionId: "claude-both", // same value
        },
      }),
    );

    const result = await loadMoltbotClaudeSessionIds(agentId);

    expect(result.size).toBe(3);
    expect(result.has("claude-from-cli-ids")).toBe(true);
    expect(result.has("claude-from-legacy")).toBe(true);
    expect(result.has("claude-both")).toBe(true);
  });

  it("returns empty set if sessions.json missing", async () => {
    const result = await loadMoltbotClaudeSessionIds("nonexistent-agent");
    expect(result).toBeInstanceOf(Set);
    expect(result.size).toBe(0);
  });

  it("returns empty set if sessions.json is malformed", async () => {
    const agentId = "test-agent";
    const sessionsDir = path.join(tmpDir, "agents", agentId, "sessions");
    await fs.mkdir(sessionsDir, { recursive: true });
    await fs.writeFile(path.join(sessionsDir, "sessions.json"), "not valid json");

    const result = await loadMoltbotClaudeSessionIds(agentId);

    expect(result.size).toBe(0);
  });

  it("returns empty set if sessions.json is an array", async () => {
    const agentId = "test-agent";
    const sessionsDir = path.join(tmpDir, "agents", agentId, "sessions");
    await fs.mkdir(sessionsDir, { recursive: true });
    await fs.writeFile(path.join(sessionsDir, "sessions.json"), JSON.stringify([]));

    const result = await loadMoltbotClaudeSessionIds(agentId);

    expect(result.size).toBe(0);
  });

  it("skips entries without Claude session IDs", async () => {
    const agentId = "test-agent";
    const sessionsDir = path.join(tmpDir, "agents", agentId, "sessions");
    await fs.mkdir(sessionsDir, { recursive: true });
    await fs.writeFile(
      path.join(sessionsDir, "sessions.json"),
      JSON.stringify({
        session1: {
          sessionId: "s1",
          // no claude session id
        },
        session2: {
          sessionId: "s2",
          cliSessionIds: { "some-other-cli": "other-123" }, // not claude-cli
        },
        session3: {
          sessionId: "s3",
          cliSessionIds: { "claude-cli": "claude-valid" },
        },
      }),
    );

    const result = await loadMoltbotClaudeSessionIds(agentId);

    expect(result.size).toBe(1);
    expect(result.has("claude-valid")).toBe(true);
  });

  it("skips entries with empty Claude session IDs", async () => {
    const agentId = "test-agent";
    const sessionsDir = path.join(tmpDir, "agents", agentId, "sessions");
    await fs.mkdir(sessionsDir, { recursive: true });
    await fs.writeFile(
      path.join(sessionsDir, "sessions.json"),
      JSON.stringify({
        session1: {
          sessionId: "s1",
          cliSessionIds: { "claude-cli": "" },
        },
        session2: {
          sessionId: "s2",
          claudeCliSessionId: "",
        },
        session3: {
          sessionId: "s3",
          cliSessionIds: { "claude-cli": "claude-nonempty" },
        },
      }),
    );

    const result = await loadMoltbotClaudeSessionIds(agentId);

    expect(result.size).toBe(1);
    expect(result.has("claude-nonempty")).toBe(true);
  });

  it("handles null entries in store", async () => {
    const agentId = "test-agent";
    const sessionsDir = path.join(tmpDir, "agents", agentId, "sessions");
    await fs.mkdir(sessionsDir, { recursive: true });
    await fs.writeFile(
      path.join(sessionsDir, "sessions.json"),
      JSON.stringify({
        session1: null,
        session2: {
          sessionId: "s2",
          cliSessionIds: { "claude-cli": "claude-valid" },
        },
      }),
    );

    const result = await loadMoltbotClaudeSessionIds(agentId);

    expect(result.size).toBe(1);
    expect(result.has("claude-valid")).toBe(true);
  });
});

describe("extractClaudeSessionText", () => {
  it("extracts text from user and assistant messages with string content", () => {
    const lines = [
      { type: "user", message: { content: "Hello, what is 2+2?" } },
      { type: "assistant", message: { content: "The answer is 4." } },
    ];
    const result = extractClaudeSessionText(lines);
    expect(result).toBe("Hello, what is 2+2?\n\nThe answer is 4.");
  });

  it("extracts text blocks from content arrays", () => {
    const lines = [
      { type: "user", message: { content: "Tell me about AI" } },
      {
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "AI is a fascinating field." },
            { type: "text", text: "It has many applications." },
          ],
        },
      },
    ];
    const result = extractClaudeSessionText(lines);
    expect(result).toBe(
      "Tell me about AI\n\nAI is a fascinating field.\n\nIt has many applications.",
    );
  });

  it("skips tool_use and tool_result blocks", () => {
    const lines = [
      { type: "user", message: { content: "Search for files" } },
      {
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "Let me search." },
            { type: "tool_use", id: "toolu_123", name: "Bash", input: {} },
          ],
        },
      },
      {
        type: "user",
        message: {
          content: [{ type: "tool_result", tool_use_id: "toolu_123", content: "file.txt" }],
        },
      },
      {
        type: "assistant",
        message: { content: [{ type: "text", text: "I found file.txt" }] },
      },
    ];
    const result = extractClaudeSessionText(lines);
    expect(result).toBe("Search for files\n\nLet me search.\n\nI found file.txt");
  });

  it("skips queue-operation and other non-message types", () => {
    const lines = [
      { type: "queue-operation", operation: "dequeue", timestamp: "2026-01-10" },
      { type: "user", message: { content: "Hello" } },
      { type: "summary", content: "session summary" },
      { type: "assistant", message: { content: "Hi there!" } },
    ];
    const result = extractClaudeSessionText(lines);
    expect(result).toBe("Hello\n\nHi there!");
  });

  it("returns empty string for lines without text content", () => {
    const lines = [
      { type: "user", message: {} },
      { type: "assistant", message: { content: [] } },
    ];
    const result = extractClaudeSessionText(lines);
    expect(result).toBe("");
  });

  it("handles empty lines array", () => {
    const result = extractClaudeSessionText([]);
    expect(result).toBe("");
  });

  it("handles mixed string and array content", () => {
    const lines = [
      { type: "user", message: { content: "Question one" } },
      {
        type: "assistant",
        message: { content: [{ type: "text", text: "Answer one" }] },
      },
      {
        type: "user",
        message: { content: [{ type: "text", text: "Question two" }] },
      },
      { type: "assistant", message: { content: "Answer two" } },
    ];
    const result = extractClaudeSessionText(lines);
    expect(result).toBe("Question one\n\nAnswer one\n\nQuestion two\n\nAnswer two");
  });
});

describe("buildClaudeSessionEntry", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "build-claude-entry-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns entry with extracted text content, project slug, and session ID", async () => {
    const projectDir = path.join(tmpDir, "-home-ben-projects-moltbot");
    await fs.mkdir(projectDir);
    const filePath = path.join(projectDir, "abc123-session-id.jsonl");
    const jsonl = [
      JSON.stringify({
        type: "user",
        sessionId: "abc123-session-id",
        message: { content: "Hello" },
      }),
      JSON.stringify({
        type: "assistant",
        sessionId: "abc123-session-id",
        message: { content: "Hi there!" },
      }),
    ].join("\n");
    await fs.writeFile(filePath, jsonl);

    const result = await buildClaudeSessionEntry(filePath);

    expect(result).not.toBeNull();
    expect(result!.path).toBe(filePath);
    expect(result!.content).toBe("Hello\n\nHi there!");
    expect(result!.project).toBe("moltbot");
    expect(result!.claudeSessionId).toBe("abc123-session-id");
    expect(result!.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("extracts text from content arrays with text blocks", async () => {
    const projectDir = path.join(tmpDir, "-home-ben-projects-mine");
    await fs.mkdir(projectDir);
    const filePath = path.join(projectDir, "session.jsonl");
    const jsonl = [
      JSON.stringify({
        type: "user",
        sessionId: "sess-001",
        message: { content: "What is TypeScript?" },
      }),
      JSON.stringify({
        type: "assistant",
        sessionId: "sess-001",
        message: {
          content: [{ type: "text", text: "TypeScript is a typed superset of JavaScript." }],
        },
      }),
    ].join("\n");
    await fs.writeFile(filePath, jsonl);

    const result = await buildClaudeSessionEntry(filePath);

    expect(result).not.toBeNull();
    expect(result!.content).toBe(
      "What is TypeScript?\n\nTypeScript is a typed superset of JavaScript.",
    );
  });

  it("skips tool_use and tool_result blocks", async () => {
    const projectDir = path.join(tmpDir, "-home-ben-projects-test");
    await fs.mkdir(projectDir);
    const filePath = path.join(projectDir, "session.jsonl");
    const jsonl = [
      JSON.stringify({
        type: "user",
        sessionId: "sess-002",
        message: { content: "Run a command" },
      }),
      JSON.stringify({
        type: "assistant",
        sessionId: "sess-002",
        message: {
          content: [
            { type: "text", text: "Running command." },
            { type: "tool_use", id: "tool1", name: "Bash", input: {} },
          ],
        },
      }),
      JSON.stringify({
        type: "user",
        sessionId: "sess-002",
        message: {
          content: [{ type: "tool_result", tool_use_id: "tool1", content: "output" }],
        },
      }),
      JSON.stringify({
        type: "assistant",
        sessionId: "sess-002",
        message: { content: [{ type: "text", text: "Done." }] },
      }),
    ].join("\n");
    await fs.writeFile(filePath, jsonl);

    const result = await buildClaudeSessionEntry(filePath);

    expect(result).not.toBeNull();
    expect(result!.content).toBe("Run a command\n\nRunning command.\n\nDone.");
  });

  it("returns null if file unreadable", async () => {
    const result = await buildClaudeSessionEntry("/nonexistent/path/file.jsonl");
    expect(result).toBeNull();
  });

  it("returns null if file is empty", async () => {
    const projectDir = path.join(tmpDir, "-home-ben-projects-empty");
    await fs.mkdir(projectDir);
    const filePath = path.join(projectDir, "empty.jsonl");
    await fs.writeFile(filePath, "");

    const result = await buildClaudeSessionEntry(filePath);

    expect(result).toBeNull();
  });

  it("returns null if file contains only whitespace", async () => {
    const projectDir = path.join(tmpDir, "-home-ben-projects-whitespace");
    await fs.mkdir(projectDir);
    const filePath = path.join(projectDir, "whitespace.jsonl");
    await fs.writeFile(filePath, "   \n\n  \n");

    const result = await buildClaudeSessionEntry(filePath);

    expect(result).toBeNull();
  });

  it("returns null if no text content extracted", async () => {
    const projectDir = path.join(tmpDir, "-home-ben-projects-notext");
    await fs.mkdir(projectDir);
    const filePath = path.join(projectDir, "notext.jsonl");
    const jsonl = [
      JSON.stringify({ type: "queue-operation", operation: "dequeue" }),
      JSON.stringify({ type: "summary", content: "session summary" }),
    ].join("\n");
    await fs.writeFile(filePath, jsonl);

    const result = await buildClaudeSessionEntry(filePath);

    expect(result).toBeNull();
  });

  it("uses filename as session ID if no sessionId in JSONL", async () => {
    const projectDir = path.join(tmpDir, "-home-ben-projects-nosession");
    await fs.mkdir(projectDir);
    const filePath = path.join(projectDir, "my-custom-session-name.jsonl");
    const jsonl = JSON.stringify({
      type: "user",
      message: { content: "Hello" },
    });
    await fs.writeFile(filePath, jsonl);

    const result = await buildClaudeSessionEntry(filePath);

    expect(result).not.toBeNull();
    expect(result!.claudeSessionId).toBe("my-custom-session-name");
  });

  it("skips malformed JSONL lines gracefully", async () => {
    const projectDir = path.join(tmpDir, "-home-ben-projects-malformed");
    await fs.mkdir(projectDir);
    const filePath = path.join(projectDir, "malformed.jsonl");
    const jsonl = [
      "not valid json",
      JSON.stringify({
        type: "user",
        sessionId: "good-session",
        message: { content: "Valid message" },
      }),
      "{ broken json }",
      JSON.stringify({
        type: "assistant",
        sessionId: "good-session",
        message: { content: "Valid response" },
      }),
    ].join("\n");
    await fs.writeFile(filePath, jsonl);

    const result = await buildClaudeSessionEntry(filePath);

    expect(result).not.toBeNull();
    expect(result!.content).toBe("Valid message\n\nValid response");
    expect(result!.claudeSessionId).toBe("good-session");
  });

  it("generates consistent hash for same content", async () => {
    const projectDir = path.join(tmpDir, "-home-ben-projects-hash");
    await fs.mkdir(projectDir);
    const file1 = path.join(projectDir, "session1.jsonl");
    const file2 = path.join(projectDir, "session2.jsonl");
    const jsonl = JSON.stringify({
      type: "user",
      sessionId: "same-content",
      message: { content: "Same content" },
    });
    await fs.writeFile(file1, jsonl);
    await fs.writeFile(file2, jsonl);

    const result1 = await buildClaudeSessionEntry(file1);
    const result2 = await buildClaudeSessionEntry(file2);

    expect(result1).not.toBeNull();
    expect(result2).not.toBeNull();
    expect(result1!.hash).toBe(result2!.hash);
  });
});
