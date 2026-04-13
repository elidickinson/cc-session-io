import { describe, test, expect } from 'vitest';
import { repairToolPairing } from '../src/repair.js';

describe('repairToolPairing', () => {
  test('leaves well-formed history semantically equivalent', () => {
    const input = [
      { role: 'user' as const, content: 'hello' },
      { role: 'assistant' as const, content: [{ type: 'tool_use' as const, id: 't1', name: 'Read', input: {} }] },
      { role: 'user' as const, content: [{ type: 'tool_result' as const, tool_use_id: 't1', content: 'ok' }] },
      { role: 'assistant' as const, content: [{ type: 'text' as const, text: 'done' }] },
    ];
    const out = repairToolPairing(input);
    expect(out).toHaveLength(4);
    expect(out[0].content).toBe('hello'); // string user: fast path preserves shape
    expect((out[2].content as any[])[0].tool_use_id).toBe('t1');
    expect((out[2].content as any[])).toHaveLength(1); // no synthetic injection
  });

  test('strips leading orphan tool_result with no preceding assistant', () => {
    const input = [
      { role: 'user' as const, content: [{ type: 'tool_result' as const, tool_use_id: 'ghost', content: 'x' }] },
      { role: 'assistant' as const, content: [{ type: 'text' as const, text: 'hi' }] },
    ];
    const out = repairToolPairing(input);
    expect(out).toHaveLength(2);
    expect((out[0].content as any[])[0].type).toBe('text');
    expect((out[0].content as any[])[0].text).toMatch(/orphaned tool result/);
  });

  test('preserves text in leading user mixed with orphan tool_result', () => {
    const input = [
      { role: 'user' as const, content: [
        { type: 'text' as const, text: 'keep me' },
        { type: 'tool_result' as const, tool_use_id: 'ghost', content: 'drop' },
      ]},
    ];
    const out = repairToolPairing(input);
    expect((out[0].content as any[])).toHaveLength(1);
    expect((out[0].content as any[])[0].text).toBe('keep me');
  });

  test('merges synthetic tool_result into following user text message', () => {
    const input = [
      { role: 'assistant' as const, content: [{ type: 'tool_use' as const, id: 't1', name: 'Read', input: {} }] },
      { role: 'user' as const, content: 'next prompt' },
    ];
    const out = repairToolPairing(input);
    expect(out).toHaveLength(2);
    const blocks = out[1].content as any[];
    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe('tool_result');
    expect(blocks[0].tool_use_id).toBe('t1');
    expect(blocks[0].is_error).toBe(true);
    expect(blocks[1].type).toBe('text');
    expect(blocks[1].text).toBe('next prompt');
  });

  test('fills missing tool_result in partial pair (2 tool_uses, 1 result)', () => {
    const input = [
      { role: 'assistant' as const, content: [
        { type: 'tool_use' as const, id: 't1', name: 'Read', input: {} },
        { type: 'tool_use' as const, id: 't2', name: 'Bash', input: {} },
      ]},
      { role: 'user' as const, content: [{ type: 'tool_result' as const, tool_use_id: 't1', content: 'ok' }] },
    ];
    const out = repairToolPairing(input);
    expect(out).toHaveLength(2);
    const blocks = out[1].content as any[];
    expect(blocks).toHaveLength(2);
    const ids = blocks.map((b: any) => b.tool_use_id).sort();
    expect(ids).toEqual(['t1', 't2']);
    const synth = blocks.find((b: any) => b.tool_use_id === 't2');
    expect(synth.is_error).toBe(true);
  });

  test('trailing assistant tool_use with no follow-up injects synthetic user', () => {
    const input = [
      { role: 'user' as const, content: 'go' },
      { role: 'assistant' as const, content: [{ type: 'tool_use' as const, id: 't1', name: 'Read', input: {} }] },
    ];
    const out = repairToolPairing(input);
    expect(out).toHaveLength(3);
    expect(out[2].role).toBe('user');
    expect((out[2].content as any[])[0].tool_use_id).toBe('t1');
  });

  test('consecutive assistants: flushes pending before second assistant', () => {
    const input = [
      { role: 'assistant' as const, content: [{ type: 'tool_use' as const, id: 't1', name: 'Read', input: {} }] },
      { role: 'assistant' as const, content: [{ type: 'text' as const, text: 'oops' }] },
    ];
    const out = repairToolPairing(input);
    expect(out).toHaveLength(3);
    expect(out[0].role).toBe('assistant');
    expect(out[1].role).toBe('user');
    expect((out[1].content as any[])[0].tool_use_id).toBe('t1');
    expect(out[2].role).toBe('assistant');
  });

  test('orphan tool_result after unrelated assistant is stripped', () => {
    const input = [
      { role: 'user' as const, content: 'hi' },
      { role: 'assistant' as const, content: [{ type: 'text' as const, text: 'hello' }] },
      { role: 'user' as const, content: [
        { type: 'tool_result' as const, tool_use_id: 'ghost', content: 'x' },
        { type: 'text' as const, text: 'real' },
      ]},
    ];
    const out = repairToolPairing(input);
    expect(out).toHaveLength(3);
    expect((out[2].content as any[])).toHaveLength(1);
    expect((out[2].content as any[])[0].type).toBe('text');
  });
});
