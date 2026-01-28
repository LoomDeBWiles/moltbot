import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { listChunks, searchKeyword, searchVector } from "./manager-search.js";
import { ensureMemoryIndexSchema } from "./memory-schema.js";
import { requireNodeSqlite } from "./sqlite.js";

describe("manager-search", () => {
  let dbPath: string;
  let db: DatabaseSync;

  beforeEach(async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "clawdbot-search-"));
    dbPath = path.join(tmpDir, "test.sqlite");
    const { DatabaseSync } = requireNodeSqlite();
    db = new DatabaseSync(dbPath);
    ensureMemoryIndexSchema({
      db,
      embeddingCacheTable: "embedding_cache",
      ftsTable: "chunks_fts",
      ftsEnabled: true,
    });

    // Insert test chunks with project values
    const insert = db.prepare(`
      INSERT INTO chunks (id, path, source, project, start_line, end_line, hash, model, text, embedding, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insert.run(
      "chunk-a1",
      "file-a.md",
      "memory",
      "project-a",
      1,
      10,
      "hash1",
      "mock-model",
      "Alpha content for project A",
      "[1,0]",
      Date.now(),
    );
    insert.run(
      "chunk-b1",
      "file-b.md",
      "memory",
      "project-b",
      1,
      10,
      "hash2",
      "mock-model",
      "Alpha content for project B",
      "[1,0]",
      Date.now(),
    );
    insert.run(
      "chunk-c1",
      "file-c.md",
      "memory",
      null,
      1,
      10,
      "hash3",
      "mock-model",
      "Alpha content with no project",
      "[1,0]",
      Date.now(),
    );
  });

  afterEach(async () => {
    db.close();
    const tmpDir = path.dirname(dbPath);
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe("project filter", () => {
    it("listChunks returns all chunks when no project filter", () => {
      const results = listChunks({
        db,
        providerModel: "mock-model",
        sourceFilter: { sql: "", params: [] },
      });
      expect(results.length).toBe(3);
    });

    it("listChunks returns only matching project chunks", () => {
      const results = listChunks({
        db,
        providerModel: "mock-model",
        sourceFilter: { sql: "", params: [] },
        projectFilter: {
          sql: " AND (project = ? OR ? IS NULL)",
          params: ["project-a", "project-a"],
        },
      });
      expect(results.length).toBe(1);
      expect(results[0]?.path).toBe("file-a.md");
    });

    it("searchVector returns all chunks when no project filter", async () => {
      const results = await searchVector({
        db,
        vectorTable: "chunks_vec",
        providerModel: "mock-model",
        queryVec: [1, 0],
        limit: 10,
        snippetMaxChars: 500,
        ensureVectorReady: async () => false, // Fall back to in-memory search
        sourceFilterVec: { sql: "", params: [] },
        sourceFilterChunks: { sql: "", params: [] },
      });
      expect(results.length).toBe(3);
    });

    it("searchVector returns only matching project chunks when filter provided", async () => {
      const results = await searchVector({
        db,
        vectorTable: "chunks_vec",
        providerModel: "mock-model",
        queryVec: [1, 0],
        limit: 10,
        snippetMaxChars: 500,
        ensureVectorReady: async () => false,
        sourceFilterVec: { sql: "", params: [] },
        sourceFilterChunks: { sql: "", params: [] },
        project: "project-a",
      });
      expect(results.length).toBe(1);
      expect(results[0]?.path).toBe("file-a.md");
    });

    it("searchVector returns empty when project has no content", async () => {
      const results = await searchVector({
        db,
        vectorTable: "chunks_vec",
        providerModel: "mock-model",
        queryVec: [1, 0],
        limit: 10,
        snippetMaxChars: 500,
        ensureVectorReady: async () => false,
        sourceFilterVec: { sql: "", params: [] },
        sourceFilterChunks: { sql: "", params: [] },
        project: "non-existent-project",
      });
      expect(results).toEqual([]);
    });

    it("searchKeyword returns only matching project chunks when filter provided", async () => {
      // First insert FTS entries
      const insertFts = db.prepare(`
        INSERT INTO chunks_fts (text, id, path, source, model, start_line, end_line)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      insertFts.run(
        "Alpha content for project A",
        "chunk-a1",
        "file-a.md",
        "memory",
        "mock-model",
        1,
        10,
      );
      insertFts.run(
        "Alpha content for project B",
        "chunk-b1",
        "file-b.md",
        "memory",
        "mock-model",
        1,
        10,
      );
      insertFts.run(
        "Alpha content with no project",
        "chunk-c1",
        "file-c.md",
        "memory",
        "mock-model",
        1,
        10,
      );

      const results = await searchKeyword({
        db,
        ftsTable: "chunks_fts",
        providerModel: "mock-model",
        query: "Alpha",
        limit: 10,
        snippetMaxChars: 500,
        sourceFilter: { sql: "", params: [] },
        buildFtsQuery: (raw) => raw,
        bm25RankToScore: (rank) => 1 - Math.abs(rank) / 100,
        project: "project-a",
      });
      expect(results.length).toBe(1);
      expect(results[0]?.path).toBe("file-a.md");
    });

    it("searchKeyword returns all chunks when no project filter", async () => {
      const insertFts = db.prepare(`
        INSERT INTO chunks_fts (text, id, path, source, model, start_line, end_line)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      insertFts.run(
        "Alpha content for project A",
        "chunk-a1",
        "file-a.md",
        "memory",
        "mock-model",
        1,
        10,
      );
      insertFts.run(
        "Alpha content for project B",
        "chunk-b1",
        "file-b.md",
        "memory",
        "mock-model",
        1,
        10,
      );
      insertFts.run(
        "Alpha content with no project",
        "chunk-c1",
        "file-c.md",
        "memory",
        "mock-model",
        1,
        10,
      );

      const results = await searchKeyword({
        db,
        ftsTable: "chunks_fts",
        providerModel: "mock-model",
        query: "Alpha",
        limit: 10,
        snippetMaxChars: 500,
        sourceFilter: { sql: "", params: [] },
        buildFtsQuery: (raw) => raw,
        bm25RankToScore: (rank) => 1 - Math.abs(rank) / 100,
      });
      expect(results.length).toBe(3);
    });
  });
});
