import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listClaudeSessionFiles, extractProjectSlug } from "./claude-session-files.js";

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
