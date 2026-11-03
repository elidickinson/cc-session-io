import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, appendFileSync, existsSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseJsonlFile, serializeRecord } from './jsonl.js';
import { getSessionPath, normalizeProjectPath } from './paths.js';
import { repairWithOrigin } from './repair.js';
import type {
  AttachmentRecord, BaseRecordFields, ImportAttachment,
  JsonlRecord, UserRecord, AssistantRecord, ContentBlock, ToolResultBlock, UserContentBlock,
  AssistantMessagePayload, ToolCallSpec, CreateSessionOptions, OpenSessionOptions,
  Message,
} from './types.js';

// -- Slug generation --

const ADJECTIVES = [
  'ancient', 'bold', 'bright', 'calm', 'clever', 'cool', 'crimson', 'daring',
  'eager', 'fast', 'fierce', 'gentle', 'golden', 'happy', 'hidden', 'iron',
  'keen', 'lively', 'mighty', 'nimble', 'pale', 'proud', 'quick', 'rapid',
  'sharp', 'silent', 'smooth', 'steady', 'swift', 'vivid', 'warm', 'wild',
];

const NOUNS = [
  'arrow', 'badge', 'beacon', 'blade', 'brook', 'castle', 'cedar', 'cloud',
  'comet', 'crest', 'dawn', 'drift', 'eagle', 'ember', 'falcon', 'flame',
  'forge', 'gale', 'grove', 'harbor', 'hawk', 'jade', 'kettle', 'lance',
  'maple', 'marsh', 'needle', 'oak', 'pearl', 'pine', 'ridge', 'river',
  'rune', 'sage', 'shade', 'spark', 'stone', 'thorn', 'tower', 'wave',
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateSlug(): string {
  return `${pick(ADJECTIVES)}-${pick(ADJECTIVES)}-${pick(NOUNS)}`;
}

/** Generate a synthetic Anthropic message ID. */
function syntheticMessageId(): string {
  return `msg_syn_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

/** Generate a synthetic Anthropic request ID. */
function syntheticRequestId(): string {
  return `req_syn_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

export class Session {
  readonly sessionId: string;
  readonly projectPath: string;
  readonly jsonlPath: string;

  private _records: JsonlRecord[] = [];
  private _pendingRecords: JsonlRecord[] = [];
  private _lastUuid: string | null = null;
  private _slug: string;
  private _cwd: string;
  private _version: string;
  private _gitBranch: string;
  private _model: string;
  private _fileExists: boolean;
  /** Epoch ms of the latest record Claude Code could resume from. It resumes
   *  from the one stamped latest, so every new record must come after it. */
  private _latestTimestamp: number;

  constructor(opts: {
    sessionId: string;
    projectPath: string;
    jsonlPath: string;
    slug?: string;
    cwd?: string;
    version?: string;
    gitBranch?: string;
    model?: string;
    records?: JsonlRecord[];
    fileExists?: boolean;
  }) {
    this.sessionId = opts.sessionId;
    this.projectPath = opts.projectPath;
    this.jsonlPath = opts.jsonlPath;
    this._slug = opts.slug ?? generateSlug();
    this._cwd = opts.cwd ?? opts.projectPath;
    this._version = opts.version ?? '2.1.83';
    this._gitBranch = opts.gitBranch ?? 'HEAD';
    this._model = opts.model ?? 'claude-sonnet-4-6';
    this._records = opts.records ?? [];
    this._fileExists = opts.fileExists ?? false;
    this._latestTimestamp = this._records.reduce((t, r) => Math.max(t, resumeTimestamp(r)), -Infinity);

    // Find the last uuid in the chain for appending. Attachments are links in
    // the chain, so one at the tail is the next record's parent.
    for (let i = this._records.length - 1; i >= 0; i--) {
      const r = this._records[i];
      if (r.type === 'user' || r.type === 'assistant' || r.type === 'attachment') {
        this._lastUuid = (r as UserRecord | AssistantRecord | AttachmentRecord).uuid;
        break;
      }
    }
  }

  /** All records (existing + pending). */
  get records(): readonly JsonlRecord[] {
    return [...this._records, ...this._pendingRecords];
  }

  /** Only user and assistant message records. */
  get messages(): readonly (UserRecord | AssistantRecord)[] {
    return this.records.filter(
      (r): r is UserRecord | AssistantRecord => r.type === 'user' || r.type === 'assistant'
    );
  }

  /** Only attachment records — Claude Code's injected context (`@file`
   *  expansions, skill listings, task reminders). */
  get attachments(): readonly AttachmentRecord[] {
    return this.records.filter((r): r is AttachmentRecord => r.type === 'attachment');
  }

  /** Now, or just after the latest record if that is later. Ties count as
   *  earlier: Claude Code resumes from the first of two equal timestamps. */
  private stamp(): string {
    this._latestTimestamp = Math.max(Date.now(), this._latestTimestamp + 1);
    return new Date(this._latestTimestamp).toISOString();
  }

  private baseFields(): Omit<UserRecord, 'type' | 'message'> {
    const uuid = randomUUID();
    const record = {
      uuid,
      parentUuid: this._lastUuid,
      sessionId: this.sessionId,
      timestamp: this.stamp(),
      isSidechain: false,
      cwd: this._cwd,
      userType: 'external',
      version: this._version,
      gitBranch: this._gitBranch,
      slug: this._slug,
      entrypoint: 'cli',
    };
    this._lastUuid = uuid;
    return record;
  }

  /** Add a user message, as plain text or content blocks. Returns its uuid. */
  addUserMessage(content: string | UserContentBlock[]): string {
    if (Array.isArray(content) && content.length === 0) {
      throw new Error('addUserMessage: content array is empty; Anthropic rejects empty message content');
    }
    const base = this.baseFields();
    const record: UserRecord = {
      type: 'user',
      ...base,
      message: { role: 'user', content },
    };
    this._pendingRecords.push(record);
    return base.uuid;
  }

  /**
   * Append a record verbatim. The escape hatch for record types this library
   * does not model — `queue-operation`, `last-prompt`, anything a future Claude
   * Code release adds — and for carrying records from one session into another.
   *
   * Dangerous because nothing is synthesized or checked beyond `sessionId` and
   * the parent link: the shape is whatever you pass, and Claude Code will read
   * it back. `sessionId` is overwritten with this session's, since a record
   * claiming another session is never what a caller wants. The record does not
   * join the uuid chain, so a following message still parents to the last real
   * message.
   *
   * The one guard is on `parentUuid`, because that is the failure that does not
   * announce itself: a dangling parent makes Claude Code resume with empty
   * context and answer confidently from nothing.
   *
   * The record's own `timestamp` is kept. If Claude Code could resume from it
   * (a user, assistant, attachment, or system record), records added after it
   * are stamped later still, even if that puts them in the future.
   *
   * Carrying an *attachment* into another session should use `addAttachment`
   * instead: this method does not advance the chain, so an attachment appended
   * through it becomes a leaf the next message skips over.
   */
  dangerousAppendRecord(record: JsonlRecord, opts?: { parentUuid?: string | null }): void {
    const parentUuid = opts?.parentUuid !== undefined
      ? opts.parentUuid
      : (record as Partial<BaseRecordFields>).parentUuid;
    if (parentUuid != null) {
      const known = this.records.some(r => (r as Partial<BaseRecordFields>).uuid === parentUuid);
      if (!known) {
        throw new Error(
          `dangerousAppendRecord: parentUuid ${parentUuid} is not a record in this session; ` +
          `a dangling parent makes Claude Code resume with empty context`,
        );
      }
    }
    this._pendingRecords.push({
      ...record,
      ...(parentUuid !== undefined ? { parentUuid } : {}),
      sessionId: this.sessionId,
    } as JsonlRecord);
    this._latestTimestamp = Math.max(this._latestTimestamp, resumeTimestamp(record));
  }

  /**
   * Add an attachment record. `parentUuid` defaults to the record this session
   * would currently chain from; pass it explicitly when re-attaching a record
   * carried over from another session, where the message it belongs to has been
   * given a new uuid. Returns the new record's uuid.
   *
   * Attachments are links in the uuid chain, not leaves hanging off it: the
   * record that follows one parents to the attachment, so this advances the
   * chain exactly as the message methods do. Measured across 605 real sessions —
   * 3,526 records chain through an attachment, none skip it.
   */
  addAttachment(
    attachment: { type: string; [key: string]: unknown },
    opts?: { parentUuid?: string | null },
  ): string {
    const uuid = randomUUID();
    const record: AttachmentRecord = {
      type: 'attachment',
      attachment,
      uuid,
      parentUuid: opts?.parentUuid !== undefined ? opts.parentUuid : this._lastUuid,
      sessionId: this.sessionId,
      timestamp: this.stamp(),
      isSidechain: false,
      cwd: this._cwd,
      userType: 'external',
      version: this._version,
      gitBranch: this._gitBranch,
      slug: this._slug,
      entrypoint: 'cli',
    };
    this.dangerousAppendRecord(record);
    this._lastUuid = uuid;
    return uuid;
  }

  /** Add an assistant message with the given content blocks. Returns its uuid. */
  addAssistantMessage(
    content: ContentBlock[],
    opts?: { model?: string; stopReason?: string },
  ): string {
    const base = this.baseFields();
    const hasToolUse = content.some(b => b.type === 'tool_use');
    const payload: AssistantMessagePayload = {
      id: syntheticMessageId(),
      type: 'message',
      role: 'assistant',
      model: opts?.model ?? this._model,
      content,
      stop_reason: opts?.stopReason ?? (hasToolUse ? 'tool_use' : 'end_turn'),
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    };
    const record: AssistantRecord = {
      type: 'assistant',
      ...base,
      requestId: syntheticRequestId(),
      message: payload,
    };
    this._pendingRecords.push(record);
    return base.uuid;
  }

  /** Add a user message containing tool results. Returns its uuid. */
  addToolResults(
    results: { toolUseId: string; content: string | ContentBlock[]; isError?: boolean }[],
  ): string {
    const base = this.baseFields();
    const record: UserRecord = {
      type: 'user',
      ...base,
      message: {
        role: 'user',
        content: results.map(r => ({
          type: 'tool_result' as const,
          tool_use_id: r.toolUseId,
          content: r.content,
          ...(r.isError ? { is_error: true } : {}),
        })),
      },
    };
    this._pendingRecords.push(record);
    return base.uuid;
  }

  /**
   * Convenience: add a complete tool call round-trip.
   * Creates assistant tool_use message, user tool_result message,
   * and optionally a final assistant text response.
   */
  addToolCalls(
    calls: ToolCallSpec[],
    opts?: { response?: ContentBlock[]; model?: string },
  ): void {
    const toolUseBlocks: ContentBlock[] = calls.map(c => ({
      type: 'tool_use' as const,
      id: `toolu_syn_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
      name: c.name,
      input: c.input,
    }));

    this.addAssistantMessage(toolUseBlocks, { model: opts?.model, stopReason: 'tool_use' });

    this.addToolResults(
      calls.map((c, i) => ({
        toolUseId: (toolUseBlocks[i] as { id: string }).id,
        content: c.result,
        isError: c.isError,
      })),
    );

    if (opts?.response) {
      this.addAssistantMessage(opts.response, { model: opts?.model });
    }
  }

  /**
   * Import an array of Anthropic API-shaped messages, dispatching each to the
   * appropriate internal method based on role and content type.
   */
  importMessages(messages: Message[], opts?: { attachments?: ImportAttachment[] }): void {
    const { messages: repaired, origin } = repairWithOrigin(messages);
    // Attachments sit *in* the chain, so they have to be emitted in order as the
    // messages are written rather than appended afterwards. Keyed to the caller's
    // own indices; the repair can insert and drop messages, so `origin` maps back.
    const following = new Map<number, ImportAttachment[]>();
    for (const a of opts?.attachments ?? []) {
      if (a.afterIndex < 0 || a.afterIndex >= messages.length) {
        console.warn(
          `importMessages: attachment afterIndex ${a.afterIndex} is out of range ` +
          `(${messages.length} messages); not emitted`,
        );
        continue;
      }
      const list = following.get(a.afterIndex);
      if (list) list.push(a);
      else following.set(a.afterIndex, [a]);
    }
    const floor = this._latestTimestamp;
    const first = this._pendingRecords.length;
    for (const [i, msg] of repaired.entries()) {
      if (msg.role === 'assistant') {
        const content = typeof msg.content === 'string'
          ? [{ type: 'text' as const, text: msg.content }]
          : msg.content;
        this.addAssistantMessage(content);
      } else {
        if (typeof msg.content === 'string') {
          this.addUserMessage(msg.content);
        } else {
          const toolResults = msg.content.filter(
            (b): b is ToolResultBlock => b.type === 'tool_result',
          );
          // Anything that isn't a tool result still belongs to the user. Claude
          // Code never mixes the two in one record, and repairToolPairing can
          // inject a synthetic result into a message that already has content,
          // so the remainder is emitted as its own message rather than dropped.
          const rest = msg.content.filter(
            (b): b is UserContentBlock => b.type !== 'tool_result',
          );
          if (toolResults.length > 0) {
            this.addToolResults(toolResults.map(r => ({
              toolUseId: r.tool_use_id,
              content: r.content,
              isError: r.is_error,
            })));
          }
          // Blocks are passed through as-is: flattening to text would drop
          // images, and an image-only message has no text to fall back to.
          if (rest.length > 0) this.addUserMessage(rest);
        }
      }
      const src = origin[i];
      if (src !== null) {
        for (const a of following.get(src) ?? []) this.addAttachment(a.attachment);
      }
    }
    // Stamping as it goes runs a large import seconds into the future, 1 ms per
    // record, and Claude Code ages the tail with a signed subtraction, so a
    // future tail always reads as fresh. Restamp so the last record lands at
    // now, unless that would put the import at or before a record already in
    // the session, which Claude Code would then resume from instead.
    const added = this._pendingRecords.slice(first) as BaseRecordFields[];
    if (added.length === 0) return;
    let t = Math.max(floor + 1, Date.now() - added.length + 1);
    for (const r of added) r.timestamp = new Date(t++).toISOString();
    this._latestTimestamp = t - 1;
  }

  /**
   * Reset this session to empty state and delete any on-disk artifacts.
   * The sessionId and jsonlPath are preserved so subsequent writes reuse them.
   */
  clear(): void {
    this._records = [];
    this._pendingRecords = [];
    this._lastUuid = null;
    this._latestTimestamp = -Infinity;
    this._fileExists = false;
    removeSessionFiles(this.jsonlPath);
  }

  /** Write pending records to disk. Creates the file/directory if needed. */
  save(): void {
    if (this._pendingRecords.length === 0) return;

    const dir = dirname(this.jsonlPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const data = this._pendingRecords.map(r => serializeRecord(r) + '\n').join('');

    if (this._fileExists) {
      appendFileSync(this.jsonlPath, data, 'utf-8');
    } else {
      writeFileSync(this.jsonlPath, data, 'utf-8');
      this._fileExists = true;
    }

    this._records.push(...this._pendingRecords);
    this._pendingRecords = [];
  }
}

const TRANSCRIPT_TYPES = new Set(['user', 'assistant', 'attachment', 'system']);

/** The epoch ms Claude Code compares when choosing where to resume, or
 *  -Infinity for a record it never resumes from: it considers only transcript
 *  types, and a timestamp that does not parse never wins. */
function resumeTimestamp(record: JsonlRecord): number {
  if (!TRANSCRIPT_TYPES.has(record.type)) return -Infinity;
  const t = Date.parse((record as BaseRecordFields).timestamp);
  return Number.isNaN(t) ? -Infinity : t;
}

/**
 * Delete a session's JSONL file and its companion directory (which CC v2.1.x
 * uses for subagents/ and tool-results/). Safe to call when nothing exists.
 */
function removeSessionFiles(jsonlPath: string): void {
  rmSync(jsonlPath, { force: true });
  const companionDir = jsonlPath.endsWith('.jsonl')
    ? jsonlPath.slice(0, -'.jsonl'.length)
    : jsonlPath;
  rmSync(companionDir, { recursive: true, force: true });
}

/** Delete a session by ID without needing an open Session instance. */
export function deleteSession(
  sessionId: string,
  projectPath: string,
  claudeDir?: string,
): void {
  const normalized = normalizeProjectPath(projectPath);
  const jsonlPath = getSessionPath(sessionId, normalized, claudeDir);
  removeSessionFiles(jsonlPath);
}

/** Create a new empty session. */
export function createSession(opts: CreateSessionOptions): Session {
  const sessionId = opts.sessionId ?? randomUUID();
  // Normalize once: realpath + NFC, matching CC's own bootstrap behavior.
  // Used for both the on-disk hash directory AND the per-record `cwd` field
  // so resumed sessions read back consistently with CC's runtime state.
  const projectPath = normalizeProjectPath(opts.projectPath);
  const jsonlPath = getSessionPath(sessionId, projectPath, opts.claudeDir);
  return new Session({
    sessionId,
    projectPath,
    jsonlPath,
    cwd: opts.cwd ? normalizeProjectPath(opts.cwd) : projectPath,
    version: opts.version,
    gitBranch: opts.gitBranch,
    model: opts.model,
  });
}

/** Open an existing session by ID. */
export function openSession(opts: OpenSessionOptions): Session {
  const projectPath = normalizeProjectPath(opts.projectPath);
  const jsonlPath = getSessionPath(opts.sessionId, projectPath, opts.claudeDir);
  return readSession(jsonlPath, projectPath);
}

/** Read a session from a JSONL file path. */
export function readSession(jsonlPath: string, projectPath?: string): Session {
  const records = parseJsonlFile(jsonlPath);

  // Extract session metadata from the first user/assistant record
  const firstMsg = records.find(r => r.type === 'user' || r.type === 'assistant') as
    | UserRecord | AssistantRecord | undefined;

  const sessionId = firstMsg?.sessionId ?? '';
  const resolvedProjectPath = projectPath ?? firstMsg?.cwd ?? '';

  return new Session({
    sessionId,
    projectPath: resolvedProjectPath,
    jsonlPath,
    slug: firstMsg?.slug,
    cwd: firstMsg?.cwd,
    version: firstMsg?.version,
    gitBranch: firstMsg?.gitBranch,
    records,
    fileExists: true,
  });
}
