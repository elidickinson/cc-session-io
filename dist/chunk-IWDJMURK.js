// src/session.ts
import { randomUUID } from "crypto";
import { mkdirSync, writeFileSync, appendFileSync, existsSync } from "fs";
import { dirname } from "path";

// src/jsonl.ts
import { readFileSync } from "fs";
function parseJsonl(content) {
  return content.split("\n").filter((line) => line.trim()).map(parseRecord);
}
function parseJsonlFile(path) {
  return parseJsonl(readFileSync(path, "utf-8"));
}
function parseRecord(line) {
  const raw = JSON.parse(line);
  if (raw.type === "user") return raw;
  if (raw.type === "assistant") return raw;
  return raw;
}
function serializeRecord(record) {
  return JSON.stringify(record);
}
function serializeJsonl(records) {
  return records.map(serializeRecord).join("\n") + "\n";
}

// src/paths.ts
import { homedir } from "os";
import { join } from "path";
function getClaudeDir(claudeDir) {
  return claudeDir ?? join(homedir(), ".claude");
}
function projectPathToHash(projectPath) {
  return projectPath.replaceAll("/", "-");
}
function getProjectDir(projectPath, claudeDir) {
  return join(getClaudeDir(claudeDir), "projects", projectPathToHash(projectPath));
}
function getSessionPath(sessionId, projectPath, claudeDir) {
  return join(getProjectDir(projectPath, claudeDir), `${sessionId}.jsonl`);
}

