import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, symlinkSync, rmSync, readFileSync, realpathSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSession, openSession, readSession } from '../src/session.js';
import { getProjectDir } from '../src/paths.js';
import { parseJsonl } from '../src/jsonl.js';
import type { UserRecord, AssistantRecord } from '../src/types.js';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'cc-session-test-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('createSession + save', () => {
  test('creates a JSONL file with user and assistant messages', () => {
    const session = createSession({
      projectPath: '/tmp/test-project',
      claudeDir: tempDir,
      gitBranch: 'main',
    });

    session.addUserMessage('hello');
    session.addAssistantMessage([{ type: 'text', text: 'hi there' }]);
    session.save();

    const content = readFileSync(session.jsonlPath, 'utf-8');
    const records = parseJsonl(content);

    expect(records).toHaveLength(2);
    expect(records[0].type).toBe('user');
    expect(records[1].type).toBe('assistant');
  });

  test('uuid chain is correct', () => {
    const session = createSession({
      projectPath: '/tmp/test-project',
      claudeDir: tempDir,
    });

    session.addUserMessage('first');
    session.addAssistantMessage([{ type: 'text', text: 'response' }]);
    session.addUserMessage('second');
    session.save();

    const msgs = session.messages;
    expect(msgs[0].parentUuid).toBeNull();
    expect(msgs[1].parentUuid).toBe(msgs[0].uuid);
    expect(msgs[2].parentUuid).toBe(msgs[1].uuid);
  });

  test('records have distinct monotonically increasing timestamps', () => {
    const session = createSession({
      projectPath: '/tmp/test-project',
      claudeDir: tempDir,
    });

    session.addUserMessage('first');
    session.addAssistantMessage([{ type: 'text', text: 'response' }]);
    session.addUserMessage('second');
    session.addAssistantMessage([{ type: 'text', text: 'response 2' }]);
    session.save();

    const timestamps = session.messages.map(m => m.timestamp);
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i] > timestamps[i - 1]).toBe(true);
    }
  });

  test('all fidelity fields are populated', () => {
    const session = createSession({
      projectPath: '/tmp/test-project',
      claudeDir: tempDir,
      cwd: '/tmp/test-project',
      gitBranch: 'feature',
      version: '2.1.83',
    });

    session.addUserMessage('test');
    session.save();

    const user = session.messages[0] as UserRecord;
    expect(user.cwd).toBe('/tmp/test-project');
    expect(user.gitBranch).toBe('feature');
    expect(user.version).toBe('2.1.83');
    expect(user.userType).toBe('external');
    expect(user.entrypoint).toBe('cli');
    expect(user.isSidechain).toBe(false);
    expect(user.slug).toMatch(/^[a-z]+-[a-z]+-[a-z]+$/);
    expect(user.sessionId).toBe(session.sessionId);
  });

  test('assistant message has API response shape', () => {
    const session = createSession({
      projectPath: '/tmp/test-project',
      claudeDir: tempDir,
    });

    session.addAssistantMessage([{ type: 'text', text: 'hello' }]);
    session.save();

    const asst = session.messages[0] as AssistantRecord;
    expect(asst.message.id).toMatch(/^msg_syn_/);
    expect(asst.message.type).toBe('message');
    expect(asst.message.role).toBe('assistant');
    expect(asst.message.model).toBeTruthy();
    expect(asst.message.stop_reason).toBe('end_turn');
    expect(asst.requestId).toMatch(/^req_syn_/);
  });
});

describe('tool calls', () => {
  test('addToolResults creates tool_result content blocks', () => {
    const session = createSession({
      projectPath: '/tmp/test-project',
      claudeDir: tempDir,
    });

    session.addAssistantMessage([
      { type: 'tool_use', id: 'toolu_abc', name: 'Read', input: { file_path: '/foo' } },
    ]);
    session.addToolResults([{ toolUseId: 'toolu_abc', content: 'file contents' }]);
    session.save();

    const msgs = session.messages;
    const toolResult = msgs[1] as UserRecord;
    expect(toolResult.message.content).toEqual([
      { type: 'tool_result', tool_use_id: 'toolu_abc', content: 'file contents' },
    ]);
  });

  test('addToolCalls creates full round-trip', () => {
    const session = createSession({
      projectPath: '/tmp/test-project',
      claudeDir: tempDir,
    });

    session.addUserMessage('read the file');
    session.addToolCalls(
      [{ name: 'Read', input: { file_path: '/foo' }, result: 'contents' }],
      { response: [{ type: 'text', text: 'I read the file.' }] },
    );
    session.save();

    const msgs = session.messages;
    expect(msgs).toHaveLength(4);
    expect(msgs[0].type).toBe('user'); // "read the file"
    expect(msgs[1].type).toBe('assistant'); // tool_use
    expect(msgs[2].type).toBe('user'); // tool_result
    expect(msgs[3].type).toBe('assistant'); // "I read the file."

    const toolUse = (msgs[1] as AssistantRecord).message;
    expect(toolUse.stop_reason).toBe('tool_use');
    expect(toolUse.content[0].type).toBe('tool_use');
  });

  test('addToolCalls without response creates two records', () => {
    const session = createSession({
      projectPath: '/tmp/test-project',
      claudeDir: tempDir,
    });

    session.addToolCalls([
      { name: 'Bash', input: { command: 'ls' }, result: 'file.txt' },
    ]);
    session.save();

    expect(session.messages).toHaveLength(2);
  });
});

