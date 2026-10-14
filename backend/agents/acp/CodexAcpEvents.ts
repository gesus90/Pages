import { noteSessionEvent } from "@/backend/agents/cli/CliSessionEvents";

import { findAcpSelectOption } from "./AcpConfigOptions";
import { PAGES_MCP_SERVER } from "./CodexAcpAdapter";

import type {
  SessionConfigOption,
  SessionUpdate,
  ToolCall,
  ToolCallUpdate,
} from "@agentclientprotocol/sdk";

/** What Pages learned from the updates of one ACP session so far. */
export interface AcpSessionState {
  sessionId: string | null;
  /** The newest message of the agent; its final answer once the turn ended. */
  text: string;
  /** The message the newest chunks belong to, when the agent names one. */
  messageId: string | null;
  /** Chunks continue the current message until a tool call, plan or thought comes between. */
  isMessageOpen: boolean;
  /** Requests Pages refused because the mode does not allow them. */
  permissionDenials: number;
  /** The Pages MCP server reported that it could not start. */
  isMcpUnavailable: boolean;
  /** What the adapter and Pages report about the session. */
  readonly effective: Record<string, string>;
  /** Short lines of what happened, newest last. */
  readonly events: string[];
  /** The title of every tool call by its identifier. */
  readonly tools: Map<string, string>;
}

const MCP_STARTUP_TITLE = `mcp__${PAGES_MCP_SERVER}__startup`;

/** Updates of agent activity that end the current message. */
const MESSAGE_BOUNDARIES: ReadonlySet<SessionUpdate["sessionUpdate"]> = new Set(
  ["agent_thought_chunk", "tool_call", "tool_call_update", "plan"],
);

/** Creates the state of a session that has not reported anything yet. */
export function createAcpSessionState(): AcpSessionState {
  return {
    sessionId: null,
    text: "",
    messageId: null,
    isMessageOpen: false,
    permissionDenials: 0,
    isMcpUnavailable: false,
    effective: {},
    events: [],
    tools: new Map(),
  };
}

function readMessage(
  state: AcpSessionState,
  update: Extract<SessionUpdate, { sessionUpdate: "agent_message_chunk" }>,
): void {
  if (update.content.type !== "text") return;
  const messageId = update.messageId ?? null;
  if (
    !state.isMessageOpen ||
    (messageId !== null && messageId !== state.messageId)
  )
    state.text = "";
  state.messageId = messageId;
  state.isMessageOpen = true;
  state.text += update.content.text;
}

function readTool(
  state: AcpSessionState,
  call: ToolCall | ToolCallUpdate,
): void {
  const title = call.title ?? state.tools.get(call.toolCallId) ?? "tool";
  state.tools.set(call.toolCallId, title);
  if (title === MCP_STARTUP_TITLE && call.status === "failed")
    state.isMcpUnavailable = true;
  if (call.status === "completed" || call.status === "failed")
    noteSessionEvent(state.events, `tool ${title} ${call.status}`);
}

/**
 * Takes the current values of the mode, model and reasoning options into the report.
 *
 * @param state - The state, updated in place.
 * @param options - The configuration options the adapter reported last.
 */
export function readAcpConfiguration(
  state: AcpSessionState,
  options: readonly SessionConfigOption[],
): void {
  const fields = {
    sessionMode: "mode",
    model: "model",
    reasoningEffort: "reasoning_effort",
  } as const;
  for (const [field, id] of Object.entries(fields)) {
    const option = findAcpSelectOption(options, id);
    if (option) state.effective[field] = option.currentValue;
  }
}

/**
 * Reads one session update into the session state.
 *
 * @param state - The state, updated in place.
 * @param update - The update the adapter sent.
 *
 * @remarks
 * Thoughts are not kept; like tool calls and plans they end the current
 * message, so the final answer is the message after the last of them. Event
 * text is short; the caller redacts it before it is stored.
 */
export function readAcpUpdate(
  state: AcpSessionState,
  update: SessionUpdate,
): void {
  if (update.sessionUpdate === "agent_message_chunk") {
    readMessage(state, update);
    return;
  }
  if (MESSAGE_BOUNDARIES.has(update.sessionUpdate)) state.isMessageOpen = false;
  if (update.sessionUpdate === "tool_call") {
    noteSessionEvent(
      state.events,
      `tool ${update.kind ?? "other"} ${update.title}`,
    );
    readTool(state, update);
  } else if (update.sessionUpdate === "tool_call_update") {
    readTool(state, update);
  } else if (update.sessionUpdate === "plan") {
    noteSessionEvent(state.events, `plan ${update.entries.length} entries`);
  } else if (update.sessionUpdate === "current_mode_update") {
    state.effective.sessionMode = update.currentModeId;
    noteSessionEvent(state.events, `mode ${update.currentModeId}`);
  } else if (update.sessionUpdate === "config_option_update") {
    readAcpConfiguration(state, update.configOptions);
  }
}