// src/session.ts
var ADJECTIVES = [
  "ancient",
  "bold",
  "bright",
  "calm",
  "clever",
  "cool",
  "crimson",
  "daring",
  "eager",
  "fast",
  "fierce",
  "gentle",
  "golden",
  "happy",
  "hidden",
  "iron",
  "keen",
  "lively",
  "mighty",
  "nimble",
  "pale",
  "proud",
  "quick",
  "rapid",
  "sharp",
  "silent",
  "smooth",
  "steady",
  "swift",
  "vivid",
  "warm",
  "wild"
];
var NOUNS = [
  "arrow",
  "badge",
  "beacon",
  "blade",
  "brook",
  "castle",
  "cedar",
  "cloud",
  "comet",
  "crest",
  "dawn",
  "drift",
  "eagle",
  "ember",
  "falcon",
  "flame",
  "forge",
  "gale",
  "grove",
  "harbor",
  "hawk",
  "jade",
  "kettle",
  "lance",
  "maple",
  "marsh",
  "needle",
  "oak",
  "pearl",
  "pine",
  "ridge",
  "river",
  "rune",
  "sage",
  "shade",
  "spark",
  "stone",
  "thorn",
  "tower",
  "wave"
];
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function generateSlug() {
  return `${pick(ADJECTIVES)}-${pick(ADJECTIVES)}-${pick(NOUNS)}`;
}
function syntheticMessageId() {
  return `msg_syn_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
}
function syntheticRequestId() {
  return `req_syn_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
}
var Session = class {
  sessionId;
  projectPath;
  jsonlPath;
  _records = [];
  _pendingRecords = [];
  _lastUuid = null;
  _slug;
  _cwd;
  _version;
  _gitBranch;
  _model;
  _fileExists;
  constructor(opts) {
    this.sessionId = opts.sessionId;
    this.projectPath = opts.projectPath;
    this.jsonlPath = opts.jsonlPath;
    this._slug = opts.slug ?? generateSlug();
    this._cwd = opts.cwd ?? opts.projectPath;
    this._version = opts.version ?? "2.1.83";
    this._gitBranch = opts.gitBranch ?? "HEAD";
    this._model = opts.model ?? "claude-sonnet-4-6";
    this._records = opts.records ?? [];
    this._fileExists = opts.fileExists ?? false;
    for (let i = this._records.length - 1; i >= 0; i--) {
      const r = this._records[i];
      if (r.type === "user" || r.type === "assistant") {
        this._lastUuid = r.uuid;
        break;
      }
    }
  }
  /** All records (existing + pending). */
  get records() {
    return [...this._records, ...this._pendingRecords];
  }
  /** Only user and assistant message records. */
  get messages() {
    return this.records.filter(
      (r) => r.type === "user" || r.type === "assistant"
    );
  }
  baseFields() {
    const uuid = randomUUID();
    const record = {
      uuid,
      parentUuid: this._lastUuid,
      sessionId: this.sessionId,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      isSidechain: false,
      cwd: this._cwd,
      userType: "external",
      version: this._version,
      gitBranch: this._gitBranch,
      slug: this._slug,
      entrypoint: "cli"
    };
    this._lastUuid = uuid;
    return record;
  }
  /** Add a user text message. Returns its uuid. */
  addUserMessage(text) {
    const base = this.baseFields();
    const record = {
      type: "user",
      ...base,
      message: { role: "user", content: text }
    };
    this._pendingRecords.push(record);
    return base.uuid;
  }
  /** Add an assistant message with the given content blocks. Returns its uuid. */
  addAssistantMessage(content, opts) {
    const base = this.baseFields();
    const hasToolUse = content.some((b) => b.type === "tool_use");
    const payload = {
      id: syntheticMessageId(),
      type: "message",
      role: "assistant",
      model: opts?.model ?? this._model,
      content,
      stop_reason: opts?.stopReason ?? (hasToolUse ? "tool_use" : "end_turn"),
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 }
    };
    const record = {
      type: "assistant",
      ...base,
      requestId: syntheticRequestId(),
      message: payload
    };
    this._pendingRecords.push(record);
    return base.uuid;
  }
  /** Add a user message containing tool results. Returns its uuid. */
  addToolResults(results) {
    const base = this.baseFields();
    const record = {
      type: "user",
      ...base,
      message: {
        role: "user",
        content: results.map((r) => ({
          type: "tool_result",
          tool_use_id: r.toolUseId,
          content: r.content,
          ...r.isError ? { is_error: true } : {}
        }))
      }
    };
    this._pendingRecords.push(record);
    return base.uuid;
  }
  /**
   * Convenience: add a complete tool call round-trip.
   * Creates assistant tool_use message, user tool_result message,
   * and optionally a final assistant text response.
   */
  addToolCalls(calls, opts) {
    const toolUseBlocks = calls.map((c) => ({
      type: "tool_use",
      id: `toolu_syn_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
      name: c.name,
      input: c.input
    }));
    this.addAssistantMessage(toolUseBlocks, { model: opts?.model, stopReason: "tool_use" });
    this.addToolResults(
      calls.map((c, i) => ({
        toolUseId: toolUseBlocks[i].id,
        content: c.result,
        isError: c.isError
      }))
    );
    if (opts?.response) {
      this.addAssistantMessage(opts.response, { model: opts?.model });
    }
  }
  /**
   * Import an array of Anthropic API-shaped messages, dispatching each to the
   * appropriate internal method based on role and content type.
   */
  importMessages(messages) {
    for (const msg of messages) {
      if (msg.role === "assistant") {
        const content = typeof msg.content === "string" ? [{ type: "text", text: msg.content }] : msg.content;
        this.addAssistantMessage(content);
      } else {
        if (typeof msg.content === "string") {
          this.addUserMessage(msg.content);
        } else {
          const toolResults = msg.content.filter(
            (b) => b.type === "tool_result"
          );
          if (toolResults.length > 0) {
            this.addToolResults(toolResults.map((r) => ({
              toolUseId: r.tool_use_id,
              content: r.content,
              isError: r.is_error
            })));
          } else {
            const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
            this.addUserMessage(text || JSON.stringify(msg.content));
          }
        }
      }
    }
  }
  /** Write pending records to disk. Creates the file/directory if needed. */
  save() {
    if (this._pendingRecords.length === 0) return;
    const dir = dirname(this.jsonlPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const data = this._pendingRecords.map((r) => serializeRecord(r) + "\n").join("");
    if (this._fileExists) {
      appendFileSync(this.jsonlPath, data, "utf-8");
    } else {
      writeFileSync(this.jsonlPath, data, "utf-8");
      this._fileExists = true;
    }
    this._records.push(...this._pendingRecords);
    this._pendingRecords = [];
  }
};
function createSession(opts) {
  const sessionId = opts.sessionId ?? randomUUID();
  const jsonlPath = getSessionPath(sessionId, opts.projectPath, opts.claudeDir);
  return new Session({
    sessionId,
    projectPath: opts.projectPath,
    jsonlPath,
    cwd: opts.cwd,
    version: opts.version,
    gitBranch: opts.gitBranch,
    model: opts.model
  });
}
function openSession(opts) {
  const jsonlPath = getSessionPath(opts.sessionId, opts.projectPath, opts.claudeDir);
  return readSession(jsonlPath, opts.projectPath);
}
function readSession(jsonlPath, projectPath) {
  const records = parseJsonlFile(jsonlPath);
  const firstMsg = records.find((r) => r.type === "user" || r.type === "assistant");
  const sessionId = firstMsg?.sessionId ?? "";
  const resolvedProjectPath = projectPath ?? firstMsg?.cwd ?? "";
  return new Session({
    sessionId,
    projectPath: resolvedProjectPath,
    jsonlPath,
    slug: firstMsg?.slug,
    cwd: firstMsg?.cwd,
    version: firstMsg?.version,
    gitBranch: firstMsg?.gitBranch,
    records,
    fileExists: true
  });
}

export {
  parseJsonl,
  parseJsonlFile,
  serializeRecord,
  serializeJsonl,
  getClaudeDir,
  projectPathToHash,
  getProjectDir,
  getSessionPath,
  Session,
  createSession,
  openSession,
  readSession
};
