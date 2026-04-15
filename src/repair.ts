import type { ContentBlock, Message } from './types.js';

/**
 * Repair tool_use / tool_result pairing in an Anthropic-format message array.
 *
 * Handles three cases:
 *  1. Assistant tool_use with no matching tool_result → injects synthetic error result
 *  2. Orphan tool_result with no preceding tool_use → dropped
 *  3. Consecutive assistant messages → flushes pending results between them
 */
export function repairToolPairing(messages: Message[]): Message[] {
  const result: Message[] = [];
  let pending: Set<string> | null = null; // tool_use ids from preceding assistant

  const synthetic = (id: string) => ({
    type: 'tool_result' as const,
    tool_use_id: id,
    content: '[no tool result recorded]',
    is_error: true as const,
  });

  const flushPending = () => {
    if (pending && pending.size > 0) {
      result.push({ role: 'user', content: [...pending].map(synthetic) });
    }
    pending = null;
  };

  for (const msg of messages) {
    if (msg.role === 'assistant') {
      flushPending();
      const ids = new Set<string>();
      if (Array.isArray(msg.content)) {
        for (const b of msg.content) {
          if (b.type === 'tool_use' && typeof b.id === 'string') ids.add(b.id);
        }
      }
      result.push(msg);
      pending = ids.size > 0 ? ids : null;
      continue;
    }

    // user message
    const blocks = Array.isArray(msg.content) ? msg.content : null;
    const hasToolResults = blocks?.some(b => b.type === 'tool_result') ?? false;

    // Fast path: nothing to repair — preserve original shape
    if (!pending && !hasToolResults) {
      result.push(msg);
      continue;
    }

    const input: ContentBlock[] = blocks
      ?? (typeof msg.content === 'string' && msg.content
        ? [{ type: 'text' as const, text: msg.content }]
        : []);

    const provided = new Set<string>();
    const kept = input.filter(b => {
      if (b.type !== 'tool_result') return true;
      if (pending?.has(b.tool_use_id)) {
        provided.add(b.tool_use_id);
        return true;
      }
      return false; // orphan: drop
    });

    if (pending) {
      const missing = [...pending].filter(id => !provided.has(id)).map(synthetic);
      kept.unshift(...missing);
      pending = null;
    }

    if (kept.length === 0) {
      // Only insert a placeholder if this would otherwise leave the payload
      // with no leading user message (API rejects payloads not starting with user).
      if (result.length === 0) {
        result.push({ role: 'user', content: [{ type: 'text', text: '[orphaned tool result removed]' }] });
      }
      continue;
    }
    result.push({ ...msg, content: kept });
  }

  flushPending();
  return result;
}
