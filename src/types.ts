// -- Content blocks (Anthropic API format) --

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ThinkingBlock {
  type: 'thinking';
  thinking: string;
  signature: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string | ContentBlock[];
  is_error?: boolean;
}

export interface ImageBlock {
  type: 'image';
  source:
    | { type: 'base64'; media_type: string; data: string }
    | { type: 'url'; url: string };
}

export type ContentBlock =
  | TextBlock | ThinkingBlock | ToolUseBlock | ToolResultBlock | ImageBlock;

/** Blocks valid in a user message. `thinking` and `tool_use` are assistant-only. */
export type UserContentBlock = TextBlock | ToolResultBlock | ImageBlock;

export interface Message {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

// -- Assistant message payload (Anthropic API response shape) --

export interface AssistantMessagePayload {
  id: string;
  type: 'message';
  role: 'assistant';
  model: string;
  content: ContentBlock[];
  stop_reason: string | null;
  stop_sequence: string | null;
  usage?: { input_tokens: number; output_tokens: number };
}

// -- User message payload --

export interface UserMessagePayload {
  role: 'user';
  content: string | ContentBlock[];
}

// -- Shared fields on user/assistant JSONL records --

export interface BaseRecordFields {
  uuid: string;
  parentUuid: string | null;
  sessionId: string;
  timestamp: string;
  isSidechain: boolean;
  cwd: string;
  userType: string;
  version: string;
  gitBranch: string;
  slug: string;
  entrypoint: string;
}

// -- JSONL record types --

export interface UserRecord extends BaseRecordFields {
  type: 'user';
  message: UserMessagePayload;
  promptId?: string;
  permissionMode?: string;
  isMeta?: boolean;
}

export interface AssistantRecord extends BaseRecordFields {
  type: 'assistant';
  message: AssistantMessagePayload;
  requestId?: string;
}

/**
 * Claude Code's own injected context, written as its own record rather than as
 * part of a message: an `@file` expansion, a skill listing, a task reminder.
 * The payload shape varies by `attachment.type` and is left open — only `file`
 * and `edited_text_file` carry content a consumer cannot regenerate, and the
 * rest Claude Code rewrites every turn.
 *
 * An attachment hangs off the message that caused it via `parentUuid` and is
 * not part of the message chain itself, so it never becomes the parent of the
 * record that follows.
 */
export interface AttachmentRecord extends BaseRecordFields {
  type: 'attachment';
  attachment: { type: string; [key: string]: unknown };
}

export interface UnknownRecord {
  type: string;
  [key: string]: unknown;
}

export type JsonlRecord = UserRecord | AssistantRecord | AttachmentRecord | UnknownRecord;

// -- Convenience types for addToolCalls --

export interface ToolCallSpec {
  name: string;
  input: unknown;
  result: string | ContentBlock[];
  isError?: boolean;
}

// -- Session creation options --

export interface CreateSessionOptions {
  projectPath: string;
  claudeDir?: string;
  cwd?: string;
  gitBranch?: string;
  version?: string;
  model?: string;
  sessionId?: string;
}

export interface OpenSessionOptions {
  sessionId: string;
  projectPath: string;
  claudeDir?: string;
}
