import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { syncClaudeSessionFiles } from "./sync-claude-sessions.js";
import type { ClaudeSessionEntry } from "./claude-session-files.js";

// Mock the claude-session-files module
vi.mock("./claude-session-files.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./claude-session-files.js")>();
  return {
    ...actual,
    listClaudeSessionFiles: vi.fn(),
    buildClaudeSessionEntry: vi.fn(),
  };
});

import { listClaudeSessionFiles, buildClaudeSessionEntry } from "./claude-session-files.js";
const mockListFiles = vi.mocked(listClaudeSessionFiles);
const mockBuildEntry = vi.mocked(buildClaudeSessionEntry);

describe("syncClaudeSessionFiles", () => {
  let db: {
    prepare: ReturnType<typeof vi.fn>;
  };
  let indexedEntries: ClaudeSessionEntry[];
  let deletedPaths: string[];

  beforeEach(() => {
    indexedEntries = [];
    deletedPaths = [];
    vi.clearAllMocks();

    // Mock database
    const mockPrepare = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes("SELECT hash FROM files")) {
        return {
          get: vi.fn().mockReturnValue(undefined), // No existing records by default
        };
      }
      if (sql.includes("SELECT path FROM files")) {
        return {
          all: vi.fn().mockReturnValue([]), // No stale records by default
        };
      }
      if (sql.includes("DELETE")) {
        return {
          run: vi.fn().mockImplementation((path: string) => {
            deletedPaths.push(path);
          }),
        };
      }
      return { get: vi.fn(), all: vi.fn(), run: vi.fn() };
    });

    db = { prepare: mockPrepare };
  });

  const createParams = (overrides: Partial<Parameters<typeof syncClaudeSessionFiles>[0]> = {}) => ({
    db: db as unknown as Parameters<typeof syncClaudeSessionFiles>[0]["db"],
    excludeSessionIds: new Set<string>(),
    needsFullReindex: true,
    batchEnabled: false,
    concurrency: 1,
    runWithConcurrency: async <T>(tasks: Array<() => Promise<T>>, _concurrency: number) => {
      const results: T[] = [];
      for (const task of tasks) {
        results.push(await task());
      }
      return results;
    },
    indexFile: async (entry: ClaudeSessionEntry) => {
      indexedEntries.push(entry);
    },
    vectorTable: "chunks_vec",
    ftsTable: "chunks_fts",
    ftsEnabled: true,
    ftsAvailable: true,
    model: "text-embedding-3-small",
    ...overrides,
  });

  it("indexes all Claude session files", async () => {
    mockListFiles.mockResolvedValue([
      "/home/ben/.claude/projects/-home-ben-projects-mine/session1.jsonl",
      "/home/ben/.claude/projects/-home-ben-projects-moltbot/session2.jsonl",
    ]);

    mockBuildEntry.mockImplementation(async (absPath: string) => ({
      path: absPath,
      content: "Hello world",
      hash: "abc123",
      project: absPath.includes("mine") ? "mine" : "moltbot",
      claudeSessionId: absPath.includes("session1") ? "session1" : "session2",
    }));

    await syncClaudeSessionFiles(createParams());

    expect(indexedEntries).toHaveLength(2);
    expect(indexedEntries[0].project).toBe("mine");
    expect(indexedEntries[1].project).toBe("moltbot");
  });

  it("skips sessions in excludeSessionIds set", async () => {
    mockListFiles.mockResolvedValue([
      "/home/ben/.claude/projects/-home-ben-projects-mine/session1.jsonl",
      "/home/ben/.claude/projects/-home-ben-projects-moltbot/session2.jsonl",
    ]);

    mockBuildEntry.mockImplementation(async (absPath: string) => ({
      path: absPath,
      content: "Hello world",
      hash: "abc123",
      project: absPath.includes("mine") ? "mine" : "moltbot",
      claudeSessionId: absPath.includes("session1") ? "session1" : "session2",
    }));

    await syncClaudeSessionFiles(
      createParams({
        excludeSessionIds: new Set(["session1"]), // Exclude session1
      }),
    );

    expect(indexedEntries).toHaveLength(1);
    expect(indexedEntries[0].claudeSessionId).toBe("session2");
  });

  it("skips files that buildClaudeSessionEntry returns null for", async () => {
    mockListFiles.mockResolvedValue([
      "/home/ben/.claude/projects/-home-ben-projects-mine/session1.jsonl",
      "/home/ben/.claude/projects/-home-ben-projects-mine/empty.jsonl",
    ]);

    mockBuildEntry.mockImplementation(async (absPath: string) => {
      if (absPath.includes("empty")) return null;
      return {
        path: absPath,
        content: "Hello world",
        hash: "abc123",
        project: "mine",
        claudeSessionId: "session1",
      };
    });

    await syncClaudeSessionFiles(createParams());

    expect(indexedEntries).toHaveLength(1);
  });

  it("skips unchanged files when not doing full reindex", async () => {
    mockListFiles.mockResolvedValue([
      "/home/ben/.claude/projects/-home-ben-projects-mine/session1.jsonl",
    ]);

    mockBuildEntry.mockResolvedValue({
      path: "/home/ben/.claude/projects/-home-ben-projects-mine/session1.jsonl",
      content: "Hello world",
      hash: "existing-hash",
      project: "mine",
      claudeSessionId: "session1",
    });

    // Mock that the file already exists with same hash
    db.prepare = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes("SELECT hash FROM files")) {
        return {
          get: vi.fn().mockReturnValue({ hash: "existing-hash" }),
        };
      }
      if (sql.includes("SELECT path FROM files")) {
        return {
          all: vi.fn().mockReturnValue([]),
        };
      }
      return { get: vi.fn(), all: vi.fn(), run: vi.fn() };
    });

    await syncClaudeSessionFiles(
      createParams({
        needsFullReindex: false,
      }),
    );

    expect(indexedEntries).toHaveLength(0); // Skipped due to matching hash
  });

  it("indexes changed files even when not doing full reindex", async () => {
    mockListFiles.mockResolvedValue([
      "/home/ben/.claude/projects/-home-ben-projects-mine/session1.jsonl",
    ]);

    mockBuildEntry.mockResolvedValue({
      path: "/home/ben/.claude/projects/-home-ben-projects-mine/session1.jsonl",
      content: "Updated content",
      hash: "new-hash",
      project: "mine",
      claudeSessionId: "session1",
    });

    // Mock that the file exists with different hash
    db.prepare = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes("SELECT hash FROM files")) {
        return {
          get: vi.fn().mockReturnValue({ hash: "old-hash" }),
        };
      }
      if (sql.includes("SELECT path FROM files")) {
        return {
          all: vi.fn().mockReturnValue([]),
        };
      }
      return { get: vi.fn(), all: vi.fn(), run: vi.fn() };
    });

    await syncClaudeSessionFiles(
      createParams({
        needsFullReindex: false,
      }),
    );

    expect(indexedEntries).toHaveLength(1);
  });

  it("reports progress during indexing", async () => {
    mockListFiles.mockResolvedValue([
      "/home/ben/.claude/projects/-home-ben-projects-mine/session1.jsonl",
      "/home/ben/.claude/projects/-home-ben-projects-mine/session2.jsonl",
    ]);

    mockBuildEntry.mockImplementation(async (absPath: string) => ({
      path: absPath,
      content: "Hello",
      hash: "abc",
      project: "mine",
      claudeSessionId: path.basename(absPath, ".jsonl"),
    }));

    const progressUpdates: Array<{ completed: number; total: number; label?: string }> = [];
    const progress = {
      completed: 0,
      total: 0,
      label: undefined as string | undefined,
      report: (update: { completed: number; total: number; label?: string }) => {
        progressUpdates.push({ ...update });
      },
    };

    await syncClaudeSessionFiles(
      createParams({
        progress,
      }),
    );

    expect(progressUpdates.length).toBeGreaterThan(0);
    // Initial report with total
    expect(progressUpdates[0].total).toBe(2);
    // Final report should have completed all
    const lastUpdate = progressUpdates[progressUpdates.length - 1];
    expect(lastUpdate.completed).toBe(2);
  });

  it("uses batch label when batch mode enabled", async () => {
    mockListFiles.mockResolvedValue([
      "/home/ben/.claude/projects/-home-ben-projects-mine/session1.jsonl",
    ]);

    mockBuildEntry.mockResolvedValue({
      path: "/home/ben/.claude/projects/-home-ben-projects-mine/session1.jsonl",
      content: "Hello",
      hash: "abc",
      project: "mine",
      claudeSessionId: "session1",
    });

    const progressUpdates: Array<{ completed: number; total: number; label?: string }> = [];
    const progress = {
      completed: 0,
      total: 0,
      label: undefined as string | undefined,
      report: (update: { completed: number; total: number; label?: string }) => {
        progressUpdates.push({ ...update });
      },
    };

    await syncClaudeSessionFiles(
      createParams({
        batchEnabled: true,
        progress,
      }),
    );

    expect(progressUpdates[0].label).toContain("batch");
  });

  it("handles empty file list gracefully", async () => {
    mockListFiles.mockResolvedValue([]);

    await syncClaudeSessionFiles(createParams());

    expect(indexedEntries).toHaveLength(0);
  });

  it("cleans up stale records for files that no longer exist", async () => {
    mockListFiles.mockResolvedValue([
      "/home/ben/.claude/projects/-home-ben-projects-mine/current.jsonl",
    ]);

    mockBuildEntry.mockResolvedValue({
      path: "/home/ben/.claude/projects/-home-ben-projects-mine/current.jsonl",
      content: "Hello",
      hash: "abc",
      project: "mine",
      claudeSessionId: "current",
    });

    const deleteCalls: Array<{ path: string; source: string }> = [];
    db.prepare = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes("SELECT hash FROM files")) {
        return { get: vi.fn().mockReturnValue(undefined) };
      }
      if (sql.includes("SELECT path FROM files WHERE source")) {
        return {
          all: vi
            .fn()
            .mockReturnValue([
              { path: "/home/ben/.claude/projects/-home-ben-projects-mine/deleted.jsonl" },
            ]),
        };
      }
      if (sql.includes("DELETE FROM files")) {
        return {
          run: vi.fn().mockImplementation((p: string, s: string) => {
            deleteCalls.push({ path: p, source: s });
          }),
        };
      }
      return { get: vi.fn(), all: vi.fn(), run: vi.fn() };
    });

    await syncClaudeSessionFiles(createParams());

    // Should have deleted the stale file
    expect(deleteCalls.some((c) => c.path.includes("deleted.jsonl"))).toBe(true);
  });

  it("uses source=claude-sessions for database operations", async () => {
    mockListFiles.mockResolvedValue([
      "/home/ben/.claude/projects/-home-ben-projects-mine/session1.jsonl",
    ]);

    mockBuildEntry.mockResolvedValue({
      path: "/home/ben/.claude/projects/-home-ben-projects-mine/session1.jsonl",
      content: "Hello",
      hash: "abc",
      project: "mine",
      claudeSessionId: "session1",
    });

    const getCalls: Array<{ path: string; source: string }> = [];
    db.prepare = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes("SELECT hash FROM files")) {
        return {
          get: vi.fn().mockImplementation((p: string, s: string) => {
            getCalls.push({ path: p, source: s });
            return undefined;
          }),
        };
      }
      if (sql.includes("SELECT path FROM files")) {
        return { all: vi.fn().mockReturnValue([]) };
      }
      return { get: vi.fn(), all: vi.fn(), run: vi.fn() };
    });

    await syncClaudeSessionFiles(createParams());

    expect(getCalls.length).toBeGreaterThan(0);
    expect(getCalls[0].source).toBe("claude-sessions");
  });

  it("respects concurrency parameter via runWithConcurrency", async () => {
    mockListFiles.mockResolvedValue([
      "/home/ben/.claude/projects/-home-ben-projects-mine/session1.jsonl",
      "/home/ben/.claude/projects/-home-ben-projects-mine/session2.jsonl",
      "/home/ben/.claude/projects/-home-ben-projects-mine/session3.jsonl",
    ]);

    mockBuildEntry.mockImplementation(async (absPath: string) => ({
      path: absPath,
      content: "Hello",
      hash: "abc",
      project: "mine",
      claudeSessionId: path.basename(absPath, ".jsonl"),
    }));

    let runWithConcurrencyCalled = false;
    let receivedConcurrency = 0;

    await syncClaudeSessionFiles(
      createParams({
        concurrency: 4,
        runWithConcurrency: async <T>(tasks: Array<() => Promise<T>>, concurrency: number) => {
          runWithConcurrencyCalled = true;
          receivedConcurrency = concurrency;
          const results: T[] = [];
          for (const task of tasks) {
            results.push(await task());
          }
          return results;
        },
      }),
    );

    expect(runWithConcurrencyCalled).toBe(true);
    expect(receivedConcurrency).toBe(4);
  });
});
