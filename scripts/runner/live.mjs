import { receiveUsage } from "./usage.mjs";
import {
  createClaudeSessionReader,
  receiveClaudeSession,
} from "./claude-session.mjs";
import {
  createCodexSessionReader,
  finishCodexSession,
  receiveCodexSession,
} from "./codex-session.mjs";
import { codexHome } from "./cli.mjs";
import { createHash } from "node:crypto";

const MAXIMUM_TEXT_BYTES = 4000;
const DEDUPE_WINDOW = 64;
const MAXIMUM_CALL_TITLE = 600;
const MAXIMUM_CALL_IDENTITY = 200;
const CALL_WINDOW = 256;

function textEnd(bytes, start, limit) {
  let end = Math.min(start + limit, bytes.length);
  while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end -= 1;
  return end;
}

/** Splits redacted bytes into pieces of at most `limit` bytes that never cut a character. */
function textPieces(bytes, limit) {
  const pieces = [];
  for (let start = 0; start < bytes.length;) {
    const end = textEnd(bytes, start, limit);
    pieces.push(bytes.subarray(start, end).toString("utf8"));
    start = end;
  }
  return pieces;
}

/**
 * Emits text as events of at most 4000 bytes.
 * With a head, every piece repeats it, so each event names its call; a head without text still emits one event.
 */
async function note(state, kind, text, channel = "stdout", head = "") {
  if (typeof text !== "string") return;
  if (!head && !text.trim()) return;
  const lead = head ? state.redact(head) : "";
  const prefix = lead ? `${lead}\n` : "";
  // Title and identity are bounded, so the floor only keeps a long redaction marker from stalling the split.
  const limit = Math.max(MAXIMUM_TEXT_BYTES - Buffer.byteLength(prefix), 1000);
  const pieces = textPieces(Buffer.from(state.redact(text)), limit);
  // A head without text is a complete event, such as a call that ended with an empty result.
  for (const piece of pieces.length ? pieces : [null])
    await state.emit({
      kind,
      text: piece === null ? lead : `${prefix}${piece}`,
      channel,
      createdAt: new Date().toISOString(),
      isTruncated: false,
    });
}

/** The provider's identity of a call as one safe line; empty when the provider sent none. */
function callIdentity(id) {
  if (typeof id !== "string" && typeof id !== "number") return "";
  return String(id)
    .replace(/[\s\p{Cc}]/gu, "")
    .slice(0, MAXIMUM_CALL_IDENTITY);
}

/** Remembers the name of a call until its result arrives, which some providers send without it. */
function rememberCall(state, identity, title) {
  state.calls.delete(identity);
  state.calls.set(identity, title);
  if (state.calls.size > CALL_WINDOW)
    state.calls.delete(state.calls.keys().next().value);
}

/**
 * Emits the start or the result of a tool call with its provider identity.
 * The text is `title`, `@call identity`, then the rest of the title and the output; a call without an identity keeps the plain text.
 */
async function noteCall(state, kind, call) {
  const title = String(call.title ?? "");
  const output = call.output ?? "";
  if (!call.identity)
    return note(
      state,
      kind,
      [title, output].filter((part) => part !== "").join("\n"),
    );
  const [first = "", ...rest] = title.split("\n");
  const body = [rest.join("\n"), output].filter((part) => part !== "");
  const head = `${first.trim().slice(0, MAXIMUM_CALL_TITLE)}\n@call ${call.identity}`;
  await note(state, kind, body.join("\n"), "stdout", head);
}

async function planNote(state, entries) {
  if (state.progressVersion !== 1)
    return note(
      state,
      "plan",
      entries.map((entry) => `[${entry.status}] ${entry.content}`).join("\n"),
    );
  const kept = entries.slice(0, 40).map((entry) => ({
    content: state.redact(
      String(entry.content ?? "")
        .trim()
        .slice(0, 200),
    ),
    status: String(entry.status ?? "pending"),
  }));
  let text = JSON.stringify({ entries: kept });
  while (Buffer.byteLength(text) > MAXIMUM_TEXT_BYTES && kept.length) {
    kept.pop();
    text = JSON.stringify({ entries: kept });
  }
  await note(state, "plan", text);
}

