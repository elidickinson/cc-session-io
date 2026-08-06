# Changelog

## 0.4.0

- Attachment record support. Claude Code writes its injected context — an
  `@file` expansion, a skill listing, a task reminder — as a `type: "attachment"`
  record rather than as part of a message. Reads already preserved them through
  `UnknownRecord`, but there was no way to work with one. Adds the
  `AttachmentRecord` type, a `session.attachments` accessor, and
  `session.addAttachment(attachment, opts?)`, which mints a fresh uuid and fills
  in the session's identity while leaving `parentUuid` under the caller's
  control — needed when carrying a record into a session where the message it
  belongs to has been given a new uuid. An attachment does not advance the
  message chain, matching how Claude Code writes them.
- `session.dangerousAppendRecord(record, opts?)` appends a record verbatim, for
  record types this library does not model and for carrying records between
  sessions. It synthesizes nothing — the typed helpers stay message- and
  attachment-only, since `queue-operation` and `last-prompt` share almost none of
  the base fields and stamping those on would produce records Claude Code never
  writes. It overwrites `sessionId` and rejects a dangling `parentUuid`, which is
  the failure that otherwise resumes with empty context and answers from nothing.
- README gains a Scope section stating what the library reads and writes, what
  it preserves without being able to author, and what it does not handle.

## 0.3.2

- Fix `importMessages()` dropping user content blocks. Images were discarded
  when they accompanied text, an image-only message was stringified into the
  transcript as prose, and anything alongside a `tool_result` was lost —
  including the user's whole message when `repairToolPairing()` injected a
  synthetic result into it. Blocks are now written through unchanged.
- `addUserMessage()` takes user content blocks as well as a string, typed by
  the new `UserContentBlock` export, and throws on an empty array.

## 0.3.0

- Add `repairToolPairing()` — fixes orphaned/missing `tool_use`/`tool_result`
  pairs in Anthropic-format message arrays. Injects synthetic error results for
  missing tool results, drops orphan tool results with no matching tool use, and
  handles consecutive assistant messages.
- `importMessages()` now calls `repairToolPairing()` automatically, so callers
  no longer need to pre-process messages before importing.

## 0.2.0

- Add `Session.clear()` to reset an open session to empty state, deleting its
  on-disk JSONL file and the companion directory that Claude Code v2.1.x uses
  for `subagents/` and `tool-results/`. The `sessionId` and `jsonlPath` are
  preserved so subsequent writes reuse them.
- Add `deleteSession(sessionId, projectPath, claudeDir?)` standalone export for
  removing a session's files without opening it first. No-op when the file
  doesn't exist.

## 0.1.2

- Fix `findProjectDir()` `rawSanitized` length check, use `stat()` for
  existence, export `MAX_SANITIZED_LENGTH`, correct JSDoc (djb2 not Java
  hashCode).

## 0.1.1

- `findProjectDir()` with Bun/Node hash mismatch fallback.
- Add `resolveSessionPath()` async resolver.
