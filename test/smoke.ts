/**
 * Smoke test: creates a synthetic CC session, resumes it with `claude -p`,
 * and verifies Claude can see the conversation history.
 *
 * The session is written to a temp dir and resumed by path, with persistence
 * off and customizations disabled, so nothing lands in ~/.claude and your
 * hooks, plugins, and CLAUDE.md stay out of it. Makes one real API call.
 *
 * Run: npm run smoke
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSession } from '../src/session.js';

const MARKER = 'SMOKE_TEST_UNIQUE_PHRASE_XK9Q2';
const claudeDir = mkdtempSync(join(tmpdir(), 'cc-session-smoke-'));

const session = createSession({
  projectPath: process.cwd(),
  claudeDir,
  gitBranch: 'HEAD',
});

session.addUserMessage(`Remember this phrase: ${MARKER}`);
session.addAssistantMessage([
  { type: 'text', text: `Got it, I will remember the phrase: ${MARKER}` },
]);

session.addToolCalls(
  [{ name: 'Bash', input: { command: 'echo hello' }, result: 'hello\n' }],
  { response: [{ type: 'text', text: 'The command output "hello".' }] },
);

session.addUserMessage('What was the unique phrase I told you?');
session.addAssistantMessage([
  { type: 'text', text: `The unique phrase you told me was: ${MARKER}` },
]);

session.save();

console.log(`Created session: ${session.sessionId}`);
console.log(`JSONL path: ${session.jsonlPath}`);
console.log(`Messages: ${session.messages.length}`);
console.log();

try {
  console.log('Resuming with claude -p ...');
  const output = execFileSync('claude', [
    '-p', '--safe-mode', '--no-session-persistence',
    '--resume', session.jsonlPath,
    'What was the unique phrase from our conversation?',
  ], { encoding: 'utf-8', timeout: 60_000 }).trim();

  console.log(`Claude responded: ${output.slice(0, 200)}`);
  console.log();

  if (output.includes(MARKER)) {
    console.log('PASS: Claude recalled the synthetic conversation.');
  } else {
    console.error('FAIL: Claude did not mention the marker phrase.');
    console.error(`Expected output to contain: ${MARKER}`);
    process.exitCode = 1;
  }
} catch (err: any) {
  console.error('FAIL: claude command failed.');
  console.error(err.stderr || err.message);
  process.exitCode = 1;
} finally {
  rmSync(claudeDir, { recursive: true, force: true });
}
