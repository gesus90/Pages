import type { AgentSessionEvent } from "@/definition/AgentSessionJournal";

/** The longest result line of a tool call. */
export const RESULT_LENGTH = 160;
/** Width of the time column and the space after it. */
const TIME_COLUMN = "         ";
/** Indent of a call's expanded output below its time column. */
const OUTPUT_INDENT = `${TIME_COLUMN}  `;

/** The words the tool lines need. */
export interface ToolLineTexts {
  /** The name of a tool kind such as `read` or `execute`; `null` where the title names the call better. */
  readonly toolKind: (kind: string) => string | null;
  readonly done: string;
  readonly aborted: string;
  readonly running: string;
  readonly exitCode: (code: number) => string;
  readonly lineCount: (count: number) => string;
  readonly duration: (milliseconds: number) => string;
  readonly showDetails: string;
  readonly hideDetails: string;
  /** The stored output ends at its limit. */
  readonly outputLimited: string;
}

/** Paints a text in one of the terminal styles. */
export type ToolPainter = (
  style: "muted" | "tool" | "toolName" | "success" | "error",
  text: string,
) => string;

/** One tool call as the terminal draws it. */
export interface ToolLine {
  readonly kind: "tool";
  /** The adapter's stable `toolCallId` within its turn; `null` in history written before Pages stored it. */
  readonly callId: string | null;
  title: string;
  toolKind: string;
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
}

