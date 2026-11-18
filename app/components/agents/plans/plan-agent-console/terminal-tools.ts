import type { AgentSessionEvent } from "@/definition/AgentSessionJournal";

/** The longest result line of a tool call. */
export const RESULT_LENGTH = 160;

/** The words the tool lines need. */
export interface ToolLineTexts {
  /** The name of a tool kind such as `read` or `execute`; `null` where the title names the call better. */
  readonly toolKind: (kind: string) => string | null;
  /** A time of day as `HH:MM:SS` on a 24-hour clock; the app language decides, never the browser. */
  readonly clock: (at: number | null) => string;
  readonly done: string;
  readonly aborted: string;
  readonly running: string;
  readonly exitCode: (code: number) => string;
  readonly lineCount: (count: number) => string;
  readonly duration: (milliseconds: number) => string;
  /** Opens the output of a call, such as „Ausgabe öffnen“. */
  readonly showOutput: string;
  readonly hideOutput: string;
  /** Opens a JSON result and names its lines, such as „JSON öffnen (48 Zeilen)“. */
  readonly showJson: (lines: number) => string;
  readonly hideJson: string;
  /** The stored output ends at its limit. */
  readonly outputLimited: string;
}

/** Paints a text in one of the terminal styles. */
export type ToolPainter = (
  style: "muted" | "toolName" | "success" | "error",
  text: string,
) => string;

/** One tool call as the terminal draws it. */
export interface ToolLine {
  readonly kind: "tool";
  /** The adapter's stable `toolCallId` within its turn; `null` in history written before Pages stored it. */
  readonly callId: string | null;
  title: string;
  toolKind: string;
  /** The tool name of the adapter, such as `Bash`; empty when it reported none. */
  toolName: string;
  /** The short description of the call; empty when it has none. */
  about: string;
  input: string;
  /** When the call started; `null` when only its end is stored. */
  startedAt: number | null;
  endedAt: number | null;
  state: "running" | "completed" | "failed";
  output: string;
  /** A numeric exit code the adapter reported; `null` when it reported none. */
  exitCode: number | null;
  /** The stored output was cut to its limit. */
  isLimited: boolean;
}

/** A line of the terminal that opens or closes the output of a call. */
export interface ToolToggle {
  readonly callId: string;
  readonly label: string;
}

/** A line of the terminal before wrapping, with its toggle when it has one. */
export interface TerminalLine {
  readonly text: string;
  readonly toggle?: ToolToggle;
  /** Columns the following rows of the wrapped line start at; without it they stand behind the line's own marker. */
  readonly hang?: number;
}

/** Everything a tool event of the journal says. */
interface ToolEventText {
  readonly title: string;
  readonly toolKind: string;
  readonly toolName: string;
  readonly about: string;
  readonly callId: string | null;
  readonly exitCode: number | null;
  readonly isLimited: boolean;
  readonly input: string;
  readonly output: string;
}

/** Removes control sequences an adapter may send, so only Pages colors the terminal. */
export function plainText(text: string): string {
  return text
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/gu, "")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/gu, "");
}

/** The first non-empty line, cut to the result length with „…“ at its end. */
export function firstLine(text: string): string {
  const line = text.split("\n").find((entry) => entry.trim() !== "") ?? "";
  const trimmed = line.trim();
  return trimmed.length > RESULT_LENGTH
    ? `${trimmed.slice(0, RESULT_LENGTH - 1).trimEnd()}…`
    : trimmed;
}

function readMarkers(lines: readonly string[]): {
  readonly markers: Map<string, string>;
  readonly rest: readonly string[];
} {
  const markers = new Map<string, string>();
  let index = 0;
  for (; index < lines.length; index += 1) {
    const match = /^@(kind|call|tool|about|exit|limited)(?: (.*))?$/u.exec(
      lines[index] ?? "",
    );
    if (!match) break;
    markers.set(match[1] ?? "", (match[2] ?? "").trim());
  }
  return { markers, rest: lines.slice(index) };
}

