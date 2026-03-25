import { describe, test, expect } from 'vitest';
import { join } from 'node:path';
import { parseJsonl, parseJsonlFile, serializeRecord, serializeJsonl } from '../src/jsonl.js';
import type { UserRecord, AssistantRecord } from '../src/types.js';

const fixturePath = join(import.meta.dirname, 'fixtures', 'sample.jsonl');

describe('parseJsonlFile', () => {
  test('parses all records from fixture', () => {
    const records = parseJsonlFile(fixturePath);
    expect(records).toHaveLength(5);
  });

  test('identifies user and assistant records by type', () => {
    const records = parseJsonlFile(fixturePath);
    const user = records.find(r => r.type === 'user') as UserRecord;
    const asst = records.find(r => r.type === 'assistant') as AssistantRecord;

    expect(user.uuid).toBe('aaa-111');
    expect(user.message.role).toBe('user');
    expect(user.message.content).toBe('hello');

    expect(asst.uuid).toBe('bbb-222');
    expect(asst.parentUuid).toBe('aaa-111');
    expect(asst.message.model).toBe('claude-opus-4-6');
    expect(asst.message.content[0]).toEqual({ type: 'text', text: 'Hi there!' });
  });

  test('preserves unknown record types', () => {
    const records = parseJsonlFile(fixturePath);
    const queueOps = records.filter(r => r.type === 'queue-operation');
    const snapshot = records.find(r => r.type === 'file-history-snapshot');

    expect(queueOps).toHaveLength(2);
    expect((queueOps[0] as any).operation).toBe('enqueue');
    expect(snapshot).toBeDefined();
    expect((snapshot as any).messageId).toBe('aaa-111');
  });
});

describe('parseJsonl', () => {
  test('handles empty string', () => {
    expect(parseJsonl('')).toEqual([]);
  });

  test('handles trailing newlines', () => {
    const records = parseJsonl('{"type":"user","uuid":"x"}\n\n');
    expect(records).toHaveLength(1);
  });
});

describe('serializeRecord / serializeJsonl', () => {
  test('round-trips records without data loss', () => {
    const records = parseJsonlFile(fixturePath);
    const serialized = serializeJsonl(records);
    const reparsed = parseJsonl(serialized);

    expect(reparsed).toHaveLength(records.length);
    for (let i = 0; i < records.length; i++) {
      expect(reparsed[i]).toEqual(records[i]);
    }
  });

  test('single record serialization', () => {
    const record: UserRecord = {
      type: 'user',
      uuid: 'test',
      parentUuid: null,
      sessionId: 'sess',
      timestamp: '2026-01-01T00:00:00Z',
      isSidechain: false,
      cwd: '/tmp',
      userType: 'external',
      version: '2.1.83',
      gitBranch: 'main',
      slug: 'test-slug',
      entrypoint: 'cli',
      message: { role: 'user', content: 'hi' },
    };
    const line = serializeRecord(record);
    expect(JSON.parse(line)).toEqual(record);
  });
});
