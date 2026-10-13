import { readAgentObject } from "@/backend/agents/AgentPayload";

import type { CliProviderId } from "@/definition/AgentConnection";

const MAXIMUM_EVENTS = 60;
const MAXIMUM_EVENT_CHARACTERS = 200;

/** What Pages learned from the events of one session so far. */
export interface CliSessionState {
  sessionId: string | null;
  /** The newest final answer of the agent. */
  text: string;
  /** The runner reported the end of its turn. */
  isTurnComplete: boolean;
  /** The runner reported a failed turn. */
  hasFailed: boolean;
  /** Actions the runner refused because nobody may approve them. */
  permissionDenials: number;
  /** What the runner reported about itself. */
  readonly effective: Record<string, string>;
  /** Short lines of what happened, newest last. */
  readonly events: string[];
}

/** What one event line changed that the caller reacts to. */
export interface CliSessionUpdate {
  /** The runner named its session for the first time. */
  readonly identified?: string;
  /** An interactive runner ended its turn. */
  readonly turnEnded?: boolean;
}

/** Creates the state of a session that has not reported anything yet. */
export function createCliSessionState(): CliSessionState {
  return {
    sessionId: null,
    text: "",
    isTurnComplete: false,
    hasFailed: false,
    permissionDenials: 0,
    effective: {},
    events: [],
  };
}

function note(state: CliSessionState, line: string): void {
  state.events.push(
    line.replace(/\s+/gu, " ").slice(0, MAXIMUM_EVENT_CHARACTERS),
  );
  if (state.events.length > MAXIMUM_EVENTS) state.events.shift();
}

function identify(state: CliSessionState, id: unknown): CliSessionUpdate {
  if (typeof id !== "string" || !id || state.sessionId !== null) return {};
  state.sessionId = id.slice(0, 200);
  note(state, `session ${state.sessionId}`);
  return { identified: state.sessionId };
}

function text(input: unknown): string {
  return typeof input === "string" ? input : "";
}

function readCodexItem(
  state: CliSessionState,
  event: Record<string, unknown>,
): void {
  const item = readAgentObject(event.item);
  const status = text(item.status);
  switch (item.type) {
    case "agent_message":
      if (event.type === "item.completed") state.text = text(item.text);
      return;
    case "command_execution":
      if (event.type === "item.completed")
        note(
          state,
          `command ${text(item.command)} → ${String(item.exit_code ?? status)}`,
        );
      return;
    case "file_change":
      note(state, `files ${status}`);
      return;
    case "mcp_tool_call":
      if (event.type === "item.completed")
        note(state, `mcp ${text(item.server)}.${text(item.tool)} ${status}`);
      return;
    case "error":
      note(state, `error ${text(item.message)}`);
      return;
    default:
      return;
  }
}

function readCodex(
  state: CliSessionState,
  event: Record<string, unknown>,
): CliSessionUpdate {
  if (event.type === "thread.started") return identify(state, event.thread_id);
  if (event.type === "item.started" || event.type === "item.completed")
    readCodexItem(state, event);
  if (event.type === "turn.completed") {
    state.isTurnComplete = true;
    note(state, "turn completed");
  }
  if (event.type === "turn.failed") {
    state.hasFailed = true;
    note(state, `turn failed ${text(readAgentObject(event.error).message)}`);
  }
  // Codex reports reconnects as errors and retries; only a failed turn counts.
  if (event.type === "error") note(state, `notice ${text(event.message)}`);
  return {};
}

function readClaudeInit(
  state: CliSessionState,
  event: Record<string, unknown>,
): CliSessionUpdate {
  const servers: unknown[] = Array.isArray(event.mcp_servers)
    ? event.mcp_servers
    : [];
  const tools: unknown[] = Array.isArray(event.tools) ? event.tools : [];
  state.effective.model = text(event.model);
  state.effective.permissionMode = text(event.permissionMode);
  state.effective.tools = tools
    .filter((tool) => typeof tool === "string")
    .join(",");
  state.effective.mcp = servers
    .map((server) => {
      const entry = readAgentObject(server);
      return `${text(entry.name)}:${text(entry.status)}`;
    })
    .join(",");
  return identify(state, event.session_id);
}

function readClaudeAssistant(
  state: CliSessionState,
  event: Record<string, unknown>,
): void {
  const message = readAgentObject(event.message);
  const content: unknown[] = Array.isArray(message.content)
    ? message.content
    : [];
  for (const block of content.map(readAgentObject))
    if (block.type === "tool_use") note(state, `tool ${text(block.name)}`);
}

function readClaude(
  state: CliSessionState,
  event: Record<string, unknown>,
): CliSessionUpdate {
  if (event.type === "system" && event.subtype === "init")
    return readClaudeInit(state, event);
  if (event.type === "assistant") readClaudeAssistant(state, event);
  if (event.type !== "result") return {};
  const denials: unknown[] = Array.isArray(event.permission_denials)
    ? event.permission_denials
    : [];
  state.permissionDenials += denials.length;
  state.text = text(event.result);
  state.isTurnComplete = true;
  state.hasFailed = event.is_error !== false || event.subtype !== "success";
  state.effective.turns = String(event.num_turns ?? "");
  note(
    state,
    `turn ${text(event.subtype)} after ${state.effective.turns} turns`,
  );
  return { turnEnded: true };
}

function readOpenCode(
  state: CliSessionState,
  event: Record<string, unknown>,
): CliSessionUpdate {
  const update = identify(state, event.sessionID);
  const part = readAgentObject(event.part);
  if (event.type === "step_start") state.text = "";
  if (event.type === "text") state.text += text(part.text);
  if (event.type === "tool_use") {
    const tool = readAgentObject(part.state);
    note(state, `tool ${text(part.tool)} ${text(tool.status)}`);
  }
  if (event.type === "step_finish" && part.reason === "stop") {
    state.isTurnComplete = true;
    note(state, "turn completed");
  }
  if (event.type === "error") {
    state.hasFailed = true;
    note(state, `error ${text(readAgentObject(event.error).name)}`);
  }
  return update;
}

/**
 * Reads one event line of a runner into the session state.
 *
 * @param provider - The runner that printed the line.
 * @param line - One complete JSON line.
 * @param state - The state, updated in place.
 * @returns What the caller has to react to.
 *
 * @remarks
 * Lines that are no JSON are diagnostics and are ignored. Event text is kept
 * short; the caller redacts it before it is stored.
 */
export function readCliSessionLine(
  provider: CliProviderId,
  line: string,
  state: CliSessionState,
): CliSessionUpdate {
  let event: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(line);
    event = readAgentObject(parsed);
  } catch {
    return {};
  }
  switch (provider) {
    case "codex_cli":
      return readCodex(state, event);
    case "claude_code":
      return readClaude(state, event);
    case "opencode":
      return readOpenCode(state, event);
  }
}