describe('openSession + append', () => {
  test('reads back a saved session and appends to it', () => {
    const session = createSession({
      projectPath: '/tmp/test-project',
      claudeDir: tempDir,
    });

    session.addUserMessage('first');
    session.addAssistantMessage([{ type: 'text', text: 'response' }]);
    session.save();

    // Re-open and append
    const reopened = openSession({
      sessionId: session.sessionId,
      projectPath: '/tmp/test-project',
      claudeDir: tempDir,
    });

    expect(reopened.messages).toHaveLength(2);

    reopened.addUserMessage('second');
    reopened.save();

    // Read final state
    const final = openSession({
      sessionId: session.sessionId,
      projectPath: '/tmp/test-project',
      claudeDir: tempDir,
    });

    expect(final.messages).toHaveLength(3);
    expect((final.messages[2] as UserRecord).message.content).toBe('second');
    expect(final.messages[2].parentUuid).toBe(final.messages[1].uuid);
  });
});

describe('importMessages', () => {
  test('dispatches user text, assistant, and tool_result messages', () => {
    const session = createSession({
      projectPath: '/tmp/test-project',
      claudeDir: tempDir,
    });

    session.importMessages([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
      { role: 'assistant', content: [
        { type: 'tool_use', id: 'toolu_real_123', name: 'Read', input: { file_path: '/foo' } },
      ]},
      { role: 'user', content: [
        { type: 'tool_result', tool_use_id: 'toolu_real_123', content: 'file contents' },
      ]},
      { role: 'assistant', content: [{ type: 'text', text: 'I read the file.' }] },
    ]);
    session.save();

    const msgs = session.messages;
    expect(msgs).toHaveLength(5);
    expect(msgs[0].type).toBe('user');
    expect((msgs[0] as UserRecord).message.content).toBe('hello');
    expect(msgs[1].type).toBe('assistant');
    expect(msgs[2].type).toBe('assistant'); // tool_use
    expect((msgs[2] as AssistantRecord).message.stop_reason).toBe('tool_use');
    expect(msgs[3].type).toBe('user'); // tool_result
    expect(msgs[4].type).toBe('assistant');
  });

  test('preserves tool_use IDs from input', () => {
    const session = createSession({
      projectPath: '/tmp/test-project',
      claudeDir: tempDir,
    });

    session.importMessages([
      { role: 'assistant', content: [
        { type: 'tool_use', id: 'toolu_original_id', name: 'Bash', input: { command: 'ls' } },
      ]},
      { role: 'user', content: [
        { type: 'tool_result', tool_use_id: 'toolu_original_id', content: 'output' },
      ]},
    ]);

    const asst = session.messages[0] as AssistantRecord;
    const toolUse = asst.message.content[0];
    expect(toolUse.type).toBe('tool_use');
    expect((toolUse as any).id).toBe('toolu_original_id');

    const user = session.messages[1] as UserRecord;
    const toolResult = (user.message.content as any[])[0];
    expect(toolResult.tool_use_id).toBe('toolu_original_id');
  });

  test('handles assistant string content', () => {
    const session = createSession({
      projectPath: '/tmp/test-project',
      claudeDir: tempDir,
    });

    session.importMessages([
      { role: 'assistant', content: 'plain text response' },
    ]);

    const asst = session.messages[0] as AssistantRecord;
    expect(asst.message.content).toEqual([{ type: 'text', text: 'plain text response' }]);
  });
});

describe('readSession', () => {
  test('reads fixture file preserving all record types', () => {
    const fixturePath = join(import.meta.dirname, 'fixtures', 'sample.jsonl');
    const session = readSession(fixturePath);

    expect(session.sessionId).toBe('80f30bff-caa9-43bf-b831-61f1232e2876');
    expect(session.records).toHaveLength(5);
    expect(session.messages).toHaveLength(2);
  });
});

describe('createSession path normalization', () => {
  // Regression test for the symlink bug: when a caller passes a project path
  // that goes through a symlink (e.g. process.cwd() of a shell that entered
  // via a symlinked dir), cc-session must write the session file under the
  // *realpath*-resolved hash dir — that's where Claude Code itself looks on
  // resume (its bootstrap calls realpathSync on the cwd before computing the
  // project hash). Without normalization, pi writes to one dir and CC SDK
  // reads from another, producing "No conversation found with session ID".
  let tempRoot: string;
  let claudeDir: string;

  beforeEach(() => {
    tempRoot = realpathSync(mkdtempSync(join(tmpdir(), 'cc-session-symlink-')));
    claudeDir = join(tempRoot, 'claude');
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  test('jsonlPath uses realpath of symlinked project dir', () => {
    const target = join(tempRoot, 'real-project');
    const link = join(tempRoot, 'link-project');
    mkdirSync(target);
    symlinkSync(target, link);

    const session = createSession({ projectPath: link, claudeDir });
    session.addUserMessage('hello');
    session.save();

    // Where CC SDK would look for this session given the *target* cwd:
    const expectedDir = getProjectDir(target, claudeDir);
    expect(session.jsonlPath.startsWith(expectedDir + '/')).toBe(true);
    expect(existsSync(session.jsonlPath)).toBe(true);
  });

  test('stored cwd field is the realpath, not the symlink', () => {
    const target = join(tempRoot, 'real-project-2');
    const link = join(tempRoot, 'link-project-2');
    mkdirSync(target);
    symlinkSync(target, link);

    const session = createSession({ projectPath: link, claudeDir });
    session.addUserMessage('hello');
    session.save();

    const user = session.messages[0] as UserRecord;
    expect(user.cwd).toBe(target);
  });
});