/** The text of a marker line; `null` when the marker has no text. */
function markerText(
  markers: ReadonlyMap<string, string>,
  name: string,
): string | null {
  const text = markers.get(name);
  return text === undefined || text === "" ? null : text;
}

function readExitCode(text: string | undefined): number | null {
  if (text === undefined || !/^-?\d+$/u.test(text)) return null;
  return Number.parseInt(text, 10);
}

/**
 * Reads a tool event: its title, then the marker lines `@kind`, `@call`,
 * `@tool`, `@about`, `@exit` and `@limited`, then `$ command` and the output.
 */
export function readToolEvent(event: AgentSessionEvent): ToolEventText {
  const [title = "", ...lines] = plainText(event.text).split("\n");
  const { markers, rest } = readMarkers(lines);
  const hasInput = rest[0]?.startsWith("$ ") === true;
  return {
    title: title.trim(),
    toolKind: markerText(markers, "kind") ?? "other",
    toolName: markerText(markers, "tool") ?? "",
    about: markerText(markers, "about") ?? "",
    callId: markerText(markers, "call"),
    exitCode: readExitCode(markers.get("exit")),
    isLimited: markers.has("limited") || event.isTruncated,
    input: hasInput ? (rest[0]?.slice(2).trim() ?? "") : "",
    output: (hasInput ? rest.slice(1) : rest).join("\n"),
  };
}

/** The time of an event in milliseconds since the epoch; `null` when it is unreadable. */
export function eventTime(event: AgentSessionEvent): number | null {
  const time = Date.parse(event.createdAt);
  return Number.isFinite(time) ? time : null;
}

function toolState(kind: AgentSessionEvent["kind"]): ToolLine["state"] {
  if (kind === "tool_completed") return "completed";
  return kind === "tool_failed" ? "failed" : "running";
}

/**
 * The identity of a call within its turn; a call cannot outlive its turn, so
 * the same provider ID in two turns names two calls.
 */
function callKeyOf(
  event: AgentSessionEvent,
  tool: ToolEventText,
): string | null {
  return tool.callId === null ? null : `${event.turn ?? 0}:${tool.callId}`;
}

/**
 * The drawn call an event belongs to; `undefined` when it opens a new one.
 * @remarks
 * An identified event joins only the call with its identity. An event without
 * identity, a result of a journal from before identities were kept, joins only
 * the one running call without identity that has its title; several such
 * calls stay apart, because the journal cannot tell them apart.
 */
function matchingCall(
  calls: readonly ToolLine[],
  event: AgentSessionEvent,
  tool: ToolEventText,
  callKey: string | null,
): ToolLine | undefined {
  if (callKey !== null) return calls.find((call) => call.callId === callKey);
  if (event.kind === "tool_started") return undefined;
  const candidates = calls.filter(
    (call) =>
      call.callId === null &&
      call.state === "running" &&
      call.title === tool.title,
  );
  return candidates.length === 1 ? candidates[0] : undefined;
}

/**
 * Applies a later event to a call already drawn.
 * @remarks
 * A repeated start adds the input it now knows. The first result ends the
 * call; a later part of a long result extends its output, and a failure is
 * never turned into a success by a later part or a repeated report.
 */
function updateCall(
  call: ToolLine,
  event: AgentSessionEvent,
  tool: ToolEventText,
): void {
  if (event.kind === "tool_started") {
    call.input = tool.input || call.input;
    call.toolName = tool.toolName || call.toolName;
    call.about = tool.about || call.about;
    return;
  }
  if (call.state === "running") {
    call.state = toolState(event.kind);
    call.output = tool.output;
  } else {
    if (event.kind === "tool_failed") call.state = "failed";
    call.output += tool.output;
  }
  call.endedAt = eventTime(event);
  call.title = tool.title || call.title;
  call.toolKind = tool.toolKind === "other" ? call.toolKind : tool.toolKind;
  call.toolName = tool.toolName || call.toolName;
  call.about = tool.about || call.about;
  // The input is complete only once the call ended.
  call.input = tool.input || call.input;
  call.exitCode = tool.exitCode ?? call.exitCode;
  call.isLimited = call.isLimited || tool.isLimited;
}

