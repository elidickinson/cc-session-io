import { execSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { existsSync, unlinkSync, rmdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT = resolve(__dirname, '..', 'tmp-cli-test');

function run(...args: string[]): string {
  const quoted = args.map(a => `"${a.replace(/"/g, '\\"')}"`).join(' ');
  const cmd = `npx tsx ${join(__dirname, '..', 'src/cli.ts')} ${quoted}`;
  return execSync(cmd, { encoding: 'utf-8', stdio: 'pipe' }).trim();
}

try {
  // Clean up
  const dir = join(process.env.HOME!, '.claude', 'projects', PROJECT.replaceAll('/', '-'));
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) unlinkSync(join(dir, f));
    rmdirSync(dir);
  }

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
  process.exit(1);
}
