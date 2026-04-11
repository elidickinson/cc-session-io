import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, symlinkSync, rmSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { projectPathToHash, getProjectDir, getSessionPath, normalizeProjectPath } from '../src/paths.js';

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

describe('normalizeProjectPath', () => {
  let tempRoot: string;

  beforeEach(() => {
    // mkdtemp resolves through any parent symlinks (e.g. /var → /private/var on macOS)
    // so we use realpathSync on the result to get the canonical base for assertions.
    tempRoot = realpathSync(mkdtempSync(join(tmpdir(), 'cc-session-norm-')));
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  test('returns realpath for symlinked existing directory', () => {
    const target = join(tempRoot, 'real-project');
    const link = join(tempRoot, 'link-project');
    mkdirSync(target);
    symlinkSync(target, link);
    expect(normalizeProjectPath(link)).toBe(target);
  });

  test('falls back to NFC of raw path when realpath fails', () => {
    const ghost = join(tempRoot, 'does-not-exist');
    expect(normalizeProjectPath(ghost)).toBe(ghost);
  });

  test('NFC-normalizes a non-existent path with combining marks', () => {
    // "café" written as 'cafe' + U+0301 (NFD) should normalize to U+00E9 (NFC)
    const nfd = join(tempRoot, 'cafe\u0301-project');
    const nfc = join(tempRoot, 'caf\u00e9-project');
    expect(normalizeProjectPath(nfd)).toBe(nfc);
  });

  test('getProjectDir uses realpath of symlinked project', () => {
    const target = join(tempRoot, 'real-proj');
    const link = join(tempRoot, 'link-proj');
    mkdirSync(target);
    symlinkSync(target, link);
    // Both the symlink and the target should resolve to the SAME hash dir.
    expect(getProjectDir(link, '/tmp/claude')).toBe(getProjectDir(target, '/tmp/claude'));
  });
});
