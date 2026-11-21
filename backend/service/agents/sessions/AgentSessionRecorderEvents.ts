import {
  AGENT_TODO_LIMIT,
  AGENT_TODO_TEXT_LENGTH,
} from "@/definition/AgentPlanAgentTodos";
import { AGENT_STEP_PROGRESS_STATUS_NAMES } from "@/definition/AgentPlanStepProgress";
import { MAXIMUM_EVENT_TEXT } from "./AgentSessionJournal";

import type { AgentPlanEntry } from "@/definition/AgentPlanAgentTodos";
import type { SessionUpdate } from "@agentclientprotocol/sdk";
import type { AgentSessionEventInput } from "./AgentSessionJournal";

/** The Pages tool whose calls become todo lines instead of tool lines. */
export const PROGRESS_TOOL = /update_step_progress/u;

/**
 * The titles of OpenCode's own task list tool in its ACP tool calls: the tool name until the call ended, then `N todos`.
 * @remarks
 * OpenCode's ACP adapter (1.18) sends no plan update for this tool, only tool
 * calls whose input holds the complete list.
 */
export const TODO_LIST_TOOL = /^(?:todowrite|\d+ todos)$/u;

/** The plan status of each state of OpenCode's task list, with the Pages names a model may write there. */
const TODO_LIST_STATUSES: Readonly<Record<string, string>> = {
  pending: "pending",
  in_progress: "in_progress",
  completed: "completed",
  cancelled: "failed",
  open: "pending",
  active: "in_progress",
  done: "completed",
  failed: "failed",
};

/** Longest command or output kept of one tool call; the journal limits the event as a whole. */
const TOOL_TEXT = 3_000;

/** Longest identity of a tool call that is kept; a provider ID is far shorter. */
const CALL_IDENTITY_LENGTH = 200;

/** Longest short description of a call that is kept. */
const ABOUT_LENGTH = 200;

/** Longest name of a tool that is kept; a tool name is far shorter. */
const TOOL_NAME_LENGTH = 120;

/**
 * Fields of a JSON input that name what a call works on, most telling first.
 * @remarks
 * A call of a Pages tool has no command; the ticket, path or query it works
 * on says more than its arguments as JSON.
 */
const SUBJECT_FIELDS = [
  "ticketId",
  "ticket",
  "key",
  "id",
  "path",
  "filePath",
  "file_path",
  "query",
  "pattern",
  "url",
  "name",
  "title",
] as const;

/** An MCP server or tool name as codex-acp reports it: one word without blanks or dots in the server. */
const CODEX_MCP_SERVER = /^[^\s.]+$/u;
const CODEX_MCP_TOOL = /^\S+$/u;

/** What a tool call reported so far: its identity, title, kind and input. */
export interface ToolCallState {
  /** The `toolCallId` of the provider, which pairs every update and result with its call. */
  readonly callId: string;
  title: string;
  kind: string;
  input: string;
  /** The tool name the adapter reported, such as `Bash` or `mcp__pages__read_ticket`; empty when it reported none. */
  toolName?: string;
  /** The short description of the call, such as the `description` of a Claude Code command; empty when the call has none. */
  about?: string;
  /** The raw input, kept only for a call of `update_step_progress`. */
  raw?: unknown;
  /** The start was recorded; an adapter that names the arguments only later is announced then. */
  isAnnounced?: boolean;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}

function shortened(text: string): string {
  return text.length > TOOL_TEXT ? `${text.slice(0, TOOL_TEXT)} …` : text;
}

/** The command, file or query a tool call works on, as the adapter reported it. */
export function describeInput(raw: unknown): string {
  if (raw === undefined || raw === null) return "";
  if (typeof raw === "string") return shortened(raw);
  const input = readRecord(raw);
  // An adapter announces a call before its arguments; an empty input says nothing yet.
  if (input && Object.keys(input).length === 0) return "";
  const command = input?.command ?? input?.cmd;
  if (typeof command === "string") return shortened(command);
  if (Array.isArray(command)) return shortened(command.map(String).join(" "));
  for (const field of [
    "file_path",
    "filePath",
    "path",
    "pattern",
    "query",
    "url",
  ]) {
    const value = input?.[field];
    if (typeof value === "string") return shortened(value);
  }
  return shortened(JSON.stringify(raw));
}

/** The first line of a text that is not blank, without surrounding blanks. */
function firstNonBlankLine(text: string): string {
  return (
    text
      .split("\n")
      .find((line) => line.trim() !== "")
      ?.trim() ?? ""
  );
}

