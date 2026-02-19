import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import type { DatabaseSync } from "node:sqlite";

import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("memory");

export interface ScribeFileEntry {
  path: string;
  content: string;
  hash: string;
  project: string;
}

type ProgressState = {
  completed: number;
  total: number;
  label?: string;
  report: (update: { completed: number; total: number; label?: string }) => void;
};

// Discover repos by checking ~/projects/<name>/context/INDEX.md
async function discoverScribeRepos(): Promise<Array<{ contextDir: string; project: string }>> {
  const projectsDir = path.join(os.homedir(), "projects");
  let entries: Dirent[];
  try {
    entries = await fs.readdir(projectsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const repos: Array<{ contextDir: string; project: string }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const contextDir = path.join(projectsDir, entry.name, "context");
    const indexPath = path.join(contextDir, "INDEX.md");
    try {
      await fs.access(indexPath);
      repos.push({ contextDir, project: entry.name });
    } catch {
      // No INDEX.md — skip silently
    }
  }
  return repos;
}

// Recursively list all .md files under a directory
async function listMarkdownFiles(dir: string): Promise<string[]> {
  const result: string[] = [];
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return result;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await listMarkdownFiles(full);
      result.push(...nested);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      result.push(full);
    }
  }
  return result;
}

// Build a ScribeFileEntry from a markdown file in a context/ tree
async function buildScribeFileEntry(
  absPath: string,
  project: string,
): Promise<ScribeFileEntry | null> {
  let content: string;
  try {
    content = await fs.readFile(absPath, "utf-8");
  } catch {
    return null;
  }
  if (!content.trim()) return null;
  const hash = createHash("sha256").update(content).digest("hex");
  return { path: absPath, content, hash, project };
}

// Discover and index context/ tree files across ~/projects/ repos.
// Scans for INDEX.md to find scribe sources, then indexes all context/*.md
// files with source="scribe".
export async function syncScribeFiles(params: {
  db: DatabaseSync;
  needsFullReindex: boolean;
  progress?: ProgressState;
  batchEnabled: boolean;
  concurrency: number;
  runWithConcurrency: <T>(tasks: Array<() => Promise<T>>, concurrency: number) => Promise<T[]>;
  indexFile: (entry: ScribeFileEntry) => Promise<void>;
  vectorTable: string;
  ftsTable: string;
  ftsEnabled: boolean;
  ftsAvailable: boolean;
  model: string;
}) {
  const repos = await discoverScribeRepos();
  const allFiles: Array<{ absPath: string; project: string }> = [];
  for (const repo of repos) {
    const files = await listMarkdownFiles(repo.contextDir);
    for (const file of files) {
      allFiles.push({ absPath: file, project: repo.project });
    }
  }

  const activePaths = new Set(allFiles.map((f) => f.absPath));

  log.debug("memory sync: indexing scribe files", {
    repos: repos.length,
    files: allFiles.length,
    batch: params.batchEnabled,
    concurrency: params.concurrency,
  });

  if (params.progress) {
    params.progress.total += allFiles.length;
    params.progress.report({
      completed: params.progress.completed,
      total: params.progress.total,
      label: params.batchEnabled ? "Indexing scribe files (batch)..." : "Indexing scribe files…",
    });
  }

  const tasks = allFiles.map((file) => async () => {
    const entry = await buildScribeFileEntry(file.absPath, file.project);
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

    const record = params.db
      .prepare(`SELECT hash FROM files WHERE path = ? AND source = ?`)
      .get(entry.path, "scribe") as { hash: string } | undefined;
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
    .all("scribe") as Array<{ path: string }>;
  for (const stale of staleRows) {
    if (activePaths.has(stale.path)) continue;
    params.db.prepare(`DELETE FROM files WHERE path = ? AND source = ?`).run(stale.path, "scribe");
    try {
      params.db
        .prepare(
          `DELETE FROM ${params.vectorTable} WHERE id IN (SELECT id FROM chunks WHERE path = ? AND source = ?)`,
        )
        .run(stale.path, "scribe");
    } catch {}
    params.db.prepare(`DELETE FROM chunks WHERE path = ? AND source = ?`).run(stale.path, "scribe");
    if (params.ftsEnabled && params.ftsAvailable) {
      try {
        params.db
          .prepare(`DELETE FROM ${params.ftsTable} WHERE path = ? AND source = ? AND model = ?`)
          .run(stale.path, "scribe", params.model);
      } catch {}
    }
  }
}
