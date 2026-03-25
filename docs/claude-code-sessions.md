# Claude Code Session Internals

Tested against Claude Code **2.1.83** (March 2026). Items marked ✅ were confirmed through direct experimentation; ❓ marks unconfirmed assumptions.

## Storage Locations

All under `~/.claude/`:

| Path | Format | Purpose | Required for `--resume`? |
|------|--------|---------|----|
| `projects/-<path-hash>/<sessionId>.jsonl` | JSONL | Per-session conversation log | ✅ Yes — this alone is sufficient |
| `projects/-<path-hash>/sessions-index.json` | JSON | Session metadata index | ✅ No — CC finds sessions by scanning JSONL files |
| `__store.db` | SQLite 3 | Costs, summaries, message metadata | ✅ No — verified zero rows for active sessions |
| `sessions/*.json` | JSON | Currently-running session PIDs | ❓ Not tested |

The **path hash** is the project's absolute path with `/` replaced by `-`, prefixed with `-`. ✅ Confirmed: `/Users/esd/projects/cc-session` → `-Users-esd-projects-cc-session`.

## JSONL Structure

Each line is one JSON event. Messages form a singly-linked list via `uuid`/`parentUuid`.

### Record Types

Sessions start with either `queue-operation` pairs or `file-history-snapshot` — varies across sessions. ✅ Confirmed neither is required for resume.

| Type | Purpose | Frequency |
|------|---------|-----------|
| `user` | User message or tool results | Every session |
| `assistant` | Assistant response (full API response body) | Every session |
| `queue-operation` | Enqueue/dequeue bookends | ✅ Most sessions, but not all |
| `file-history-snapshot` | File state at message time | ✅ Most sessions, but not all |
| `progress` | Subagent activity updates | Sessions with subagents |
| `compact_boundary` | Context compression points | ❓ Long sessions |
| `last-prompt` | Last user prompt text | ❓ Session end |
| `custom-title` | User-set session title | ❓ Renamed sessions |
| `agent-name` | Agent name | ❓ Named agents |

### Shared Fields on User/Assistant Records

All fields verified against real session files ✅:

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

**Minimum fields required for resume** ✅ (confirmed by creating synthetic sessions with only these):
`type`, `uuid`, `parentUuid`, `sessionId`, `timestamp`, `message`

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

**Assistant message payload** is the full Anthropic API response body ✅:

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

### Tool Use Round-Trip ✅

Confirmed that synthetic tool use/result pairs work correctly on resume:

1. Assistant record with `tool_use` content block (`stop_reason: "tool_use"`)
2. User record with `tool_result` content block (matching `tool_use_id`)
3. Next assistant record with the response

### Example JSONL

```jsonl
{"type":"user","uuid":"aaa","parentUuid":null,"sessionId":"...","timestamp":"...","isSidechain":false,"cwd":"/path","userType":"external","version":"2.1.83","gitBranch":"main","slug":"precious-prancing-kettle","entrypoint":"cli","message":{"role":"user","content":"hello"}}
{"type":"assistant","uuid":"bbb","parentUuid":"aaa","sessionId":"...","timestamp":"...","isSidechain":false,"cwd":"/path","userType":"external","version":"2.1.83","gitBranch":"main","slug":"precious-prancing-kettle","entrypoint":"cli","message":{"id":"msg_01...","type":"message","role":"assistant","model":"claude-opus-4-6","content":[{"type":"text","text":"hi"}],"stop_reason":"end_turn","stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":5}}}
```

## SQLite Schema (`__store.db`)

✅ Not required for resume. Verified that active sessions have zero rows in the DB.
Appears to serve analytics/UI features (cost tracking, cross-project queries) rather than session replay.

Schema verified against real DB ✅:

- **base_messages** — uuid (PK), parent_uuid, session_id, timestamp (int ms), message_type, cwd, user_type, version, isSidechain (int 0/1), original_cwd
- **user_messages** — uuid (FK), message (JSON), tool_use_result (JSON), timestamp (int), is_at_mention_read, is_meta
- **assistant_messages** — uuid (FK), message (JSON), cost_usd (real), duration_ms (int), model (text), is_api_error_message (int 0/1), timestamp (int)
- **conversation_summaries** — leaf_uuid (FK), summary, updated_at

## Session Index (`sessions-index.json`)

✅ Not required for resume. CC finds sessions by scanning JSONL files directly.
Projects with active sessions can have no index file at all (confirmed).
❓ May speed up the `--resume` picker for projects with many sessions.

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

✅ A minimal resumable session requires **only a JSONL file** in the correct project directory.

Previously assumed to require all three artifacts (JSONL + session index + SQLite). Direct testing confirmed that only the JSONL file is needed. Neither `sessions-index.json` entries nor `__store.db` rows are required for `claude --resume <session-id>`.

### Minimum Viable JSONL ✅

Tested successfully with just these fields per record:

```jsonl
{"type":"user","uuid":"<uuid>","parentUuid":null,"sessionId":"<session-uuid>","timestamp":"<ISO 8601>","message":{"role":"user","content":"hello"}}
{"type":"assistant","uuid":"<uuid>","parentUuid":"<user-uuid>","sessionId":"<session-uuid>","timestamp":"<ISO 8601>","message":{"id":"msg_syn","type":"message","role":"assistant","model":"claude-opus-4-6","content":[{"type":"text","text":"hi"}],"stop_reason":"end_turn","stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":5}}}
```

No `queue-operation` bookends, `file-history-snapshot`, `cwd`, `version`, `isSidechain`, `slug`, or any other fields required. ✅ Confirmed by resume test.

### What's Not Required ✅

- `queue-operation` enqueue/dequeue pairs — not needed
- `file-history-snapshot` — not needed
- `sessions-index.json` entry — not needed
- `__store.db` rows — not needed
- Fields: `cwd`, `isSidechain`, `version`, `userType`, `gitBranch`, `slug`, `entrypoint`, `permissionMode`, `promptId` — all optional

### UUID Chain

The uuid chain is trivial: each message's `parentUuid` = previous message's `uuid`. First message has `parentUuid: null`.

### Tool Use Mapping ✅

Tool use/result round-trips work in synthetic sessions. The pattern:
1. Assistant message with `tool_use` content block and `stop_reason: "tool_use"`
2. User message with `tool_result` content block referencing the same `tool_use_id`

No one has built a session generator or cross-agent converter yet. The ecosystem is all read/visualize.

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
