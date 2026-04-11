# Claude Code Session Internals

**April 11, 2026**

Items marked ❓ indicate unconfirmed assumptions. ⚠️ marks important caveats and edge cases.

## Storage Locations

All under `~/.claude/`:

| Path | Format | Purpose | Required for `--resume`? |
|------|--------|---------|----|
| `projects/<path-hash>/<sessionId>.jsonl` | JSONL | Per-session conversation log | Yes — this alone is sufficient |
| `projects/<path-hash>/sessions-index.json` | JSON | Session metadata index | No — CC finds sessions by scanning JSONL files |
| `__store.db` | SQLite 3 | Costs, summaries, message metadata | No — not used for session resume |
| `sessions/*.json` | JSON | Currently-running session PIDs | ❓ Not tested |

The **path hash** replaces all non-alphanumeric characters in the project path with dashes. Long paths (>200 chars) are truncated to 200 characters with a hash suffix. Typically starts with `-` because absolute paths begin with `/` which gets replaced.

Example: `/Users/esd/projects/cc-session` → `-Users-esd-projects-cc-session`

**⚠️ Runtime dependency:** The hash function differs between runtimes:
- **Bun:** Uses `Bun.hash()` (wyhash algorithm)
- **Node.js:** Uses `djb2Hash()` (djb2 algorithm)

**For paths ≤200 characters** (the common case): No hash is involved — both runtimes produce identical directory names.

**For paths >200 characters**: Different hash functions produce different suffixes for the same project path. The `findProjectDir()` function in `src/utils/sessionStoragePortable.ts` handles this on the read path (resume) with prefix scanning, but:
- **cc-session-io does NOT have this fallback** — it could fail to find directories created by Bun for long paths
- Libraries that create sessions should use `djb2Hash` unconditionally for maximum compatibility

## JSONL Structure

Each line is one JSON event. Messages form a singly-linked list via `uuid`/`parentUuid`.

### Record Types

Sessions start with either `queue-operation` pairs or `file-history-snapshot` — varies across sessions. Neither is required for resume.

