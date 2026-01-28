import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getMemorySearchManager, type MemoryIndexManager } from "./index.js";

// Check if node:sqlite is available (Node 22+)
let nodeSqliteAvailable = false;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("node:sqlite");
  nodeSqliteAvailable = true;
} catch {
  nodeSqliteAvailable = false;
}

const testOrSkip = nodeSqliteAvailable ? it : it.skip;

vi.mock("chokidar", () => ({
  default: {
    watch: vi.fn(() => ({
      on: vi.fn(),
      close: vi.fn(async () => undefined),
    })),
  },
}));

const embedBatch = vi.fn(async (texts: string[]) => texts.map((_text, index) => [index + 1, 0, 0]));
const embedQuery = vi.fn(async () => [0.5, 0.5, 0.5]);

vi.mock("./embeddings.js", () => ({
  createEmbeddingProvider: async () => ({
    requestedProvider: "openai",
    provider: {
      id: "openai",
      model: "text-embedding-3-small",
      embedQuery,
      embedBatch,
    },
  }),
}));

// Mock the claude-session-files module
vi.mock("./claude-session-files.js", () => ({
  listClaudeSessionFiles: vi.fn(async () => []),
  loadMoltbotClaudeSessionIds: vi.fn(async () => new Set<string>()),
  buildClaudeSessionEntry: vi.fn(async () => null),
  extractProjectSlug: (sessionPath: string) => {
    const dirName = sessionPath.split("/").slice(-2, -1)[0] ?? "";
    const match = dirName.match(/projects-(.+)$/);
    return match?.[1] ?? dirName;
  },
  extractClaudeSessionText: () => "",
}));

import {
  listClaudeSessionFiles,
  loadMoltbotClaudeSessionIds,
  buildClaudeSessionEntry,
} from "./claude-session-files.js";

const mockListFiles = vi.mocked(listClaudeSessionFiles);
const mockLoadSessionIds = vi.mocked(loadMoltbotClaudeSessionIds);
const mockBuildEntry = vi.mocked(buildClaudeSessionEntry);

