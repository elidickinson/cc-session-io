import { homedir } from 'node:os';
import { join } from 'node:path';

export function getClaudeDir(claudeDir?: string): string {
  return claudeDir ?? join(homedir(), '.claude');
}

/** Convert an absolute project path to the hash CC uses for directory names. */
export function projectPathToHash(projectPath: string): string {
  return projectPath.replaceAll('/', '-');
}

/** Get the project-specific directory under ~/.claude/projects/ */
export function getProjectDir(projectPath: string, claudeDir?: string): string {
  return join(getClaudeDir(claudeDir), 'projects', projectPathToHash(projectPath));
}

/** Get the JSONL file path for a session. */
export function getSessionPath(sessionId: string, projectPath: string, claudeDir?: string): string {
  return join(getProjectDir(projectPath, claudeDir), `${sessionId}.jsonl`);
}
