interface TextBlock {
    type: 'text';
    text: string;
}
interface ThinkingBlock {
    type: 'thinking';
    thinking: string;
    signature: string;
}
interface ToolUseBlock {
    type: 'tool_use';
    id: string;
    name: string;
    input: unknown;
}
interface ToolResultBlock {
    type: 'tool_result';
    tool_use_id: string;
    content: string | ContentBlock[];
    is_error?: boolean;
}
type ContentBlock = TextBlock | ThinkingBlock | ToolUseBlock | ToolResultBlock;
interface AssistantMessagePayload {
    id: string;
    type: 'message';
    role: 'assistant';
    model: string;
    content: ContentBlock[];
    stop_reason: string | null;
    stop_sequence: string | null;
    usage?: {
        input_tokens: number;
        output_tokens: number;
    };
}
interface UserMessagePayload {
    role: 'user';
    content: string | ContentBlock[];
}
interface BaseRecordFields {
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
interface UserRecord extends BaseRecordFields {
    type: 'user';
    message: UserMessagePayload;
    promptId?: string;
    permissionMode?: string;
    isMeta?: boolean;
}
interface AssistantRecord extends BaseRecordFields {
    type: 'assistant';
    message: AssistantMessagePayload;
    requestId?: string;
}
interface UnknownRecord {
    type: string;
    [key: string]: unknown;
}
type JsonlRecord = UserRecord | AssistantRecord | UnknownRecord;
interface ToolCallSpec {
    name: string;
    input: unknown;
    result: string | ContentBlock[];
    isError?: boolean;
}
interface CreateSessionOptions {
    projectPath: string;
    claudeDir?: string;
    cwd?: string;
    gitBranch?: string;
    version?: string;
    model?: string;
    sessionId?: string;
}
interface OpenSessionOptions {
    sessionId: string;
    projectPath: string;
    claudeDir?: string;
}

declare class Session {
    readonly sessionId: string;
    readonly projectPath: string;
    readonly jsonlPath: string;
    private _records;
    private _pendingRecords;
    private _lastUuid;
    private _slug;
    private _cwd;
    private _version;
    private _gitBranch;
    private _model;
    private _fileExists;
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
    });
    /** All records (existing + pending). */
    get records(): readonly JsonlRecord[];
    /** Only user and assistant message records. */
    get messages(): readonly (UserRecord | AssistantRecord)[];
    private baseFields;
    /** Add a user text message. Returns its uuid. */
    addUserMessage(text: string): string;
    /** Add an assistant message with the given content blocks. Returns its uuid. */
    addAssistantMessage(content: ContentBlock[], opts?: {
        model?: string;
        stopReason?: string;
    }): string;
    /** Add a user message containing tool results. Returns its uuid. */
    addToolResults(results: {
        toolUseId: string;
        content: string | ContentBlock[];
        isError?: boolean;
    }[]): string;
    /**
     * Convenience: add a complete tool call round-trip.
     * Creates assistant tool_use message, user tool_result message,
     * and optionally a final assistant text response.
     */
    addToolCalls(calls: ToolCallSpec[], opts?: {
        response?: ContentBlock[];
        model?: string;
    }): void;
    /**
     * Import an array of Anthropic API-shaped messages, dispatching each to the
     * appropriate internal method based on role and content type.
     */
    importMessages(messages: {
        role: 'user' | 'assistant';
        content: string | ContentBlock[];
    }[]): void;
    /** Write pending records to disk. Creates the file/directory if needed. */
    save(): void;
}
/** Create a new empty session. */
declare function createSession(opts: CreateSessionOptions): Session;
/** Open an existing session by ID. */
declare function openSession(opts: OpenSessionOptions): Session;
/** Read a session from a JSONL file path. */
declare function readSession(jsonlPath: string, projectPath?: string): Session;

/** Parse a JSONL string into an array of records. */
declare function parseJsonl(content: string): JsonlRecord[];
/** Parse a JSONL file from disk. */
declare function parseJsonlFile(path: string): JsonlRecord[];
/** Serialize a single record to a JSON line (no trailing newline). */
declare function serializeRecord(record: JsonlRecord): string;
/** Serialize an array of records to a JSONL string. */
declare function serializeJsonl(records: JsonlRecord[]): string;

declare function getClaudeDir(claudeDir?: string): string;
/** Convert an absolute project path to the hash CC uses for directory names. */
declare function projectPathToHash(projectPath: string): string;
/** Get the project-specific directory under ~/.claude/projects/ */
declare function getProjectDir(projectPath: string, claudeDir?: string): string;
/** Get the JSONL file path for a session. */
declare function getSessionPath(sessionId: string, projectPath: string, claudeDir?: string): string;

export { type AssistantMessagePayload, type AssistantRecord, type BaseRecordFields, type ContentBlock, type CreateSessionOptions, type JsonlRecord, type OpenSessionOptions, Session, type TextBlock, type ThinkingBlock, type ToolCallSpec, type ToolResultBlock, type ToolUseBlock, type UnknownRecord, type UserMessagePayload, type UserRecord, createSession, getClaudeDir, getProjectDir, getSessionPath, openSession, parseJsonl, parseJsonlFile, projectPathToHash, readSession, serializeJsonl, serializeRecord };