/**
 * The tool name Claude Code reports in the `_meta` of a tool call update.
 * @param meta - The `_meta` of an ACP tool call or tool call update.
 * @returns The name, or an empty text when the update names none.
 */
export function reportedToolName(meta: unknown): string {
  const claudeCode = readRecord(readRecord(meta)?.claudeCode);
  const name = claudeCode?.toolName;
  return typeof name === "string" ? name.trim().slice(0, TOOL_NAME_LENGTH) : "";
}

/** The tool and the input of a call, as the reader should see them. */
export interface ReportedCall {
  /** The tool name, such as `Bash` or `mcp__pages__read_ticket`; empty when the adapter named none. */
  readonly toolName: string;
  /** The input of the tool itself, without a wrapper of the adapter. */
  readonly input: unknown;
}

/**
 * The tool name and the input of a call.
 * @param rawInput - The raw input of an ACP tool call or tool call update.
 * @param meta - The `_meta` of the same update.
 * @returns The name Claude Code reports in `_meta`; for a call codex-acp
 * wraps as `{ server, tool, arguments }`, the name `mcp__server__tool` and
 * the arguments as the input; any other input unchanged.
 * @remarks
 * codex-acp names an MCP call only in its title `mcp.server.tool` and gives
 * it the kind `execute`, so without this the terminal would call it a shell
 * command and describe it by the JSON of the wrapper.
 */
export function reportedCall(rawInput: unknown, meta: unknown): ReportedCall {
  const named = reportedToolName(meta);
  const input = readRecord(rawInput);
  const server = input?.server;
  const tool = input?.tool;
  if (
    !input ||
    !Object.hasOwn(input, "arguments") ||
    typeof server !== "string" ||
    typeof tool !== "string" ||
    !CODEX_MCP_SERVER.test(server) ||
    !CODEX_MCP_TOOL.test(tool)
  )
    return { toolName: named, input: rawInput };
  return {
    toolName: named || `mcp__${server}__${tool}`.slice(0, TOOL_NAME_LENGTH),
    input: input.arguments,
  };
}

/** What a call of an MCP tool works on: the ticket, path or query its JSON input names, else its first plain arguments. */
function describeSubject(input: Record<string, unknown>): string {
  for (const field of SUBJECT_FIELDS) {
    const value = input[field];
    if (typeof value === "string" && value.trim() !== "")
      return firstNonBlankLine(value).slice(0, ABOUT_LENGTH);
    if (typeof value === "number") return String(value);
  }
  // Keys of the idempotency and revision checks name nothing the reader looks for.
  const argumentTexts = Object.entries(input).flatMap(([name, value]) =>
    (typeof value === "string" || typeof value === "number") &&
    !/^(?:operationId|expected)/u.test(name)
      ? [`${name}=${firstNonBlankLine(String(value))}`]
      : [],
  );
  return argumentTexts.slice(0, 2).join(" ").slice(0, ABOUT_LENGTH);
}

/**
 * The short description of a call: the `description` an agent gave its
 * command, and for an MCP tool the thing its JSON input names.
 * @param raw - The raw input of the call.
 * @param toolName - The tool name the adapter reported; empty when it reported none.
 * @returns One line, or an empty text when the call has no short description.
 * @remarks
 * Any other tool is described by its own command, path or pattern, which the
 * input line already holds.
 */
export function describeCall(raw: unknown, toolName: string): string {
  const input = readRecord(raw);
  if (!input) return "";
  const description = input.description;
  if (typeof description === "string" && description.trim() !== "")
    return firstNonBlankLine(description).slice(0, ABOUT_LENGTH);
  return toolName.startsWith("mcp__") ? describeSubject(input) : "";
}

/** What a tool call returned, as far as the adapter reported it. */
export interface ToolOutput {
  readonly text: string;
  /** The text was cut to the stored limit. */
  readonly isLimited: boolean;
  /** A numeric exit code the adapter reported; `null` when it reported none. */
  readonly exitCode: number | null;
}

