import { describe, test, expect } from 'vitest';
import { projectPathToHash, getProjectDir, getSessionPath } from '../src/paths.js';

describe('projectPathToHash', () => {
  test('replaces slashes with dashes', () => {
    expect(projectPathToHash('/Users/esd/projects/cc-session'))
      .toBe('-Users-esd-projects-cc-session');
  });

  test('handles root path', () => {
    expect(projectPathToHash('/')).toBe('-');
  });
});

describe('getProjectDir', () => {
  test('builds correct project directory', () => {
    const dir = getProjectDir('/Users/me/project', '/tmp/claude');
    expect(dir).toBe('/tmp/claude/projects/-Users-me-project');
  });
});

describe('getSessionPath', () => {
  test('builds correct JSONL path', () => {
    const path = getSessionPath('abc-123', '/Users/me/project', '/tmp/claude');
    expect(path).toBe('/tmp/claude/projects/-Users-me-project/abc-123.jsonl');
  });
});