function codexTool(item) {
  switch (item.type) {
    case "command_execution":
      return item.command;
    case "mcp_tool_call":
      return `${item.server ?? ""} / ${item.tool ?? ""}`;
    case "web_search":
      return item.query;
    case "file_change":
      return (item.changes ?? [])
        .map((entry) => `${entry.kind}: ${entry.path}`)
        .join("\n");
    default:
      return null;
  }
}

function isDuplicate(state, key, contents) {
  const identity = createHash("sha256").update(key).digest("hex");
  const digest = createHash("sha256")
    .update(JSON.stringify(contents))
    .digest("hex");
  if (state.seen.get(identity) === digest) return true;
  state.seen.delete(identity);
  state.seen.set(identity, digest);
  if (state.seen.size > DEDUPE_WINDOW)
    state.seen.delete(state.seen.keys().next().value);
  return false;
}

async function readCodex(event, state) {
  if (event.type === "turn.started")
    return note(state, "status", "Agent started");
  if (["turn.failed", "error"].includes(event.type))
    return note(
      state,
      "error",
      event.error?.message ?? event.message ?? "Agent failed",
    );
  const item = event.item;
  if (
    !item ||
    !["item.started", "item.updated", "item.completed"].includes(event.type)
  )
    return;
  if (isDuplicate(state, `${item.id}:${item.type}:${event.type}`, item)) return;
  if (item.type === "agent_message") {
    if (event.type === "item.completed")
      await note(state, "agent_message", item.text);
    return;
  }
  if (item.type === "todo_list")
    return planNote(
      state,
      (item.items ?? []).map((entry) => ({
        content: entry.text ?? "",
        status: entry.completed ? "completed" : "pending",
      })),
    );
  const title = codexTool(item);
  if (title === null) return;
  const identity = callIdentity(item.id);
  if (event.type !== "item.completed")
    return noteCall(state, "tool_started", { title, identity });
  const kind = item.status === "failed" ? "tool_failed" : "tool_completed";
  const output =
    typeof item.aggregated_output === "string" && item.aggregated_output.trim()
      ? item.aggregated_output
      : "";
  await noteCall(state, kind, { title, identity, output });
}

async function claudeTool(block, state) {
  const identity = callIdentity(block.id);
  if (identity) rememberCall(state, identity, String(block.name ?? ""));
  if (!isDuplicate(state, `claude-tool:${block.id}`, block))
    await noteCall(state, "tool_started", { title: block.name, identity });
  if (block.name === "TodoWrite" && Array.isArray(block.input?.todos))
    await planNote(
      state,
      block.input.todos.map((todo) => ({
        content: todo.content ?? "",
        status: todo.status,
      })),
    );
}

/** A result belongs to the call named by `tool_use_id`, whatever the order in which calls end. */
async function claudeResult(block, state) {
  const identity = callIdentity(block.tool_use_id);
  const output =
    typeof block.content === "string"
      ? block.content
      : (block.content ?? [])
          .filter((content) => content.type === "text")
          .map((content) => content.text)
          .join("\n");
  await noteCall(state, block.is_error ? "tool_failed" : "tool_completed", {
    title: state.calls.get(identity) ?? "",
    identity,
    output,
  });
}

async function readClaude(event, state) {
  if (event.type === "stream_event") {
    const update = event.event;
    if (
      update?.type === "content_block_start" &&
      update.content_block?.type === "tool_use"
    )
      await claudeTool(update.content_block, state);
    if (
      update?.type === "content_block_delta" &&
      update.delta?.type === "text_delta" &&
      !state.hasPartialText
    ) {
      state.hasPartialText = true;
      await note(state, "status", "Agent is composing a message");
    }
  }
  if (event.type === "assistant") {
    for (const block of event.message?.content ?? []) {
      if (block.type === "text") await note(state, "agent_message", block.text);
      if (block.type === "tool_use") await claudeTool(block, state);
    }
    state.hasPartialText = false;
  }
  if (event.type === "user") {
    for (const block of event.message?.content ?? [])
      if (block.type === "tool_result") await claudeResult(block, state);
  }
  if (event.type === "result")
    await note(
      state,
      event.is_error ? "error" : "status",
      event.is_error ? "Agent failed" : "Agent completed",
    );
}

