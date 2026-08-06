# TODO

## Attachment records

Claude Code writes a first-class `attachment` record when it expands an `@file`
mention in a prompt, and again for a few other injected-context kinds. The library
has no concept of them: `src/types.ts` covers text/thinking/tool_use/tool_result/
image blocks and user/assistant/message records, and nothing else.

They do survive a read — `JsonlRecord` includes the open
`UnknownRecord { type: string; [key: string]: unknown }`, and `Session._records`
retains whatever `parseJsonlFile` produced — so a session read and written back
keeps them. What is missing is any way to *work* with one.

Shape, from a real session (`type: "attachment"`):

```json
{
  "parentUuid": "7843a1ce-…",
  "isSidechain": false,
  "attachment": {
    "type": "file",
    "filename": "/abs/path/game/build.js",
    "content": { "type": "text", "file": { "filePath": "…", "content": "<whole file>" } }
  },
  "type": "attachment",
  "uuid": "5a7d69a2-…",
  "timestamp": "…", "userType": "…", "entrypoint": "…",
  "cwd": "…", "sessionId": "…", "version": "…", "gitBranch": "…", "slug": "…"
}
```

Kinds seen in the wild, in rough order of frequency: `mcp_instructions_delta`,
`task_reminder`, `queued_command`, `skill_listing`, `agent_listing_delta`,
`deferred_tools_delta`, `edited_text_file`, `plan_mode_exit`, `date_change`,
`command_permissions`, `file`. Only `file` and `edited_text_file` carry content a
consumer cannot regenerate; the rest Claude Code rewrites every turn.

### Wanted

1. **A typed view.** An `AttachmentRecord` in the union and an accessor on `Session`,
   so a caller can enumerate attachments without hand-parsing `UnknownRecord`.
2. **Append with id rewriting.** A way to add an attachment to a session such that
   `uuid` is fresh and `sessionId`, `cwd`, `gitBranch` and `timestamp` match the
   target session, with `parentUuid` supplied by the caller. This is the piece that
   makes carrying attachments from one session into a rebuilt one possible at all.
3. **Decide what `importMessages` should do with them.** Today they are invisible to
   it. They are not messages, so folding them into the `Message[]` shape is probably
   wrong; a separate path is likely cleaner.

### Why

`pi-claude-code-acp` rebuilds a Claude Code session from pi's history whenever pi's
messages move out from under it (abort, compaction, tree navigation, a clean API
error). pi never sees CC's attachments, so every rebuild drops them and the model
silently loses a file it was mid-way through reasoning about. That consumer wants to
copy the records forward from the previous session; it cannot express that today.
See `TODO.md` item 7 in that repo.

Note for whoever implements: `parentUuid` remapping is the consumer's problem, not
this library's — but the append API has to leave it under the caller's control for
the consumer to solve it at all.
