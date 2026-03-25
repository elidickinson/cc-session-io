import { readFileSync } from 'node:fs';
import type { JsonlRecord, UserRecord, AssistantRecord, UnknownRecord } from './types.js';

/** Parse a JSONL string into an array of records. */
export function parseJsonl(content: string): JsonlRecord[] {
  return content
    .split('\n')
    .filter(line => line.trim())
    .map(parseRecord);
}

/** Parse a JSONL file from disk. */
export function parseJsonlFile(path: string): JsonlRecord[] {
  return parseJsonl(readFileSync(path, 'utf-8'));
}

function parseRecord(line: string): JsonlRecord {
  const raw = JSON.parse(line);
  if (raw.type === 'user') return raw as UserRecord;
  if (raw.type === 'assistant') return raw as AssistantRecord;
  return raw as UnknownRecord;
}

/** Serialize a single record to a JSON line (no trailing newline). */
export function serializeRecord(record: JsonlRecord): string {
  return JSON.stringify(record);
}

/** Serialize an array of records to a JSONL string. */
export function serializeJsonl(records: JsonlRecord[]): string {
  return records.map(serializeRecord).join('\n') + '\n';
}
