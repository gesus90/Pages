const MAXIMUM_EVENTS = 1999;
const MAXIMUM_TEXT_BYTES = 4000;
const MAXIMUM_LINE = 1024 * 1024;

function shortText(text) {
  const bytes = Buffer.from(text);
  if (bytes.length <= MAXIMUM_TEXT_BYTES) return text;
  return bytes
    .subarray(0, MAXIMUM_TEXT_BYTES)
    .toString("utf8")
    .replace(/\uFFFD$/u, "");
}

function note(state, kind, text) {
  if (
    typeof text !== "string" ||
    !text.trim() ||
    state.events.length > MAXIMUM_EVENTS
  )
    return;
  if (state.events.length === MAXIMUM_EVENTS) {
    state.events.push({
      sequence: state.events.length + 1,
      kind: "status",
      text: "Live history limit reached; further diagnostics omitted. Final result remains authoritative.",
      createdAt: new Date().toISOString(),
      isTruncated: true,
    });
    return;
  }
  const safe = state.redact(text);
  state.events.push({
    sequence: state.events.length + 1,
    kind,
    text: shortText(safe),
    createdAt: new Date().toISOString(),
    isTruncated: Buffer.byteLength(safe) > MAXIMUM_TEXT_BYTES,
  });
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
        .slice(0, 20)
        .map((entry) => `${entry.kind}: ${entry.path}`)
        .join("\n");
    default:
      return null;
  }
}

function readCodex(event, state) {
  const item = event.item;
  if (event.type === "turn.started")
    return note(state, "status", "Agent started");
  if (event.type === "turn.failed" || event.type === "error")
    return note(
      state,
      "error",
      event.error?.message ?? event.message ?? "Agent failed",
    );
  if (
    !item ||
    !["item.started", "item.updated", "item.completed"].includes(event.type)
  )
    return;
  const key = `${item.id}:${item.type}:${event.type}`;
  const content = JSON.stringify(item);
  if (state.seen.get(key) === content) return;
  if (state.seen.size < MAXIMUM_EVENTS) state.seen.set(key, content);
  if (item.type === "agent_message") {
    if (event.type === "item.completed")
      note(state, "agent_message", item.text);
    return;
  }
  if (item.type === "todo_list") {
    const items = Array.isArray(item.items) ? item.items : [];
    note(
      state,
      "plan",
      items
        .slice(0, 50)
        .map(
          (entry) => `${entry.completed ? "[x]" : "[ ]"} ${entry.text ?? ""}`,
        )
        .join("\n"),
    );
    return;
  }
  const text = codexTool(item);
  if (text === null) return;
  let kind = "tool_started";
  if (event.type === "item.completed")
    kind = item.status === "failed" ? "tool_failed" : "tool_completed";
  note(state, kind, text);
}

function claudeTool(block, state) {
  const key = `claude-tool:${block.id}`;
  if (!state.seen.has(key)) {
    note(state, "tool_started", block.name);
    if (state.seen.size < MAXIMUM_EVENTS) state.seen.set(key, "started");
  }
  if (block.name === "TodoWrite" && Array.isArray(block.input?.todos))
    note(
      state,
      "plan",
      block.input.todos
        .slice(0, 50)
        .map(
          (todo) =>
            `${todo.status === "completed" ? "[x]" : "[ ]"} ${todo.content ?? ""}`,
        )
        .join("\n"),
    );
}

function readClaudeStream(update, state) {
  if (update?.type === "message_start") {
    state.hasPartialText = false;
    return;
  }
  if (
    update?.type === "content_block_start" &&
    update.content_block?.type === "tool_use"
  )
    claudeTool(update.content_block, state);
  // Public text waits for a complete assistant message; a credential split across deltas cannot escape redaction.
  if (
    update?.type === "content_block_delta" &&
    update.delta?.type === "text_delta"
  ) {
    if (!state.hasPartialText)
      note(state, "status", "Agent is composing a message");
    state.hasPartialText = true;
  }
}

function readClaude(event, state) {
  if (event.type === "stream_event")
    return readClaudeStream(event.event, state);
  if (event.type === "assistant") {
    for (const block of event.message?.content ?? []) {
      if (block.type === "text") note(state, "agent_message", block.text);
      if (block.type === "tool_use") claudeTool(block, state);
    }
    state.hasPartialText = false;
  }
  if (event.type === "user") {
    for (const block of event.message?.content ?? [])
      if (block.type === "tool_result")
        note(
          state,
          block.is_error ? "tool_failed" : "tool_completed",
          "Tool result received",
        );
  }
  if (event.type === "result")
    note(
      state,
      event.is_error ? "error" : "status",
      event.is_error ? "Agent failed" : "Agent completed",
    );
}

function readLine(text, command, state) {
  try {
    const event = JSON.parse(text);
    if (command.program.route.tool === "codex") readCodex(event, state);
    else if (command.program.route.tool === "claude") readClaude(event, state);
  } catch {
    // Malformed/unknown records and raw diagnostics never leave the host.
  }
}

/** Projects public CLI events only, redacting complete logical fields before any size limit. */
export function createLiveHistory(command, redact) {
  const state = { events: [], seen: new Map(), hasPartialText: false, redact };
  let pending = "";
  let isDiscarding = false;
  return {
    events: state.events,
    receive(text) {
      for (const part of text.split(/(?<=\n)/u)) {
        if (!isDiscarding) pending += part;
        if (Buffer.byteLength(pending) > MAXIMUM_LINE) {
          pending = "";
          isDiscarding = true;
        }
        if (!part.endsWith("\n")) continue;
        if (!isDiscarding) readLine(pending, command, state);
        else note(state, "status", "Oversized CLI event omitted");
        pending = "";
        isDiscarding = false;
      }
    },
    finish() {
      if (pending && !isDiscarding) readLine(pending, command, state);
      if (state.hasPartialText)
        note(state, "status", "Agent text update incomplete");
    },
  };
}

/** Reads only missed events, up to sixteen entries and 32 KiB including their JSON envelope. */
export function liveBatch(events, after) {
  const batch = [];
  for (const event of events ?? []) {
    if (event.sequence <= after) continue;
    if (
      batch.length >= 16 ||
      Buffer.byteLength(JSON.stringify([...batch, event])) > 32768
    )
      break;
    batch.push(event);
  }
  return batch;
}
