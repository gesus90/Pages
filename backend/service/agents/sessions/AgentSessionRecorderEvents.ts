import {
  AGENT_TODO_LIMIT,
  AGENT_TODO_TEXT_LENGTH,
} from "@/definition/AgentPlanAgentTodos";
import { MAXIMUM_EVENT_TEXT } from "./AgentSessionJournal";

import type { SessionUpdate } from "@agentclientprotocol/sdk";
import type { AgentSessionEventInput } from "./AgentSessionJournal";

/** The Pages tool whose calls become todo lines instead of tool lines. */
export const PROGRESS_TOOL = /update_step_progress/u;

/** Longest command or output kept of one tool call; the journal limits the event as a whole. */
const TOOL_TEXT = 3_000;

/** Longest identity of a tool call that is kept; a provider ID is far shorter. */
const CALL_IDENTITY_LENGTH = 200;

/** What a tool call reported so far: its identity, title, kind and input. */
export interface ToolCallState {
  /** The `toolCallId` of the provider, which pairs every update and result with its call. */
  readonly callId: string;
  title: string;
  kind: string;
  input: string;
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

/** claude-agent-acp wraps a command's output in a fenced block; the terminal shows the output itself. */
function unfenced(text: string): string {
  return FENCED_OUTPUT.exec(text.trim())?.groups?.body ?? text;
}

function outputParts(
  update: Extract<SessionUpdate, { sessionUpdate: "tool_call_update" }>,
): string[] {
  const parts: string[] = [];
  for (const entry of update.content ?? []) {
    if (entry.type === "content" && entry.content.type === "text")
      parts.push(unfenced(entry.content.text));
    else if (entry.type === "diff")
      parts.push(`diff ${entry.path}\n${entry.newText}`);
  }
  const raw = update.rawOutput;
  const output = readRecord(raw);
  if (parts.length === 0 && typeof raw === "string") parts.push(raw);
  else if (parts.length === 0 && output) {
    for (const field of [
      "formatted_output",
      "output",
      "stdout",
      "stderr",
      "result",
    ]) {
      const value = output[field];
      if (typeof value === "string" && value.trim()) parts.push(value);
    }
    if (parts.length === 0) parts.push(JSON.stringify(raw));
  }
  return parts;
}

/** What a tool call returned: its text content, diffs and raw output. */
export function describeOutput(
  update: Extract<SessionUpdate, { sessionUpdate: "tool_call_update" }>,
): ToolOutput {
  const text = outputParts(update).join("\n").trim();
  return {
    text: shortened(text),
    isLimited: text.length > TOOL_TEXT,
    exitCode: reportedExitCode(update.rawOutput),
  };
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
    output && output.exitCode !== null ? `@exit ${output.exitCode}` : "",
    output?.isLimited ? "@limited" : "",
    state.input ? `$ ${state.input.replace(/\n/gu, " ")}` : "",
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
function planText(
  entries: Extract<SessionUpdate, { sessionUpdate: "plan" }>["entries"],
): string {
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
    return typeof todo?.id === "string" && typeof todo.status === "string"
      ? [{ id: todo.id.slice(0, 200), status: todo.status.slice(0, 20) }]
      : [];
  });
  if (todos.length === 0) return null;
  const activity =
    typeof input.activity === "string" ? input.activity.slice(0, 200) : null;
  return JSON.stringify({ todos, activity });
}