/** Everything a tool event of the journal says. */
interface ToolEventText {
  readonly title: string;
  readonly toolKind: string;
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

/** The first non-empty line, cut to the result length. */
export function firstLine(text: string): string {
  const line = text.split("\n").find((entry) => entry.trim() !== "") ?? "";
  const trimmed = line.trim();
  return trimmed.length > RESULT_LENGTH
    ? `${trimmed.slice(0, RESULT_LENGTH)} …`
    : trimmed;
}

function readMarkers(lines: readonly string[]): {
  readonly markers: Map<string, string>;
  readonly rest: readonly string[];
} {
  const markers = new Map<string, string>();
  let index = 0;
  for (; index < lines.length; index += 1) {
    const match = /^@(kind|call|exit|limited)(?: (.*))?$/u.exec(
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
 * `@exit` and `@limited`, then `$ command` and the output.
 */
export function readToolEvent(event: AgentSessionEvent): ToolEventText {
  const [title = "", ...lines] = plainText(event.text).split("\n");
  const { markers, rest } = readMarkers(lines);
  const hasInput = rest[0]?.startsWith("$ ") === true;
  return {
    title: title.trim(),
    toolKind: markerText(markers, "kind") ?? "other",
    callId: markerText(markers, "call"),
    exitCode: readExitCode(markers.get("exit")),
    isLimited: markers.has("limited") || event.isTruncated,
    input: hasInput ? (rest[0]?.slice(2).trim() ?? "") : "",
    output: (hasInput ? rest.slice(1) : rest).join("\n"),
  };
}

function eventTime(event: AgentSessionEvent): number | null {
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
    input: tool.input,
    startedAt: isStart ? eventTime(event) : null,
    endedAt: isStart ? null : eventTime(event),
    state: toolState(event.kind),
    output: tool.output,
    exitCode: tool.exitCode,
    isLimited: tool.isLimited,
  };
}

/** Name and detail of a call: a known kind names it, its command or path follows. */
export function toolParts(
  tool: ToolLine,
  texts: Pick<ToolLineTexts, "toolKind">,
): { readonly name: string; readonly detail: string } {
  const label = texts.toolKind(tool.toolKind);
  // Arguments of Pages tools and other JSON say less than the title of the call.
  const detail = /^[[{]/u.test(tool.input) ? "" : firstLine(tool.input);
  if (label) return { name: label, detail: detail || tool.title };
  return {
    name: tool.title || "Tool",
    detail: detail && detail !== tool.title ? detail : "",
  };
}

function clockTime(at: number | null): string {
  if (at === null) return "--:--:--";
  return new Date(at).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    // A 24-hour clock keeps the time column eight characters wide.
    hourCycle: "h23",
  });
}

/** Whether the output needs more than its result line: several lines, JSON or a long line. */
function isExpandable(tool: ToolLine): boolean {
  const output = tool.output.trim();
  if (output === "") return false;
  return (
    output.includes("\n") ||
    /^[[{]/u.test(output) ||
    output.length > RESULT_LENGTH ||
    tool.isLimited
  );
}

function outputLineCount(tool: ToolLine): number | null {
  const output = tool.output.replace(/\n+$/u, "");
  // A cut output proves no count.
  if (output.trim() === "" || tool.isLimited) return null;
  return output.split("\n").length;
}

/** Exit code, line count and duration, each only where the history proves it. */
function resultFacts(tool: ToolLine, texts: ToolLineTexts): string[] {
  const facts: string[] = [];
  if (tool.exitCode !== null) facts.push(texts.exitCode(tool.exitCode));
  const lines = outputLineCount(tool);
  if (lines !== null && isExpandable(tool)) facts.push(texts.lineCount(lines));
  if (
    tool.startedAt !== null &&
    tool.endedAt !== null &&
    tool.endedAt >= tool.startedAt
  )
    facts.push(texts.duration(tool.endedAt - tool.startedAt));
  return facts;
}

function resultLine(
  tool: ToolLine,
  options: { readonly hasEnded: boolean; readonly texts: ToolLineTexts },
): string {
  const { texts } = options;
  const facts = resultFacts(tool, texts);
  // An expandable output names its facts; only without any its first line stands for it.
  const summary =
    isExpandable(tool) && facts.length > 0 ? "" : firstLine(tool.output);
  const isFailed =
    tool.state === "failed" || (tool.state === "running" && options.hasEnded);
  const fallback = isFailed ? texts.aborted : texts.done;
  return [summary, ...facts].filter(Boolean).join(" · ") || fallback;
}

function expandedLines(
  tool: ToolLine,
  texts: ToolLineTexts,
  paint: ToolPainter,
): TerminalLine[] {
  const lines = tool.output
    .replace(/\n+$/u, "")
    .split("\n")
    .map((line) => ({ text: `${OUTPUT_INDENT}${line}` }));
  if (tool.isLimited)
    lines.push({
      text: paint("muted", `${OUTPUT_INDENT}… ${texts.outputLimited}`),
    });
  return lines;
}

/**
 * The lines of one call: time, tool and command, then its result.
 * @remarks
 * A finished call with a longer or JSON output offers its full stored output
 * behind a toggle. An exit code appears only when the adapter reported one;
 * a completed call alone is no exit code 0.
 */
export function toolLines(
  tool: ToolLine,
  options: {
    readonly hasEnded: boolean;
    readonly isExpanded: boolean;
    readonly texts: ToolLineTexts;
    readonly paint: ToolPainter;
  },
): readonly TerminalLine[] {
  const { texts, paint } = options;
  const { name, detail } = toolParts(tool, texts);
  const head: TerminalLine = {
    text: `${paint("muted", clockTime(tool.startedAt ?? tool.endedAt))} ${paint("tool", "▸")} ${paint("toolName", name)}${detail ? `  ${detail}` : ""}`,
  };
  // A start without an ID cannot be joined with its end, so it says nothing about it.
  if (tool.state === "running" && tool.callId === null) return [head];
  if (tool.state === "running" && !options.hasEnded)
    return [head, { text: paint("muted", `${TIME_COLUMN}${texts.running}`) }];
  const isSuccess = tool.state === "completed";
  const mark = isSuccess ? paint("success", "✓") : paint("error", "✗");
  const result = resultLine(tool, options);
  if (!isExpandable(tool) || tool.callId === null)
    return [head, { text: `${TIME_COLUMN}${mark} ${result}` }];
  const label = options.isExpanded ? texts.hideDetails : texts.showDetails;
  const toggleLine: TerminalLine = {
    text: `${TIME_COLUMN}${mark} ${result} · ${paint("tool", label)}`,
    toggle: { callId: tool.callId, label },
  };
  return options.isExpanded
    ? [head, toggleLine, ...expandedLines(tool, texts, paint)]
    : [head, toggleLine];
}
