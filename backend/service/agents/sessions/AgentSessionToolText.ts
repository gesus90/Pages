import {
  AGENT_TODO_LIMIT,
  AGENT_TODO_TEXT_LENGTH,
} from "@/definition/AgentPlanAgentTodos";

import { MAXIMUM_EVENT_TEXT } from "./AgentSessionJournal";

import type { AgentSessionCost } from "@/definition/AgentSessionJournal";
import type { AgentSessionEventInput } from "./AgentSessionJournal";
import type { SessionUpdate } from "@agentclientprotocol/sdk";

/** The key under which claude-agent-acp names the model of a usage update. */
const CLAUDE_MODEL_KEY = "_claude/model";

/** Longest command or output kept of one tool call; the journal limits the event as a whole. */
const TOOL_TEXT = 3_000;

/** What a tool call reported so far: its title, kind and input. */
export interface ToolCallState {
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

/** What a tool call returned: its text content, diffs and raw output. */
export function describeOutput(
  update: Extract<SessionUpdate, { sessionUpdate: "tool_call_update" }>,
): string {
  const parts: string[] = [];
  for (const entry of update.content ?? []) {
    if (entry.type === "content" && entry.content.type === "text")
      parts.push(entry.content.text);
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
  return shortened(parts.join("\n").trim());
}

/**
 * The text of a tool call: its title, its kind, the command and, once it ended, its output.
 *
 * @remarks
 * A call without a title is named by its kind, never by the internal ID of
 * the call, which says nothing to a reader. The kind line (`@kind read`)
 * lets the Pages terminal name the call the same way for every provider.
 */
export function toolText(state: ToolCallState, output = ""): string {
  const title = state.title.trim() || state.kind;
  return [
    title,
    `@kind ${state.kind}`,
    state.input ? `$ ${state.input}` : "",
    output,
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

/** The cost of the update, as far as the adapter reports a finite amount and currency. */
export function readCost(
  update: Extract<SessionUpdate, { sessionUpdate: "usage_update" }>,
): AgentSessionCost | null {
  const cost = update.cost;
  return cost && Number.isFinite(cost.amount) && cost.currency
    ? { amount: cost.amount, currency: cost.currency.slice(0, 10) }
    : null;
}

/** The model an ACP usage update names through its Claude-specific meta key. */
export function reportedModel(
  update: Extract<SessionUpdate, { sessionUpdate: "usage_update" }>,
): string | null {
  const model = update._meta?.[CLAUDE_MODEL_KEY];
  return typeof model === "string" && model.length > 0 ? model : null;
}
