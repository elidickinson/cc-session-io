import { homedir } from 'node:os';
import { join } from 'node:path';

export function getClaudeDir(claudeDir?: string): string {
  return claudeDir ?? join(homedir(), '.claude');
}

/**
 * Convert an absolute project path to the hash CC uses for directory names.
 * Matches the CLI's sanitization: replace all non-alphanumeric chars with dashes,
 * and truncate long paths with a hash suffix.
 */
export function projectPathToHash(projectPath: string): string {
  const MAX_LENGTH = 200;
  const sanitized = projectPath.replace(/[^a-zA-Z0-9]/g, '-');
  if (sanitized.length <= MAX_LENGTH) return sanitized;
  // Simple hash matching the CLI's Java-style hashCode (djb2 variant)
  let h = 0;
  for (let i = 0; i < projectPath.length; i++)
    h = ((h << 5) - h + projectPath.charCodeAt(i)) | 0;
  return `${sanitized.slice(0, MAX_LENGTH)}-${Math.abs(h).toString(36)}`;
}

/** Get the project-specific directory under ~/.claude/projects/ */
export function getProjectDir(projectPath: string, claudeDir?: string): string {
  return join(getClaudeDir(claudeDir), 'projects', projectPathToHash(projectPath));
}

/** Get the JSONL file path for a session. */
export function getSessionPath(sessionId: string, projectPath: string, claudeDir?: string): string {
  return join(getProjectDir(projectPath, claudeDir), `${sessionId}.jsonl`);
}
