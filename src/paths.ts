import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Maximum length for path component before hash suffix is added. */
export const MAX_SANITIZED_LENGTH = 200;

export function getClaudeDir(claudeDir?: string): string {
  return claudeDir ?? join(homedir(), '.claude');
}

/**
 * Convert an absolute project path to the hash CC uses for directory names.
 * Matches the CLI's sanitization: replace all non-alphanumeric chars with dashes,
 * and truncate long paths with a hash suffix.
 */
export function projectPathToHash(projectPath: string): string {
  const sanitized = projectPath.replace(/[^a-zA-Z0-9]/g, '-');
  if (sanitized.length <= MAX_SANITIZED_LENGTH) return sanitized;
  // djb2 hash algorithm (matches Claude Code's Node.js implementation)
  let h = 0;
  for (let i = 0; i < projectPath.length; i++)
    h = ((h << 5) - h + projectPath.charCodeAt(i)) | 0;
  return `${sanitized.slice(0, MAX_SANITIZED_LENGTH)}-${Math.abs(h).toString(36)}`;
}

/** Get the project-specific directory under ~/.claude/projects/ */
export function getProjectDir(projectPath: string, claudeDir?: string): string {
  return join(getClaudeDir(claudeDir), 'projects', projectPathToHash(projectPath));
}

/** Get the JSONL file path for a session. */
export function getSessionPath(sessionId: string, projectPath: string, claudeDir?: string): string {
  return join(getProjectDir(projectPath, claudeDir), `${sessionId}.jsonl`);
}

/** Get the projects directory under ~/.claude/ */
export function getProjectsDir(claudeDir?: string): string {
  return join(getClaudeDir(claudeDir), 'projects');
}

/**
 * Find the project directory, with fallback for Bun/Node hash mismatches on long paths.
 *
 * **Important:** Claude Code under Bun uses `Bun.hash()` (wyhash) for paths >200 characters,
 * while Node.js uses `djb2Hash()`. This produces different directory names for the same
 * project path. This function handles that by trying the exact match first, then
 * falling back to prefix scanning for long paths.
 *
 * For paths ≤200 characters, both runtimes produce identical results (no hash involved).
 *
 * @param projectPath - The absolute project path
 * @param claudeDir - Optional override for the Claude config directory
 * @returns The actual project directory path, or undefined if not found
 */
export async function findProjectDir(projectPath: string, claudeDir?: string): Promise<string | undefined> {
  const exact = getProjectDir(projectPath, claudeDir);
  try {
    // Check if exact match exists (lightweight stat vs readdir)
    await stat(exact);
    return exact;
  } catch {
    // Exact match failed — for short paths this means no sessions exist.
    // For long paths, try prefix matching to handle hash mismatches.
    const rawSanitized = projectPath.replace(/[^a-zA-Z0-9]/g, '-');
    if (rawSanitized.length <= MAX_SANITIZED_LENGTH) {
      return undefined; // Short path: no hash involved, exact match is required
    }
    const prefix = rawSanitized.slice(0, MAX_SANITIZED_LENGTH);
    const projectsDir = getProjectsDir(claudeDir);
    try {
      const entries = await readdir(projectsDir, { withFileTypes: true });
      const match = entries.find(
        (d) => d.isDirectory() && d.name.startsWith(prefix + '-'),
      );
      return match ? join(projectsDir, match.name) : undefined;
    } catch {
      return undefined;
    }
  }
}

/**
 * Resolve a session file path, with fallback for Bun/Node hash mismatches.
 *
 * This async version uses `findProjectDir()` to handle the case where a session
 * was created by Claude Code running under Bun (which uses wyhash for long paths),
 * but we're trying to read it from Node.js (which uses djb2Hash).
 *
 * @param sessionId - The session UUID
 * @param projectPath - The absolute project path
 * @param claudeDir - Optional override for the Claude config directory
 * @returns The actual session file path, or undefined if not found
 */
export async function resolveSessionPath(
  sessionId: string,
  projectPath: string,
  claudeDir?: string,
): Promise<string | undefined> {
  const projectDir = await findProjectDir(projectPath, claudeDir);
  if (!projectDir) return undefined;
  const filePath = join(projectDir, `${sessionId}.jsonl`);
  // Verify file exists
  try {
    await stat(filePath);
    return filePath;
  } catch {
    return undefined;
  }
}
