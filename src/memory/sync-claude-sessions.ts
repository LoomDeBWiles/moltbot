import type { DatabaseSync } from "node:sqlite";

import { createSubsystemLogger } from "../logging/subsystem.js";
import type { ClaudeSessionEntry } from "./claude-session-files.js";
import { buildClaudeSessionEntry, listClaudeSessionFiles } from "./claude-session-files.js";

const log = createSubsystemLogger("memory");

type ProgressState = {
  completed: number;
  total: number;
  label?: string;
  report: (update: { completed: number; total: number; label?: string }) => void;
};

export async function syncClaudeSessionFiles(params: {
  db: DatabaseSync;
  excludeSessionIds: Set<string>;
  needsFullReindex: boolean;
  progress?: ProgressState;
  batchEnabled: boolean;
  concurrency: number;
  runWithConcurrency: <T>(tasks: Array<() => Promise<T>>, concurrency: number) => Promise<T[]>;
  indexFile: (entry: ClaudeSessionEntry) => Promise<void>;
  vectorTable: string;
  ftsTable: string;
  ftsEnabled: boolean;
  ftsAvailable: boolean;
  model: string;
}) {
  const files = await listClaudeSessionFiles();
  const activePaths = new Set(files);
  const indexAll = params.needsFullReindex;

  log.debug("memory sync: indexing claude session files", {
    files: files.length,
    indexAll,
    excludeCount: params.excludeSessionIds.size,
    batch: params.batchEnabled,
    concurrency: params.concurrency,
  });

  if (params.progress) {
    params.progress.total += files.length;
    params.progress.report({
      completed: params.progress.completed,
      total: params.progress.total,
      label: params.batchEnabled
        ? "Indexing Claude sessions (batch)..."
        : "Indexing Claude sessions…",
    });
  }

  const tasks = files.map((absPath) => async () => {
    const entry = await buildClaudeSessionEntry(absPath);
    if (!entry) {
      if (params.progress) {
        params.progress.completed += 1;
        params.progress.report({
          completed: params.progress.completed,
          total: params.progress.total,
        });
      }
      return;
    }

    // Skip sessions that originated from moltbot
    if (params.excludeSessionIds.has(entry.claudeSessionId)) {
      if (params.progress) {
        params.progress.completed += 1;
        params.progress.report({
          completed: params.progress.completed,
          total: params.progress.total,
        });
      }
      return;
    }

    const record = params.db
      .prepare(`SELECT hash FROM files WHERE path = ? AND source = ?`)
      .get(entry.path, "claude-sessions") as { hash: string } | undefined;
    if (!params.needsFullReindex && record?.hash === entry.hash) {
      if (params.progress) {
        params.progress.completed += 1;
        params.progress.report({
          completed: params.progress.completed,
          total: params.progress.total,
        });
      }
      return;
    }

    await params.indexFile(entry);
    if (params.progress) {
      params.progress.completed += 1;
      params.progress.report({
        completed: params.progress.completed,
        total: params.progress.total,
      });
    }
  });

  await params.runWithConcurrency(tasks, params.concurrency);

  // Clean up stale records for files that no longer exist
  const staleRows = params.db
    .prepare(`SELECT path FROM files WHERE source = ?`)
    .all("claude-sessions") as Array<{ path: string }>;
  for (const stale of staleRows) {
    if (activePaths.has(stale.path)) continue;
    params.db
      .prepare(`DELETE FROM files WHERE path = ? AND source = ?`)
      .run(stale.path, "claude-sessions");
    try {
      params.db
        .prepare(
          `DELETE FROM ${params.vectorTable} WHERE id IN (SELECT id FROM chunks WHERE path = ? AND source = ?)`,
        )
        .run(stale.path, "claude-sessions");
    } catch {}
    params.db
      .prepare(`DELETE FROM chunks WHERE path = ? AND source = ?`)
      .run(stale.path, "claude-sessions");
    if (params.ftsEnabled && params.ftsAvailable) {
      try {
        params.db
          .prepare(`DELETE FROM ${params.ftsTable} WHERE path = ? AND source = ? AND model = ?`)
          .run(stale.path, "claude-sessions", params.model);
      } catch {}
    }
  }
}
