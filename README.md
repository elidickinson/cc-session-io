# cc-session-io

Read, write, and create Claude Code session files. Zero runtime dependencies.

Create synthetic sessions that work with `claude --resume`, or read/append to existing ones. Useful for importing conversation history from other coding agents into Claude Code.

## Install

```
npm install cc-session-io
```

Requires Node >= 20.

## Quick Start

```typescript
import { createSession, openSession } from 'cc-session-io';

// Create a session and add a conversation
const session = createSession({ projectPath: '/path/to/project' });
session.addUserMessage('Refactor the auth module');
session.addAssistantMessage([{ type: 'text', text: 'I will refactor the auth module.' }]);
session.save();

// Resume it in Claude Code
// $ claude --resume <session.sessionId>
```

## API

### `createSession(opts): Session`

Creates a new session. Generates a UUID session ID and resolves the JSONL path.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `projectPath` | `string` | *required* | Absolute path to the project. Determines where the JSONL file is written. |
| `claudeDir` | `string?` | `~/.claude` | Override the Claude config directory. |
| `cwd` | `string?` | `projectPath` | Working directory written into records. |
| `gitBranch` | `string?` | `"HEAD"` | Git branch name written into records. |
| `version` | `string?` | `"2.1.83"` | Claude Code version to claim. |
| `model` | `string?` | `"claude-sonnet-4-6"` | Default model for assistant messages. |

### `openSession(opts): Session`

Opens an existing session by ID for reading or appending.

| Option | Type | Description |
|--------|------|-------------|
| `sessionId` | `string` | UUID of the session. |
| `projectPath` | `string` | Absolute path to the project. |
| `claudeDir` | `string?` | Override the Claude config directory. |

### `readSession(jsonlPath, projectPath?): Session`

Reads a session directly from a JSONL file path.

### `Session`

#### Properties

| Property | Type | Description |
|----------|------|-------------|
| `sessionId` | `string` | UUID of the session. |
| `projectPath` | `string` | Project path. |
| `jsonlPath` | `string` | Absolute path to the JSONL file. |
| `records` | `JsonlRecord[]` | All JSONL records (including non-message types). |
| `messages` | `(UserRecord \| AssistantRecord)[]` | Only user and assistant records. |

#### `session.addUserMessage(text): string`

Adds a user text message. Returns the record's UUID.

#### `session.addAssistantMessage(content, opts?): string`

Adds an assistant message with the given content blocks. Returns the record's UUID.

```typescript
session.addAssistantMessage([{ type: 'text', text: 'Hello!' }]);

session.addAssistantMessage(
  [{ type: 'text', text: 'Done.' }],
  { model: 'claude-opus-4-6' },
);
```

| Option | Type | Default |
|--------|------|---------|
| `model` | `string?` | Session default model |
| `stopReason` | `string?` | Auto-detected: `"tool_use"` if content has tool_use blocks, `"end_turn"` otherwise |

#### `session.addToolResults(results): string`

Adds a user message containing tool results. For manual tool use construction.

```typescript
session.addToolResults([
  { toolUseId: 'toolu_abc', content: 'file contents here' },
  { toolUseId: 'toolu_def', content: 'command output', isError: true },
]);
```

#### `session.addToolCalls(calls, opts?): void`

Convenience method that creates the full tool call round-trip: assistant `tool_use` message, user `tool_result` message, and optionally a final assistant response.

```typescript
// Single tool call with response
session.addToolCalls(
  [{ name: 'Read', input: { file_path: '/foo.ts' }, result: 'file contents' }],
  { response: [{ type: 'text', text: 'I read the file.' }] },
);

// Multiple parallel tool calls
session.addToolCalls([
  { name: 'Read', input: { file_path: '/foo.ts' }, result: 'contents of foo' },
  { name: 'Bash', input: { command: 'ls' }, result: 'README.md\nsrc/' },
], { response: [{ type: 'text', text: 'I read the file and listed the directory.' }] });

// Tool call without a follow-up response (leaves the turn open)
session.addToolCalls([
  { name: 'Bash', input: { command: 'npm test' }, result: 'all tests passed' },
]);
```

| `ToolCallSpec` field | Type | Description |
|---------------------|------|-------------|
| `name` | `string` | Tool name (e.g. `"Read"`, `"Bash"`, `"Edit"`) |
| `input` | `unknown` | Tool input parameters |
| `result` | `string \| ContentBlock[]` | Tool output |
| `isError` | `boolean?` | Whether the tool call errored |

#### `session.save(): void`

Writes all pending records to disk. Creates the JSONL file and parent directories if needed. Appends if the file already exists.

### Low-level JSONL utilities

```typescript
import { parseJsonl, parseJsonlFile, serializeRecord, serializeJsonl } from 'cc-session-io';

const records = parseJsonlFile('/path/to/session.jsonl');
const jsonlString = serializeJsonl(records);
```

### Path utilities

```typescript
import { projectPathToHash, getProjectDir, getSessionPath } from 'cc-session-io';

projectPathToHash('/Users/me/project');
// => '-Users-me-project'

getSessionPath('uuid-here', '/Users/me/project');
// => '/Users/me/.claude/projects/-Users-me-project/uuid-here.jsonl'
```

## How It Works

Claude Code stores sessions as JSONL files in `~/.claude/projects/-<path-hash>/`. Each line is a JSON record. User and assistant messages form a linked list via `uuid`/`parentUuid` fields.

This library writes JSONL files that match the real Claude Code format. On resume, Claude Code replays the stored messages to rebuild context. No SQLite database or session index is required — the JSONL file alone is sufficient.

See [`docs/claude-code-sessions.md`](docs/claude-code-sessions.md) for detailed format documentation and research findings.

## Testing

```
npm test          # unit + integration tests
npm run smoke     # end-to-end: creates a session, resumes with claude CLI
```
