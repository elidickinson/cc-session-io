# Changelog

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