const EXIT_CODE_FIELDS = ["exit_code", "exitCode", "returncode"] as const;
const FENCED_OUTPUT = /^```[^\n`]*\n(?<body>[\s\S]*?)\n?```$/u;

/** An integer exit code the raw output names; a completed call alone proves none. */
function reportedExitCode(raw: unknown): number | null {
  const output = readRecord(raw);
  for (const field of EXIT_CODE_FIELDS) {
    const value = output?.[field];
    if (typeof value === "number" && Number.isInteger(value)) return value;
  }
  return null;
}

/** The exit code codex-acp reports for a terminal command in `_meta.terminal_exit`; `null` without one. */
function terminalExitCode(meta: unknown): number | null {
  const exit = readRecord(readRecord(meta)?.terminal_exit);
  const code = exit?.exit_code;
  return typeof code === "number" && Number.isInteger(code) ? code : null;
}

/** The message of an MCP error: the error text itself or its `message`; `null` without one. */
function errorMessage(error: unknown): string | null {
  const message =
    typeof error === "string" ? error : readRecord(error)?.message;
  return typeof message === "string" && message.trim() !== "" ? message : null;
}

/**
 * The text of an MCP result codex-acp reports as `{ result, error }`: the
 * message of the error, else the text content of the result.
 * @returns `null` for any other output, which keeps its own fields.
 */
function mcpResultText(output: Record<string, unknown>): string | null {
  if (!Object.hasOwn(output, "result") || !Object.hasOwn(output, "error"))
    return null;
  const message = errorMessage(output.error);
  if (message !== null) return message;
  const content = readRecord(output.result)?.content;
  if (!Array.isArray(content)) return null;
  const texts = content.flatMap((entry: unknown) => {
    const part = readRecord(entry);
    return part?.type === "text" && typeof part.text === "string"
      ? [part.text]
      : [];
  });
  return texts.length > 0 ? texts.join("\n") : null;
}

/** claude-agent-acp wraps a command's output in a fenced block; the terminal shows the output itself. */
function unfenced(text: string): string {
  return FENCED_OUTPUT.exec(text.trim())?.groups?.body ?? text;
}

/** The text and diffs a tool call reports in its content. */
function contentParts(
  update: Extract<SessionUpdate, { sessionUpdate: "tool_call_update" }>,
): string[] {
  const parts: string[] = [];
  for (const entry of update.content ?? []) {
    if (entry.type === "content" && entry.content.type === "text")
      parts.push(unfenced(entry.content.text));
    else if (entry.type === "diff")
      parts.push(`diff ${entry.path}\n${entry.newText}`);
  }
  return parts;
}

/** The raw output of a tool call whose content holds no text and no diff. */
function rawOutputParts(raw: unknown): string[] {
  if (typeof raw === "string") return [raw];
  const output = readRecord(raw);
  if (!output) return [];
  const mcpText = mcpResultText(output);
  if (mcpText !== null) return [mcpText];
  const fields = [
    "formatted_output",
    "output",
    "stdout",
    "stderr",
    "result",
  ].flatMap((field) => {
    const value = output[field];
    return typeof value === "string" && value.trim() ? [value] : [];
  });
  return fields.length > 0 ? fields : [JSON.stringify(raw)];
}

function outputParts(
  update: Extract<SessionUpdate, { sessionUpdate: "tool_call_update" }>,
): string[] {
  const parts = contentParts(update);
  return parts.length > 0 ? parts : rawOutputParts(update.rawOutput);
}

/** What a tool call returned: its text content, diffs and raw output. */
export function describeOutput(
  update: Extract<SessionUpdate, { sessionUpdate: "tool_call_update" }>,
): ToolOutput {
  const text = outputParts(update).join("\n").trim();
  return {
    text: shortened(text),
    isLimited: text.length > TOOL_TEXT,
    exitCode:
      reportedExitCode(update.rawOutput) ?? terminalExitCode(update._meta),
  };
}

/** A marker text as one line: line breaks and control characters become blanks. */
function markerText(text: string): string {
  return text.replace(/[\p{Cc}\s]+/gu, " ").trim();
}

/** The identity of a call as one line without blanks or control characters; empty when the provider sent none. */
function callIdentity(callId: string): string {
  return callId.replace(/[\s\p{Cc}]/gu, "").slice(0, CALL_IDENTITY_LENGTH);
}

/**
 * The text of a tool call: its title, its kind, its identity, the command and, once it ended, its output.
 * @remarks
 * A call without a title is named by its kind, never by the internal ID of
 * the call, which says nothing to a reader. The kind line (`@kind read`)
 * lets the Pages terminal name the call the same way for every provider.
 * `@tool` carries the tool name and `@about` the short description where the
 * adapter reports them; a command keeps only its first line, because the
 * terminal shows the first line and never a piece from the middle.
 * The call line (`@call <id>`) carries the adapter's stable `toolCallId`, the
 * only key the terminal joins the start and the end of a call by; the
 * terminal never shows it. `@exit` appears only for an exit code the adapter
 * reported, `@limited` when the output was cut to the stored limit.
 */
export function toolText(state: ToolCallState, output?: ToolOutput): string {
  const title = state.title.trim() || state.kind;
  const identity = callIdentity(state.callId);
  return [
    title,
    `@kind ${state.kind}`,
    identity ? `@call ${identity}` : "",
    state.toolName ? `@tool ${markerText(state.toolName)}` : "",
    state.about ? `@about ${markerText(state.about)}` : "",
    output && output.exitCode !== null ? `@exit ${output.exitCode}` : "",
    output?.isLimited ? "@limited" : "",
    state.input ? `$ ${firstNonBlankLine(state.input)}` : "",
    output?.text ?? "",
  ]
    .filter((part) => part !== "")
    .join("\n");
}

/**
 * The journal text of a structured plan update: JSON with the status and text of each entry.
 *
 * @remarks
 * The journal shortens a text beyond its limit, which would break the JSON.
 * A list that does not fit loses its last entries instead, so the text always
 * stays readable and the entries that are kept stay exact.
 */
function planText(entries: readonly AgentPlanEntry[]): string {
  const kept = entries.slice(0, AGENT_TODO_LIMIT).map((entry) => ({
    content: entry.content.trim().slice(0, AGENT_TODO_TEXT_LENGTH),
    status: entry.status,
  }));
  let text = JSON.stringify({ entries: kept });
  while (text.length > MAXIMUM_EVENT_TEXT && kept.length > 0) {
    kept.pop();
    text = JSON.stringify({ entries: kept });
  }
  return text;
}

/**
 * The plan event of a call of OpenCode's own task list.
 * @param rawInput - The input of the call while it runs.
 * @param rawOutput - The result of the ended call, whose metadata repeats the list.
 * @returns `null` when neither holds a readable list.
 * @remarks
 * The list reaches the attempt like a structured plan, so OpenCode models
 * that keep their steps there show them from the first call on.
 */
export function todoListEvent(
  rawInput: unknown,
  rawOutput: unknown,
): Omit<AgentSessionEventInput, "turn"> | null {
  const todos =
    readRecord(rawInput)?.todos ??
    readRecord(readRecord(rawOutput)?.metadata)?.todos;
  if (!Array.isArray(todos)) return null;
  const entries = todos.flatMap((entry: unknown): AgentPlanEntry[] => {
    const todo = readRecord(entry);
    if (typeof todo?.content !== "string" || typeof todo.status !== "string")
      return [];
    if (todo.content.trim() === "") return [];
    const status = Object.hasOwn(TODO_LIST_STATUSES, todo.status)
      ? TODO_LIST_STATUSES[todo.status]
      : todo.status;
    return [{ content: todo.content, status }];
  });
  return entries.length === 0
    ? null
    : { kind: "plan", text: planText(entries) };
}

/** The event an update of plans or modes is recorded as; `null` for other updates. */
export function activityEvent(
  update: SessionUpdate,
): Omit<AgentSessionEventInput, "turn"> | null {
  if (update.sessionUpdate === "plan")
    return { kind: "plan", text: planText(update.entries) };
  if (update.sessionUpdate === "current_mode_update")
    return { kind: "status", text: `mode ${update.currentModeId}` };
  return null;
}

/**
 * The todo states and activity of a successful `update_step_progress` call, as JSON.
 *
 * @returns `null` when the call reported no readable todos.
 */
export function progressText(raw: unknown): string | null {
  const input = readRecord(raw);
  if (!input || !Array.isArray(input.todos)) return null;
  const todos = input.todos.flatMap((entry: unknown) => {
    const todo = readRecord(entry);
    if (typeof todo?.id !== "string" || typeof todo.status !== "string")
      return [];
    // Pages took the names of the built-in task lists as its own states; the terminal reads these.
    const status = Object.hasOwn(AGENT_STEP_PROGRESS_STATUS_NAMES, todo.status)
      ? AGENT_STEP_PROGRESS_STATUS_NAMES[todo.status]
      : todo.status.slice(0, 20);
    return [{ id: todo.id.slice(0, 200), status }];
  });
  if (todos.length === 0) return null;
  const activity =
    typeof input.activity === "string" ? input.activity.slice(0, 200) : null;
  return JSON.stringify({ todos, activity });
}
