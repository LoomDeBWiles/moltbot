import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

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

vi.mock("./embeddings.js", () => {
  const embedText = (text: string) => {
    const lower = text.toLowerCase();
    const alpha = lower.split("alpha").length - 1;
    const beta = lower.split("beta").length - 1;
    return [alpha, beta];
  };
  return {
    createEmbeddingProvider: async (options: { model?: string }) => ({
      requestedProvider: "openai",
      provider: {
        id: "mock",
        model: options.model ?? "mock-embed",
        embedQuery: async (text: string) => embedText(text),
        embedBatch: async (texts: string[]) => texts.map(embedText),
      },
    }),
  };
});

const testOrSkip = nodeSqliteAvailable ? it : it.skip;

describe("memory schema", () => {
  let workspaceDir: string;
  let indexPath: string;
  let manager: MemoryIndexManager | null = null;

  beforeEach(async () => {
    if (!nodeSqliteAvailable) return;
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "moltbot-schema-"));
    indexPath = path.join(workspaceDir, "index.sqlite");
    await fs.mkdir(path.join(workspaceDir, "memory"));
    await fs.writeFile(path.join(workspaceDir, "memory", "test.md"), "# Test\nAlpha memory line.");
  });

  afterEach(async () => {
    if (!nodeSqliteAvailable) return;
    if (manager) {
      await manager.close();
      manager = null;
    }
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  describe("project column", () => {
    testOrSkip("syncs and searches successfully with project column in schema", async () => {
      const cfg = {
        agents: {
          defaults: {
            workspace: workspaceDir,
            memorySearch: {
              provider: "openai",
              model: "mock-embed",
              store: { path: indexPath, vector: { enabled: false } },
              sync: { watch: false, onSessionStart: false, onSearch: false },
              query: { minScore: 0 },
            },
          },
          list: [{ id: "main", default: true }],
        },
      };
      const result = await getMemorySearchManager({ cfg, agentId: "main" });
      expect(result.manager).not.toBeNull();
      if (!result.manager) throw new Error("manager missing");
      manager = result.manager;

      // Sync should succeed with the new schema (includes project column)
      await manager.sync({ force: true });

      // Search should work
      const results = await manager.search("alpha");
      expect(results.length).toBeGreaterThan(0);

      // Status should report correctly
      const status = manager.status();
      expect(status.files).toBeGreaterThan(0);
      expect(status.chunks).toBeGreaterThan(0);
    });

    testOrSkip("allows reindexing with new schema after existing data", async () => {
      const cfg = {
        agents: {
          defaults: {
            workspace: workspaceDir,
            memorySearch: {
              provider: "openai",
              model: "mock-embed",
              store: { path: indexPath, vector: { enabled: false } },
              sync: { watch: false, onSessionStart: false, onSearch: false },
              query: { minScore: 0 },
            },
          },
          list: [{ id: "main", default: true }],
        },
      };
      const result = await getMemorySearchManager({ cfg, agentId: "main" });
      expect(result.manager).not.toBeNull();
      if (!result.manager) throw new Error("manager missing");
      manager = result.manager;

      // First sync
      await manager.sync({ force: true });
      const beforeStatus = manager.status();

      // Second forced sync (reindex) should work with project column
      await manager.sync({ force: true });
      const afterStatus = manager.status();

      expect(afterStatus.files).toBe(beforeStatus.files);
      expect(afterStatus.chunks).toBe(beforeStatus.chunks);
    });
  });
});
