/**
 * Smoke test: drives the CLI through create, add, read, and list. Sessions go
 * to a temp dir via CLAUDE_CONFIG_DIR, so nothing lands in ~/.claude.
 *
 * Run: npm run smoke:cli
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '..', 'src/cli.ts');
const PROJECT = resolve(__dirname, '..', 'tmp-cli-test');
const claudeDir = mkdtempSync(join(tmpdir(), 'cc-session-cli-smoke-'));

function run(...args: string[]): string {
  return execFileSync('npx', ['tsx', CLI, ...args], {
    encoding: 'utf-8',
    stdio: 'pipe',
    env: { ...process.env, CLAUDE_CONFIG_DIR: claudeDir },
  }).trim();
}

try {
  console.log('1. Create session...');
  const id = run('create', '-p', PROJECT);
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid id: ' + id);

  console.log('2. Add user message...');
  run('add', 'user', 'Hello!', '-p', PROJECT, '-s', id);

  console.log('3. Add assistant message...');
  run('add', 'assistant', 'Hi!', '-p', PROJECT, '-s', id);

  console.log('4. Read conversation...');
  const out = run('read', '-p', PROJECT, '-s', id);
  if (!out.includes('Hello!') || !out.includes('Hi!')) throw new Error('Messages missing');

  console.log('5. List sessions...');
  const list = run('list', '-p', PROJECT);
  if (!list.includes(id)) throw new Error('Session not in list');

  console.log('\n✅ All CLI tests passed!');
} catch (e: any) {
  console.error('❌ Test failed:', e.message);
  process.exitCode = 1;
} finally {
  rmSync(claudeDir, { recursive: true, force: true });
}
