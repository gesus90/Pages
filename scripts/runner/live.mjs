import { createHash } from "node:crypto";

const MAXIMUM_TEXT_BYTES = 4000;
const DEDUPE_WINDOW = 64;

function textEnd(bytes, start) {
  let end = Math.min(start + MAXIMUM_TEXT_BYTES, bytes.length);
  while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end -= 1;
  return end;
}

async function note(state, kind, text, channel = "stdout") {
  if (typeof text !== "string" || !text.trim()) return;
  const bytes = Buffer.from(state.redact(text));
  for (let start = 0; start < bytes.length;) {
    const end = textEnd(bytes, start);
    await state.emit({
      kind,
      text: bytes.subarray(start, end).toString("utf8"),
      channel,
      createdAt: new Date().toISOString(),
      isTruncated: false,
    });
    start = end;
  }
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
    return note(
      state,
      "plan",
      (item.items ?? [])
        .map(
          (entry) => `${entry.completed ? "[x]" : "[ ]"} ${entry.text ?? ""}`,
        )
        .join("\n"),
    );
  const text = codexTool(item);
  if (text === null) return;
  let kind = "tool_started";
  if (event.type === "item.completed")
    kind = item.status === "failed" ? "tool_failed" : "tool_completed";
  await note(state, kind, text);
  if (event.type === "item.completed")
    await note(state, kind, item.aggregated_output);
}

async function claudeTool(block, state) {
  if (!isDuplicate(state, `claude-tool:${block.id}`, block))
    await note(state, "tool_started", block.name);
  if (block.name === "TodoWrite" && Array.isArray(block.input?.todos))
    await note(
      state,
      "plan",
      block.input.todos
        .map((todo) => `[${todo.status}] ${todo.content ?? ""}`)
        .join("\n"),
    );
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
    for (const block of event.message?.content ?? []) {
      if (block.type !== "tool_result") continue;
      const kind = block.is_error ? "tool_failed" : "tool_completed";
      if (typeof block.content === "string")
        await note(state, kind, block.content);
      else
        for (const content of block.content ?? [])
          if (content.type === "text") await note(state, kind, content.text);
    }
  }
  if (event.type === "result")
    await note(
      state,
      event.is_error ? "error" : "status",
      event.is_error ? "Agent failed" : "Agent completed",
    );
}

async function readOpenCode(event, state) {
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
    return note(state, "tool_started", update.title);
  if (update?.sessionUpdate === "tool_call_update")
    return note(
      state,
      update.status === "failed" ? "tool_failed" : "tool_completed",
      update.title ?? update.toolCallId,
    );
  if (update?.sessionUpdate === "plan")
    await note(
      state,
      "plan",
      (update.entries ?? [])
        .map((entry) => `[${entry.status}] ${entry.content}`)
        .join("\n"),
    );
}

/** Projects complete public fields with bounded deduplication and an awaited journal sink. */
export function createLiveHistory(command, redact, emit) {
  const state = { seen: new Map(), hasPartialText: false, redact, emit };
  return {
    async receive(event) {
      const tool = command.program.route.tool;
      if (tool === "codex") await readCodex(event, state);
      else if (tool === "claude") await readClaude(event, state);
      else if (tool === "opencode") await readOpenCode(event, state);
    },
    async finish() {
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