/** An ACP call or its end; a call that is still running reports no result. */
async function openCodeCall(state, kind, update) {
  const identity = callIdentity(update.toolCallId);
  const title = update.title ?? state.calls.get(identity) ?? "";
  if (identity && update.title) rememberCall(state, identity, update.title);
  await noteCall(state, kind, { title, identity });
}

async function readOpenCode(event, state) {
  if (event.type === "pages.configuration") {
    if (typeof event.model === "string")
      await note(state, "status", `model ${event.model} confirmed`);
    if (typeof event.reasoningEffort === "string")
      await note(
        state,
        "status",
        `thinking_level ${event.reasoningEffort} confirmed`,
      );
    return;
  }
  if (event.type !== "pages.update") return;
  const update = event.update;
  if (
    update?.sessionUpdate === "agent_message_chunk" &&
    update.content?.type === "text"
  ) {
    // Complete messages are projected by the ACP wrapper, so redaction precedes splitting.
    return;
  }
  if (update?.sessionUpdate === "agent_message")
    return note(state, "agent_message", update.text);
  if (update?.sessionUpdate === "tool_call")
    return openCodeCall(state, "tool_started", update);
  if (
    update?.sessionUpdate === "tool_call_update" &&
    ["completed", "failed"].includes(update.status)
  )
    return openCodeCall(
      state,
      update.status === "failed" ? "tool_failed" : "tool_completed",
      update,
    );
  if (update?.sessionUpdate === "plan")
    await planNote(state, update.entries ?? []);
}

/** The rollout reader of a Codex job; a script, another tool or an invalid home reads nothing. */
function codexSessionReader(command) {
  if (command.program?.route?.tool !== "codex" || command.progressVersion !== 1)
    return createCodexSessionReader(null, false);
  try {
    return createCodexSessionReader(
      codexHome(command),
      Boolean(command.continuation?.resumeSessionId),
    );
  } catch {
    // An invalid CLI home also stops the launch; the reader then has nothing to follow.
    return createCodexSessionReader(null, false);
  }
}

/** Projects complete public fields with bounded deduplication and an awaited journal sink. */
export function createLiveHistory(command, redact, emit) {
  const state = {
    seen: new Map(),
    calls: new Map(),
    hasPartialText: false,
    redact,
    emit,
    isManaged: Boolean(command.managed),
    progressVersion: command.progressVersion,
    usageMessages: new Map(),
    claudeSession: createClaudeSessionReader(),
    codexSession: codexSessionReader(command),
  };
  return {
    async receive(event) {
      const tool = command.program.route.tool;
      if (state.progressVersion === 1) await receiveUsage(event, tool, state);
      if (state.progressVersion === 1 && tool === "claude")
        await receiveClaudeSession(event, state.claudeSession, state.emit);
      if (tool === "codex") {
        await readCodex(event, state);
        await receiveCodexSession(event, state.codexSession, state.emit);
      } else if (tool === "claude") await readClaude(event, state);
      else if (tool === "opencode" || tool === "antigravity")
        await readOpenCode(event, state);
    },
    async finish() {
      await finishCodexSession(state.codexSession, state.emit);
      if (state.hasPartialText)
        await note(state, "status", "Agent text update incomplete");
    },
  };
}

/** Legacy history files remain readable in small wire packets during an upgrade. */
export function liveBatch(events, after) {
  const batch = [];
  let bytes = 2;
  for (const event of events ?? []) {
    if (event.sequence <= after) continue;
    const length = Buffer.byteLength(JSON.stringify(event)) + 1;
    if (batch.length >= 16 || bytes + length > 32768) break;
    batch.push(event);
    bytes += length;
  }
  return batch;
}