/**
 * Applies a tool event to the calls drawn so far.
 * @remarks
 * A result joins its call only through the same identity within the same
 * turn; neither an equal title nor the order of arrival joins two identified
 * events. A result without a matching call draws a call of its own.
 * @returns The new call, or `null` when the event updated a drawn one.
 */
export function applyToolEvent(
  calls: readonly ToolLine[],
  event: AgentSessionEvent,
): ToolLine | null {
  const tool = readToolEvent(event);
  const callKey = callKeyOf(event, tool);
  const existing = matchingCall(calls, event, tool, callKey);
  if (existing) {
    updateCall(existing, event, tool);
    return null;
  }
  const isStart = event.kind === "tool_started";
  return {
    kind: "tool",
    callId: callKey,
    title: tool.title,
    toolKind: tool.toolKind,
    toolName: tool.toolName,
    about: tool.about,
    input: tool.input,
    startedAt: isStart ? eventTime(event) : null,
    endedAt: isStart ? null : eventTime(event),
    state: toolState(event.kind),
    output: tool.output,
    exitCode: tool.exitCode,
    isLimited: tool.isLimited,
  };
}

/** The parts of the name of a tool call. */
export interface ToolParts {
  /** The MCP server a call went to, such as `pages`; `null` for any other tool. */
  readonly server: string | null;
  /** The tool, such as `Bash` or `read_ticket`. */
  readonly name: string;
  /** The short description of the call, else the first line of its command; empty when it has neither. */
  readonly detail: string;
}

const MCP_TOOL = /^mcp__(.+?)__(.+)$/u;

/**
 * Name and description of a call.
 * @remarks
 * The tool name of the adapter names the call, else its known kind, else its
 * title. A name `mcp__server__tool` splits into the server and the tool. The
 * description is the short description of the call, else the first line of
 * its command, never a piece from the middle; JSON arguments say less than
 * the title, so they never stand in.
 */
export function toolParts(
  tool: ToolLine,
  texts: Pick<ToolLineTexts, "toolKind">,
): ToolParts {
  const label = texts.toolKind(tool.toolKind) ?? "";
  const named = tool.toolName || label || tool.title || "Tool";
  const mcp = MCP_TOOL.exec(named);
  const name = mcp?.[2] ?? named;
  const command = /^[[{]/u.test(tool.input) ? "" : firstLine(tool.input);
  // Claude Code titles a command with the command itself in backticks.
  const title = tool.title.replace(/^`(.*)`$/su, "$1").trim();
  const fallback = title !== named && title !== name ? firstLine(title) : "";
  return {
    server: mcp?.[1] ?? null,
    name,
    detail: firstLine(tool.about) || command || fallback,
  };
}

/** The name of a call as one text, such as `pages · read_ticket`. */
export function toolDisplayName(parts: ToolParts): string {
  return parts.server === null ? parts.name : `${parts.server} · ${parts.name}`;
}

/**
 * The calls that ran at the same time as another call of the attempt.
 * @param calls - The calls in the order their first event arrived.
 * @param hasEnded - Whether the attempt ended; a call without a result then ends where it started.
 * @remarks
 * Calls arrive in the order they start, so a call is compared only with
 * those that start before it ends, and a long list of sequential calls costs
 * one step per call.
 */
export function parallelCalls(
  calls: readonly ToolLine[],
  hasEnded: boolean,
): ReadonlySet<ToolLine> {
  const parallel = new Set<ToolLine>();
  const startOf = (call: ToolLine): number =>
    call.startedAt ?? call.endedAt ?? 0;
  const endOf = (call: ToolLine): number =>
    call.endedAt ?? (hasEnded ? startOf(call) : Number.POSITIVE_INFINITY);
  for (const [index, call] of calls.entries()) {
    const end = endOf(call);
    for (let next = index + 1; next < calls.length; next += 1) {
      const other = calls[next];
      if (!other || startOf(other) >= end) break;
      parallel.add(call);
      parallel.add(other);
    }
  }
  return parallel;
}
