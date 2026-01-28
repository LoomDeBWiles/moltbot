import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

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
