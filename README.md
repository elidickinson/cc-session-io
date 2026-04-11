# cc-session-io

Read, write, and create Claude Code session files.

Can create new session history files or read/write existing ones that will work with `/resume` in Claude Code. Useful for importing conversation history from another coding agent to continue it with `claude`.

No runtime dependencies. Not affiliated or supported by Anthropic, the makers of Claude Code.

## Install

```
npm install cc-session-io
```

Requires Node >= 20.

## Simple CLI Demo

```bash
# Create new session
cc-session create -p /my/project

# Add messages to session
cc-session add user "Hello!" -p /my/project -s <id>
cc-session add assistant "Hi, how can I help?" -p /my/project -s <id>

# Read conversation
cc-session read -p /my/project -s <id>

# List sessions
cc-session list -p /my/project
```

Options:
- `-p <path>` - Project path (required)
- `-s <id>` - Session ID (required for add/read)

## Quick Start

### Create a new session

```typescript
import { createSession } from 'cc-session-io';

const session = createSession({ projectPath: '/path/to/project' });
session.addUserMessage('Refactor the auth module');
session.addAssistantMessage([{ type: 'text', text: 'I will refactor the auth module.' }]);
session.save();

// Resume it: claude --resume <session.sessionId>
```

### Append to an existing session

```typescript
import { openSession } from 'cc-session-io';

const session = openSession({
  sessionId: 'existing-uuid-here',
  projectPath: '/path/to/project',
});

// Existing messages are available
console.log(`${session.messages.length} messages loaded`);

// Append new messages — they chain onto the last existing record
session.addUserMessage('One more thing...');
session.addAssistantMessage([{ type: 'text', text: 'Sure, what is it?' }]);
session.save(); // appends to the existing JSONL file
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

Adds an assistant message with the given content blocks. Returns the record's UUID. Content blocks are written as-is — any `tool_use` blocks you provide keep their original `id` values. (This matters when replaying real API responses; `addToolCalls()` generates IDs for you, but `addAssistantMessage()` does not.)

```typescript
session.addAssistantMessage([{ type: 'text', text: 'Hello!' }]);

session.addAssistantMessage(
  [{ type: 'text', text: 'Done.' }],
  { model: 'claude-opus-4-6' },
);

// Pass through real tool_use blocks with their original IDs
session.addAssistantMessage([
  { type: 'tool_use', id: 'toolu_01ABC...', name: 'Read', input: { file_path: '/foo' } },
]);
```

| Option | Type | Default |
|--------|------|---------|
| `model` | `string?` | Session default model |
| `stopReason` | `string?` | Auto-detected: `"tool_use"` if content has tool_use blocks, `"end_turn"` otherwise |

#### `session.addToolResults(results): string`

Adds a user message containing tool results. Each `toolUseId` must match the `id` of a `tool_use` block from the preceding assistant message — this is how Claude Code pairs requests with responses.

```typescript
// After an assistant message with tool_use blocks:
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

#### `session.importMessages(messages): void`

Bulk import an array of Anthropic API-shaped messages. Dispatches each to the right internal method based on role and content type. Useful when replaying API responses or syncing from another provider.

```typescript
session.importMessages([
  { role: 'user', content: 'Read the config file' },
  { role: 'assistant', content: [
    { type: 'tool_use', id: 'toolu_abc', name: 'Read', input: { file_path: '/config.json' } },
  ]},
  { role: 'user', content: [
    { type: 'tool_result', tool_use_id: 'toolu_abc', content: '{"port": 3000}' },
  ]},
  { role: 'assistant', content: [{ type: 'text', text: 'The config sets port to 3000.' }] },
]);
```

Dispatch rules:
- `assistant` → `addAssistantMessage()` (string content wrapped in a text block)
- `user` string → `addUserMessage()`
- `user` array with `tool_result` blocks → `addToolResults()`
- `user` array with only `text` blocks → `addUserMessage()` (text joined with newlines)

#### `session.save(): void`

Writes all pending records to disk. Creates the JSONL file and parent directories if needed. Appends if the file already exists.

### Session reuse and cleanup

#### `session.clear(): void`