**⚠️ Legacy compatibility:** Old session files may contain `progress` entries in the UUID chain due to historical bug (#14373, #23537). These are now filtered out during resume to prevent chain forks.

**Note:** `compact_boundary` is a subtype of `system` messages, not a top-level type (format: `{"type":"system","subtype":"compact_boundary"}`). On resume for files >5MB, `readTranscriptForLoad()` scans for the boundary marker and **discards all pre-boundary content**. The `parentUuid` is set to `null` at the boundary (logical parent preserved in `logicalParentUuid`).

**⚠️ Critical:** `content-replacement` entries record large content blocks that were replaced with smaller stubs in the transcript to manage file size. These stubs are re-inflated on resume for **prompt cache stability** — without this feature, resumed sessions would invalidate the Anthropic API's prompt cache, significantly increasing token costs.

| Type | Purpose | Frequency |
|------|---------|-----------|
| `user` | User message or tool results | Every session |
| `assistant` | Assistant response (full API response body) | Every session |
| `attachment` | System messages (attachments, notifications) | Varies |
| `system` | System events including compact_boundary | Varies |
| `queue-operation` | Enqueue/dequeue bookends | Most sessions, but not all |
| `file-history-snapshot` | File state at message time | Most sessions, but not all |
| `progress` | Subagent activity updates | Still written but filtered from chain |
| `last-prompt` | Last user prompt text | Session end |
| `custom-title` | User-set session title | Renamed sessions |
| `ai-title` | AI-generated session title | Some sessions |
| `tag` | Searchable session tags | Tagged sessions |
| `agent-name` | Agent name | Named agents |
| `agent-color` | Agent UI color | Named agents |
| `agent-setting` | Agent definition used | Named agents |
| `summary` | Conversation summaries | Long sessions |
| `task-summary` | Periodic agent activity summaries | Active sessions |
| `mode` | coordinator/normal mode marker | Swarm sessions |
| `worktree-state` | Git worktree tracking | Worktree sessions |
| `content-replacement` | Large content block stub references | Large sessions |
| `attribution-snapshot` | Character-level contribution tracking | Some sessions |
| `pr-link` | GitHub PR association | Linked sessions |
| `speculation-accept` | Speculative execution timing | Proactive mode |
| `marble-origami-commit` | Context collapse commits | Gate-enabled |
| `marble-origami-snapshot` | Context collapse state | Gate-enabled |

### Shared Fields on User/Assistant Records

```
uuid            — UUID v4, primary key for this record
parentUuid      — UUID of the previous record (null for first message)
sessionId       — UUID of the session
timestamp       — ISO 8601 string (e.g. "2026-03-25T20:24:47.796Z")
type            — "user" or "assistant"
isSidechain     — boolean
cwd             — absolute path to working directory
userType        — always "external" in observed data
version         — Claude Code version (e.g. "2.1.83")
gitBranch       — branch name (e.g. "main", "HEAD")
slug            — session slug (e.g. "precious-prancing-kettle")
entrypoint      — always "cli" in observed data
message         — the message payload (see below)
```

**Minimum fields for successful resume** ⚠️

The resume path (`loadTranscriptFile()` → `buildConversationChain()` → `removeExtraFields()`) does no schema validation. It dispatches on `entry.type`, keys a Map on `entry.uuid`, and walks `entry.parentUuid`.

**Chain reconstruction** (what's needed for loading):
- `type` — must be one of `user`, `assistant`, `attachment`, or `system`
- `uuid` — used as map key and for parent-child linking
- `parentUuid` — for chain walking (null is valid for first message)

**Message display** (what's needed to be useful):
- `message` — the actual content payload

**All other fields** (`timestamp`, `sessionId`, `cwd`, `version`, `isSidechain`, etc.) are accessed downstream but the code degrades gracefully. Missing boolean fields default to falsy due to JavaScript's `undefined` semantics.

Synthetic sessions with `type`, `uuid`, `parentUuid`, `sessionId`, `timestamp`, `message` resume successfully. Fallback values are provided for missing metadata fields (e.g., `firstPrompt` defaults to "(session)").

### User-Specific Fields

```
promptId        — UUID, groups related messages in a prompt cycle
permissionMode  — e.g. "default", "bypassPermissions"
isMeta          — boolean, marks internal/meta messages (e.g. slash commands)
```

**User message payload:** `{ role: "user", content: string | ContentBlock[] }`

When content is a string, it's a plain text message. When it's an array, it typically contains `tool_result` blocks:

```json
{ "role": "user", "content": [
  { "type": "tool_result", "tool_use_id": "toolu_abc", "content": "file contents..." }
]}
```

### Assistant-Specific Fields

```
requestId       — Anthropic API request ID (e.g. "req_011CZQ...")
```

**Assistant message payload** is the full Anthropic API response body:

```json
{
  "id": "msg_01LcECs...",
  "type": "message",
  "role": "assistant",
  "model": "claude-opus-4-6",
  "content": [
    { "type": "thinking", "thinking": "", "signature": "..." },
    { "type": "text", "text": "..." },
    { "type": "tool_use", "id": "toolu_abc", "name": "Read", "input": { "file_path": "/foo" } }
  ],
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "usage": { "input_tokens": 100, "output_tokens": 50 }
}
```

### Tool Use Round-Trip

Synthetic tool use/result pairs work correctly on resume:

1. Assistant record with `tool_use` content block (`stop_reason: "tool_use"`)
2. User record with `tool_result` content block (matching `tool_use_id`)
3. Next assistant record with the response

### Example JSONL

```jsonl
{"type":"user","uuid":"aaa","parentUuid":null,"sessionId":"...","timestamp":"...","isSidechain":false,"cwd":"/path","userType":"external","version":"2.1.83","gitBranch":"main","slug":"precious-prancing-kettle","entrypoint":"cli","message":{"role":"user","content":"hello"}}
{"type":"assistant","uuid":"bbb","parentUuid":"aaa","sessionId":"...","timestamp":"...","isSidechain":false,"cwd":"/path","userType":"external","version":"2.1.83","gitBranch":"main","slug":"precious-prancing-kettle","entrypoint":"cli","message":{"id":"msg_01...","type":"message","role":"assistant","model":"claude-opus-4-6","content":[{"type":"text","text":"hi"}],"stop_reason":"end_turn","stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":5}}}
```

## SQLite Schema (`__store.db`)

**Not required for resume** — No references to `__store.db` or SQLite storage in the session resume path. All session persistence uses JSONL format only.

This file appears to serve analytics/UI features (cost tracking, cross-project queries) for the IDE/bridge components, not the CLI session resume path.

- **base_messages** — uuid (PK), parent_uuid, session_id, timestamp (int ms), message_type, cwd, user_type, version, isSidechain (int 0/1), original_cwd
- **user_messages** — uuid (FK), message (JSON), tool_use_result (JSON), timestamp (int), is_at_mention_read, is_meta
- **assistant_messages** — uuid (FK), message (JSON), cost_usd (real), duration_ms (int), model (text), is_api_error_message (int 0/1), timestamp (int)
- **conversation_summaries** — leaf_uuid (FK), summary, updated_at

## Session Index (`sessions-index.json`)

**Not required for resume** — No references to `sessions-index`, `sessionsIndex`, or `session-index` in the CLI source tree. Session discovery is purely `readdir()` + `stat()` of `.jsonl` files.

Projects with active sessions can have no index file at all. The CLI does not read or write this file; it may be maintained by other Claude Code clients (VS Code extension, web app).

```json
{
  "version": 1,
  "entries": [{
    "sessionId": "uuid-here",
    "fullPath": "/absolute/path/to/sessionId.jsonl",
    "fileMtime": 1774466341011,
    "firstPrompt": "first user message text...",
    "summary": "AI-generated summary",
    "messageCount": 12,
    "created": "2026-03-25T19:19:25.713Z",
    "modified": "2026-03-25T19:19:45.018Z",
    "gitBranch": "main",
    "projectPath": "/Users/you/project",
    "isSidechain": false
  }]
}
```

## Integrity

None. No signatures, checksums, HMACs, or server-side tracking. The API is stateless — on resume, Claude Code replays stored messages locally to rebuild context. Files are plain text you own and can freely edit.

## Generating Sessions from Scratch

A minimal resumable session requires **only a JSONL file** in the correct project directory. Neither `sessions-index.json` entries nor `__store.db` rows are needed.

### Minimum Viable JSONL

Tested successfully with just these fields per record:

```jsonl
{"type":"user","uuid":"<uuid>","parentUuid":null,"sessionId":"<session-uuid>","timestamp":"<ISO 8601>","message":{"role":"user","content":"hello"}}
{"type":"assistant","uuid":"<uuid>","parentUuid":"<user-uuid>","sessionId":"<session-uuid>","timestamp":"<ISO 8601>","message":{"id":"msg_syn","type":"message","role":"assistant","model":"claude-opus-4-6","content":[{"type":"text","text":"hi"}],"stop_reason":"end_turn","stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":5}}}
```

No `queue-operation` bookends, `file-history-snapshot`, `cwd`, `version`, `isSidechain`, `slug`, or any other fields required.

### What's Not Required

- `queue-operation` enqueue/dequeue pairs — not needed
- `file-history-snapshot` — not needed
- `sessions-index.json` entry — not needed for CLI resume
- `__store.db` rows — not needed (SQLite not used for session storage)
- Fields: `cwd`, `isSidechain`, `version`, `userType`, `gitBranch`, `slug`, `entrypoint`, `permissionMode`, `promptId` — all optional (resume provides fallbacks or ignores)

### UUID Chain

The uuid chain is trivial: each message's `parentUuid` = previous message's `uuid`. First message has `parentUuid: null`.

### Tool Use Mapping

Tool use/result round-trips work in synthetic sessions. The pattern:
1. Assistant message with `tool_use` content block and `stop_reason: "tool_use"`
2. User message with `tool_result` content block referencing the same `tool_use_id`

The ecosystem is primarily read/visualize tools. cc-session-io is a session generator that can create resumable sessions from scratch.

## Related Projects

### Reverse Engineering & Documentation

- **[Kir Shatrov — "Reverse engineering Claude Code"](https://kirshatrov.com/posts/claude-code-internals)** — Analyzes Claude Code internals including session format and how the CLI orchestrates API calls.
- **[Reid Barber — "Reverse engineering Claude Code"](https://www.reidbarber.com/blog/reverse-engineering-claude-code)** — Independent analysis of the architecture, tool dispatch, and session handling.
- **[Jesse Vincent — "How Claude Code Session Continuation Works"](https://blog.fsck.com/releases/2026/02/22/claude-code-session-continuation/)** — Detailed documentation of JSONL records, parent-child chaining, `compact_boundary` records, and session ID switching.
- **[Yi Huang — "Inside Claude Code: The Session File Format"](https://databunny.medium.com/inside-claude-code-the-session-file-format-and-how-to-inspect-it-b9998e66d56b)** — Medium walkthrough of the JSONL structure and field meanings.
- **[Yuyz0112/claude-code-reverse](https://github.com/Yuyz0112/claude-code-reverse)** — Monkey-patches the Anthropic SDK inside Claude Code's bundled `cli.js` to capture and visualize all LLM API interactions. Includes a log parser and visualization tool.
- **[Sabrina Ramonov — "Reverse-Engineering Claude Code Using Sub Agents"](https://www.sabrina.dev/p/reverse-engineering-claude-code-using)** — Focuses on the sub-agent architecture and how agents spawn/communicate.

### Session Editors & Viewers

- **[yuis-ice/claude-code-jsonl-editor](https://github.com/yuis-ice/claude-code-jsonl-editor)** — Interactive editor for JSONL session files with real-time filesystem sync. Closest thing to manual session creation.
- **[simonw/claude-code-transcripts](https://github.com/simonw/claude-code-transcripts)** — Converts JSONL/JSON sessions to readable HTML.
- **[withLinda/claude-JSONL-browser](https://github.com/withLinda/claude-JSONL-browser)** — Web-based JSONL-to-Markdown converter.
- **[daaain/claude-code-log](https://github.com/daaain/claude-code-log)** — Python CLI for converting sessions to HTML/Markdown.
- **[annenpolka/cclog](https://github.com/annenpolka/cclog)** — TUI-based session viewer with Markdown output.

### Session Orchestration

- **[obra/claude-session-driver](https://github.com/obra/claude-session-driver)** — Jesse Vincent's tool for launching and controlling Claude Code worker sessions via tmux. Creates real sessions through the CLI (not synthetic files), supports fan-out, pipeline, and supervision patterns.
- **[KyleAMathews/claude-code-ui](https://github.com/KyleAMathews/claude-code-ui)** — Session tracker with a `spec.md` documenting mock session file creation, showing the minimal viable JSONL structure.

### Relevant GitHub Issues

- **[#21536 — Synthetic Response Injection](https://github.com/anthropics/claude-code/issues/21536)** — Feature request to let hooks return synthetic responses without API calls. Closed as "not planned."
- **[#24947 — `claude inject`](https://github.com/anthropics/claude-code/issues/24947)** — Request to send prompts to running sessions programmatically. Open, not implemented.