describe("claude-sessions", () => {
  let workspaceDir: string;
  let indexPath: string;
  let manager: MemoryIndexManager | null = null;

  beforeEach(async () => {
    if (!nodeSqliteAvailable) return;
    embedBatch.mockClear();
    embedQuery.mockClear();
    mockListFiles.mockClear();
    mockLoadSessionIds.mockClear();
    mockBuildEntry.mockClear();
    embedBatch.mockImplementation(async (texts: string[]) =>
      texts.map((_text, index) => [index + 1, 0, 0]),
    );
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "clawdbot-claude-sessions-"));
    indexPath = path.join(workspaceDir, "index.sqlite");
  });

  afterEach(async () => {
    if (!nodeSqliteAvailable) return;
    if (manager) {
      await manager.close();
      manager = null;
    }
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  testOrSkip("syncs claude-sessions when sources includes claude-sessions", async () => {
    mockListFiles.mockResolvedValue([
      "/home/ben/.claude/projects/-home-ben-projects-mine/session1.jsonl",
    ]);
    mockLoadSessionIds.mockResolvedValue(new Set());
    mockBuildEntry.mockResolvedValue({
      path: "/home/ben/.claude/projects/-home-ben-projects-mine/session1.jsonl",
      content: "User: Hello\n\nAssistant: Hi there!",
      hash: "abc123",
      project: "mine",
      claudeSessionId: "session1",
    });

    const cfg = {
      agents: {
        defaults: {
          workspace: workspaceDir,
          memorySearch: {
            sources: ["claude-sessions"],
            provider: "openai",
            model: "text-embedding-3-small",
            store: { path: indexPath, vector: { enabled: false } },
            sync: { watch: false, onSessionStart: false, onSearch: false },
          },
        },
        list: [{ id: "main", default: true }],
      },
    };

    const result = await getMemorySearchManager({ cfg, agentId: "main" });
    if (result.error) console.error("Manager error:", result.error);
    expect(result.manager).not.toBeNull();
    if (!result.manager) throw new Error(`manager missing: ${result.error}`);
    manager = result.manager;

    await manager.sync({ force: true });

    const status = manager.status();
    expect(status.sources).toContain("claude-sessions");
    expect(mockListFiles).toHaveBeenCalled();
    expect(mockBuildEntry).toHaveBeenCalled();
    // Should have indexed the session
    const sourceCounts = status.sourceCounts.find((sc) => sc.source === "claude-sessions");
    expect(sourceCounts?.files).toBe(1);
  });

  testOrSkip("excludes sessions from moltbot using loadMoltbotClaudeSessionIds", async () => {
    mockListFiles.mockResolvedValue([
      "/home/ben/.claude/projects/-home-ben-projects-mine/session1.jsonl",
      "/home/ben/.claude/projects/-home-ben-projects-mine/session2.jsonl",
    ]);
    // session1 originated from moltbot, should be excluded
    mockLoadSessionIds.mockResolvedValue(new Set(["session1"]));
    mockBuildEntry.mockImplementation(async (absPath: string) => ({
      path: absPath,
      content: "User: Hello\n\nAssistant: Hi there!",
      hash: absPath.includes("session1") ? "hash1" : "hash2",
      project: "mine",
      claudeSessionId: absPath.includes("session1") ? "session1" : "session2",
    }));

    const cfg = {
      agents: {
        defaults: {
          workspace: workspaceDir,
          memorySearch: {
            sources: ["claude-sessions"],
            provider: "openai",
            model: "text-embedding-3-small",
            store: { path: indexPath, vector: { enabled: false } },
            sync: { watch: false, onSessionStart: false, onSearch: false },
          },
        },
        list: [{ id: "main", default: true }],
      },
    };

    const result = await getMemorySearchManager({ cfg, agentId: "main" });
    expect(result.manager).not.toBeNull();
    if (!result.manager) throw new Error("manager missing");
    manager = result.manager;

    await manager.sync({ force: true });

    const status = manager.status();
    const sourceCounts = status.sourceCounts.find((sc) => sc.source === "claude-sessions");
    // Only session2 should be indexed (session1 excluded)
    expect(sourceCounts?.files).toBe(1);
    expect(mockLoadSessionIds).toHaveBeenCalledWith("main");
  });

  testOrSkip("does not sync claude-sessions when source not in config", async () => {
    mockListFiles.mockResolvedValue([
      "/home/ben/.claude/projects/-home-ben-projects-mine/session1.jsonl",
    ]);
    mockBuildEntry.mockResolvedValue({
      path: "/home/ben/.claude/projects/-home-ben-projects-mine/session1.jsonl",
      content: "User: Hello",
      hash: "abc123",
      project: "mine",
      claudeSessionId: "session1",
    });

    const cfg = {
      agents: {
        defaults: {
          workspace: workspaceDir,
          memorySearch: {
            sources: ["memory"], // No claude-sessions
            provider: "openai",
            model: "text-embedding-3-small",
            store: { path: indexPath, vector: { enabled: false } },
            sync: { watch: false, onSessionStart: false, onSearch: false },
          },
        },
        list: [{ id: "main", default: true }],
      },
    };

    // Create memory directory so memory source works
    await fs.mkdir(path.join(workspaceDir, "memory"));

    const result = await getMemorySearchManager({ cfg, agentId: "main" });
    expect(result.manager).not.toBeNull();
    if (!result.manager) throw new Error("manager missing");
    manager = result.manager;

    await manager.sync({ force: true });

    const status = manager.status();
    expect(status.sources).not.toContain("claude-sessions");
    // listClaudeSessionFiles should not be called since source is not enabled
    expect(mockListFiles).not.toHaveBeenCalled();
  });

  testOrSkip("indexes claude sessions with correct project metadata", async () => {
    mockListFiles.mockResolvedValue([
      "/home/ben/.claude/projects/-home-ben-projects-patent-search/session1.jsonl",
    ]);
    mockLoadSessionIds.mockResolvedValue(new Set());
    mockBuildEntry.mockResolvedValue({
      path: "/home/ben/.claude/projects/-home-ben-projects-patent-search/session1.jsonl",
      content: "User: Search patents\n\nAssistant: Found results",
      hash: "xyz789",
      project: "patent-search",
      claudeSessionId: "session1",
    });

    const cfg = {
      agents: {
        defaults: {
          workspace: workspaceDir,
          memorySearch: {
            sources: ["claude-sessions"],
            provider: "openai",
            model: "text-embedding-3-small",
            store: { path: indexPath, vector: { enabled: false } },
            sync: { watch: false, onSessionStart: false, onSearch: false },
          },
        },
        list: [{ id: "main", default: true }],
      },
    };

    const result = await getMemorySearchManager({ cfg, agentId: "main" });
    expect(result.manager).not.toBeNull();
    if (!result.manager) throw new Error("manager missing");
    manager = result.manager;

    await manager.sync({ force: true });

    expect(embedBatch).toHaveBeenCalled();
    const status = manager.status();
    const sourceCounts = status.sourceCounts.find((sc) => sc.source === "claude-sessions");
    expect(sourceCounts?.files).toBe(1);
    expect(sourceCounts?.chunks).toBeGreaterThan(0);
  });

  testOrSkip("failure in claude-sessions sync does not block other sources", async () => {
    // Set up memory files
    await fs.mkdir(path.join(workspaceDir, "memory"));
    await fs.writeFile(path.join(workspaceDir, "memory", "test.md"), "Memory content");

    // Make claude-sessions fail
    mockListFiles.mockRejectedValue(new Error("Failed to read projects dir"));

    const cfg = {
      agents: {
        defaults: {
          workspace: workspaceDir,
          memorySearch: {
            sources: ["memory", "claude-sessions"],
            provider: "openai",
            model: "text-embedding-3-small",
            store: { path: indexPath, vector: { enabled: false } },
            sync: { watch: false, onSessionStart: false, onSearch: false },
          },
        },
        list: [{ id: "main", default: true }],
      },
    };

    const result = await getMemorySearchManager({ cfg, agentId: "main" });
    expect(result.manager).not.toBeNull();
    if (!result.manager) throw new Error("manager missing");
    manager = result.manager;

    // Sync should not throw even if claude-sessions fails
    // The error is caught internally in syncClaudeSessionFiles
    await manager.sync({ force: true });

    const status = manager.status();
    // Memory source should still be indexed
    const memoryCounts = status.sourceCounts.find((sc) => sc.source === "memory");
    expect(memoryCounts?.files).toBe(1);
  });
});
