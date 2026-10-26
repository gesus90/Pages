import { PLAN_OUTPUT_LIMIT } from "@/backend/service/agents/AgentPlanOutput";
import { AgentError } from "@/backend/error/AgentErrors";
import { noteSessionEvent } from "@/backend/agents/cli/CliSessionEvents";
import { acpProviderFailure } from "@/backend/agents/AgentProviderFailure";

import { findAcpSelectOption } from "./AcpConfigOptions";
import { PAGES_MCP_SERVER } from "./AcpLaunch";

import type {
  SessionConfigOption,
  SessionUpdate,
  ToolCall,
  ToolCallUpdate,
} from "@agentclientprotocol/sdk";
import type { AcpReportedOptions } from "./AcpDriver";
import type { AgentProviderFailure } from "@/definition/AgentPlanRetry";

/** What Pages learned from the updates of one ACP session so far. */
export interface AcpSessionState {
  providerFailure: AgentProviderFailure | null;
  sessionId: string | null;
  /** The newest message of the agent; its final answer once the turn ended. */
  text: string;
  messageBytes: number;
  isResultOversized: boolean;
  /** The message the newest chunks belong to, when the agent names one. */
  messageId: string | null;
  /** Chunks continue the current message until a tool call, plan or thought comes between. */
  isMessageOpen: boolean;
  /** Requests Pages refused because the mode does not allow them. */
  permissionDenials: number;
  /** The Pages MCP server reported that it could not start. */
  isMcpUnavailable: boolean;
  /** The model the adapter reported with its first usage update; `null` until then. */
  reportedModel: string | null;
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
    providerFailure: null,
    sessionId: null,
    text: "",
    messageBytes: 0,
    isResultOversized: false,
    messageId: null,
    isMessageOpen: false,
    permissionDenials: 0,
    isMcpUnavailable: false,
    reportedModel: null,
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
  ) {
    state.text = "";
    state.messageBytes = 0;
    state.isResultOversized = false;
  }
  state.messageId = messageId;
  state.isMessageOpen = true;
  state.messageBytes += Buffer.byteLength(update.content.text);
  if (state.text.length + update.content.text.length > PLAN_OUTPUT_LIMIT)
    state.isResultOversized = true;
  if (!state.isResultOversized) state.text += update.content.text;
}

function boundedToolTitle(title: string): string {
  const bytes = Buffer.from(title);
  let end = Math.min(bytes.length, 4000);
  while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end -= 1;
  return bytes.subarray(0, end).toString("utf8");
}

function readTool(
  state: AcpSessionState,
  call: ToolCall | ToolCallUpdate,
): void {
  if (call.toolCallId.length > 200) throw new AgentError("acp_output_overflow");
  const title = call.title ?? state.tools.get(call.toolCallId) ?? "tool";
  state.tools.set(call.toolCallId, boundedToolTitle(title));
  if (call.status === "completed" || call.status === "failed")
    state.tools.delete(call.toolCallId);
  if (state.tools.size > 512) throw new AgentError("acp_output_overflow");
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
 * @param fields - The field of the report and the option it is read from.
 */
export function readAcpConfiguration(
  state: AcpSessionState,
  options: readonly SessionConfigOption[],
  fields: AcpReportedOptions,
): void {
  for (const [field, id] of Object.entries(fields)) {
    const option = findAcpSelectOption(options, id);
    if (option) state.effective[field] = option.currentValue;
  }
}

/** The key under which the Claude adapter names the model of a usage update. */
const CLAUDE_MODEL_KEY = "_claude/model";

function readReportedModel(update: SessionUpdate): string | null {
  if (update.sessionUpdate !== "usage_update") return null;
  const model = update._meta?.[CLAUDE_MODEL_KEY];
  return typeof model === "string" && model.length > 0 ? model : null;
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
 * text is short; the caller redacts it before it is stored. Only the first
 * model an adapter names is kept: later updates may belong to a subagent.
 */
export function readAcpUpdate(
  state: AcpSessionState,
  update: SessionUpdate,
  fields: AcpReportedOptions,
): void {
  if (update._meta && Object.hasOwn(update._meta, "_claude/rateLimit"))
    state.providerFailure = acpProviderFailure(update._meta);
  state.reportedModel ??= readReportedModel(update);
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
    readAcpConfiguration(state, update.configOptions, fields);
  }
}

/** Keeps the last adapter diagnostic bounded and redacted before it enters a session record. */
export function noteAcpStderr(
  state: AcpSessionState,
  tail: string,
  redact: (line: string) => string,
): void {
  const line = tail
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .at(-1);
  if (line)
    noteSessionEvent(state.events, `adapter ${redact(line).slice(0, 200)}`);
}