Resets an open `Session` to empty state so the same `sessionId` can be reused with fresh contents. Wipes in-memory records, deletes the on-disk `.jsonl` file, and removes the companion directory (Claude Code v2.1.x writes `subagents/` and `tool-results/` there). After `clear()`, the next `save()` writes a fresh file rather than appending.

```typescript
session.clear();
session.addUserMessage('Start over');
session.save(); // writes a new file at the original jsonlPath
```

#### `deleteSession(sessionId, projectPath, claudeDir?): void`

Standalone export that deletes a session's `.jsonl` file and companion directory without needing to open it first. No-op if the file doesn't exist.

```typescript
import { deleteSession } from 'cc-session-io';

deleteSession('uuid-here', '/path/to/project');
```

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

## Content Block Format

All content blocks use the **Anthropic API format**. If you're coming from another agent framework, note the naming:

| This library (Anthropic API) | Other conventions |
|------------------------------|-------------------|
| `tool_use` | `toolCall`, `function_call` |
| `tool_result` | `toolResult`, `function_response` |
| `tool_use_id` | `toolCallId` |
| `stop_reason: "tool_use"` | `finish_reason: "function_call"` |

## How It Works

Claude Code stores sessions as JSONL files in `~/.claude/projects/-<path-hash>/`. Each line is a JSON record. User and assistant messages form a linked list via `uuid`/`parentUuid` fields.

This library writes JSONL files that match the real Claude Code format. On resume, Claude Code replays the stored messages to rebuild context. No SQLite database or session index is required — the JSONL file alone is sufficient.

### Path resolution

To place session files where Claude Code will actually find them, this library:

- Resolves `projectPath` via `realpathSync` + NFC normalization before hashing. Claude Code does the same in its bootstrap, so a caller passing `process.cwd()` from a shell that entered via a symlinked directory (common on macOS: `/tmp`, `/var`, user-symlinked project dirs) still writes to the symlink target's hash dir, matching where Claude Code reads from on resume. Falls back to NFC of the raw path when realpath fails.
- Honors `CLAUDE_CONFIG_DIR` env var, same as Claude Code — if set, `getClaudeDir()` returns that instead of `~/.claude`.
- Exposes `normalizeProjectPath()` for callers that want to apply the same normalization themselves.

### Known limitation: Bun/Node hash mismatch for long paths

For `projectPath` encodings longer than 200 characters, Claude Code appends a hash suffix. The hash algorithm differs by runtime: **Bun** uses `Bun.hash` (wyhash), **Node** uses djb2. The shipped Claude Code CLI typically runs under Bun, so a session written by a Node consumer of this library (which always uses djb2) lands in a different directory than the Bun-executed CLI looks in, producing "No conversation found with session ID" on resume.

Affected only when the encoded path exceeds 200 chars — roughly, a project path with deeply nested directories totalling over 200 characters of alphanumerics. Rare in practice but worth knowing.

Workarounds:

- Keep project paths shorter than ~200 characters (trivially satisfied by most real workspaces).
- Run the consumer under Bun, so `Bun.hash` is available and matches the CLI.
- `findProjectDir()` and `resolveSessionPath()` already apply a prefix-match fallback on *read* to find dirs produced by the other hash, so listing and resuming existing sessions works either way. Only fresh *writes* hit the mismatch.

### Minimum viable record

The library writes full-fidelity records with all fields, but Claude Code only requires these for resume:

```jsonl
{"type":"user","uuid":"<uuid>","parentUuid":null,"sessionId":"<uuid>","timestamp":"<ISO 8601>","message":{"role":"user","content":"hello"}}
{"type":"assistant","uuid":"<uuid>","parentUuid":"<user-uuid>","sessionId":"<uuid>","timestamp":"<ISO 8601>","message":{"id":"msg_...","type":"message","role":"assistant","model":"claude-sonnet-4-6","content":[{"type":"text","text":"hi"}],"stop_reason":"end_turn","stop_sequence":null,"usage":{"input_tokens":0,"output_tokens":0}}}
```

Everything else (`cwd`, `version`, `isSidechain`, `slug`, `entrypoint`, `gitBranch`, `userType`) is optional. See [`docs/claude-code-sessions.md`](docs/claude-code-sessions.md) for full format documentation and research findings.

## Testing

```
npm test          # unit + integration tests
npm run smoke     # end-to-end: creates a session, resumes with claude CLI
```
