import { describe, test, expect } from 'vitest';
import { projectPathToHash, getProjectDir, getSessionPath } from '../src/paths.js';

describe('projectPathToHash', () => {
  test('replaces slashes with dashes', () => {
    expect(projectPathToHash('/Users/esd/projects/cc-session'))
      .toBe('-Users-esd-projects-cc-session');
  });

  test('replaces dots with dashes', () => {
    expect(projectPathToHash('/Users/esd/projects/foo.bar'))
      .toBe('-Users-esd-projects-foo-bar');
  });

  test('replaces underscores with dashes', () => {
    expect(projectPathToHash('/Users/esd/my_projects/app'))
      .toBe('-Users-esd-my-projects-app');
  });

  test('replaces spaces with dashes', () => {
    expect(projectPathToHash('/Users/esd/my projects/app'))
      .toBe('-Users-esd-my-projects-app');
  });

  test('replaces tildes with dashes', () => {
    expect(projectPathToHash('/Users/esd/projects/foo~bar'))
      .toBe('-Users-esd-projects-foo-bar');
  });

  test('handles root path', () => {
    expect(projectPathToHash('/')).toBe('-');
  });

  test('truncates long paths with hash suffix', () => {
    const longPath = '/Users/esd/' + 'a'.repeat(250);
    const result = projectPathToHash(longPath);
    expect(result.length).toBeLessThanOrEqual(250); // 200 + dash + hash
    expect(result).toMatch(/^-Users-esd-a+-\w+$/);
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
