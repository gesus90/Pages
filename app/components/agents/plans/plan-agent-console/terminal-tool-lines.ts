import { EMPTY_GUTTER, OUTPUT_INDENT, timeGutter } from "./terminal-gutter";
import {
  RESULT_LENGTH,
  firstLine,
  toolDisplayName,
  toolParts,
} from "./terminal-tools";

import type {
  TerminalLine,
  ToolLine,
  ToolLineTexts,
  ToolPainter,
} from "./terminal-tools";

/** A no-break space keeps the words of a toggle together, so wrapping never splits its link. */
const NO_BREAK = " ";
/** Shorter outputs stand in the result line; from three lines on only an opener does. */
const LONG_OUTPUT_LINES = 3;
/** Columns of the follow-up rows of a call: its mark and the blank after it. */
const HEAD_HANG = 12;

/** What a finished call returned, as the lines the reader can open. */
interface OutputView {
  readonly lines: readonly string[];
  readonly isJson: boolean;
}

/** The parsed JSON of a text; `undefined` for text that only starts like JSON, such as `[main abc123] message`. */
function parseJson(text: string): unknown {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    return undefined;
  }
}

/** The output as lines; a JSON result is indented, so its line count is what the reader opens. */
function outputView(tool: ToolLine): OutputView | null {
  const text = tool.output.replace(/\n+$/u, "");
  if (text.trim() === "") return null;
  const parsed = tool.isLimited ? undefined : parseJson(text);
  if (typeof parsed === "object" && parsed !== null)
    return {
      lines: JSON.stringify(parsed, null, 2).split("\n"),
      isJson: true,
    };
  return { lines: text.split("\n"), isJson: false };
}

/** Whether the output needs an opener instead of the result line: three lines, JSON, a long line or a cut. */
function isLong(tool: ToolLine, view: OutputView | null): boolean {
  if (!view) return false;
  return (
    view.isJson ||
    tool.isLimited ||
    view.lines.length >= LONG_OUTPUT_LINES ||
    view.lines.some((line) => line.length > RESULT_LENGTH)
  );
}

/** Line count and duration, each only where the history proves it. */
function resultFacts(
  tool: ToolLine,
  view: OutputView | null,
  texts: ToolLineTexts,
): string[] {
  const facts: string[] = [];
  // A cut output proves no count; a JSON result names its lines in its opener.
  if (view && isLong(tool, view) && !view.isJson && !tool.isLimited)
    facts.push(texts.lineCount(view.lines.length));
  if (
    tool.startedAt !== null &&
    tool.endedAt !== null &&
    tool.endedAt >= tool.startedAt
  )
    facts.push(texts.duration(tool.endedAt - tool.startedAt));
  return facts;
}

/** A short output as one text; a long one never stands in the result line. */
function outputSummary(view: OutputView | null, isLongOutput: boolean): string {
  if (!view || isLongOutput) return "";
  return firstLine(view.lines.filter((line) => line.trim() !== "").join(" · "));
}

/** The words of an opener or closer of the output, bound by no-break spaces. */
function toggleLabel(
  view: OutputView | null,
  options: { readonly isExpanded: boolean; readonly texts: ToolLineTexts },
): string {
  const { texts } = options;
  const isJson = view?.isJson === true;
  let words: string;
  if (options.isExpanded) words = isJson ? texts.hideJson : texts.hideOutput;
  else if (isJson) words = texts.showJson(view?.lines.length ?? 0);
  else words = texts.showOutput;
  const mark = options.isExpanded ? "▾" : "▸";
  return `${mark}${NO_BREAK}${words.replaceAll(" ", NO_BREAK)}`;
}

interface ResultOptions {
  readonly hasEnded: boolean;
  readonly isParallel: boolean;
  readonly texts: ToolLineTexts;
}

/** The words after the ✓ or ✕: the tool name of a parallel call, then output, facts and duration. */
function resultText(
  tool: ToolLine,
  view: OutputView | null,
  options: ResultOptions,
): string {
  const { texts } = options;
  const parts = toolParts(tool, texts);
  const isFailed =
    tool.state === "failed" || (tool.state === "running" && options.hasEnded);
  // The exit code comes first, as the reader looks for it first; a success
  // with exit code 0 says nothing the ✓ does not.
  const isPlainSuccess = tool.exitCode === 0 && !isFailed;
  const body = [
    tool.exitCode === null || isPlainSuccess
      ? ""
      : texts.exitCode(tool.exitCode),
    outputSummary(view, isLong(tool, view)),
    ...resultFacts(tool, view, texts),
  ].filter(Boolean);
  if (body.length === 0) body.push(isFailed ? texts.aborted : texts.done);
  // Calls that ran side by side end in any order, so each result names its tool.
  const names = options.isParallel ? [toolDisplayName(parts)] : [];
  return [...names, ...body].join(" · ");
}

function expandedLines(
  tool: ToolLine,
  view: OutputView,
  options: { readonly texts: ToolLineTexts; readonly paint: ToolPainter },
): TerminalLine[] {
  const lines = view.lines.map((line) => ({ text: `${OUTPUT_INDENT}${line}` }));
  if (tool.isLimited)
    lines.push({
      text: options.paint(
        "muted",
        `${OUTPUT_INDENT}… ${options.texts.outputLimited}`,
      ),
    });
  return lines;
}

function headLine(
  tool: ToolLine,
  texts: ToolLineTexts,
  paint: ToolPainter,
): TerminalLine {
  const parts = toolParts(tool, texts);
  const time = timeGutter(texts.clock(tool.startedAt ?? tool.endedAt), (text) =>
    paint("muted", text),
  );
  const server =
    parts.server === null ? "" : paint("muted", `${parts.server} · `);
  const detail = parts.detail === "" ? "" : `  ${parts.detail}`;
  return {
    text: `${time}${paint("muted", "▸")} ${server}${paint("toolName", parts.name)}${detail}`,
    hang: HEAD_HANG,
  };
}

/**
 * The lines of one call: time, ▸, tool and description, then its result.
 * @param tool - The call.
 * @param options - Whether the attempt ended, whether the call opens its output, whether it ran side by side with another call, the words and the painter.
 * @remarks
 * The result stands on its own line in the text column: ✓ in the success
 * style or ✕ in the error style, then the exit code where the adapter
 * reported one other than a successful 0, the lines and the duration. A
 * call with a longer or JSON output never draws it: the line ends with a
 * link to open it, and the opened output belongs to this call alone, joined
 * by its `toolCallId`.
 */
export function toolLines(
  tool: ToolLine,
  options: {
    readonly hasEnded: boolean;
    readonly isExpanded: boolean;
    readonly isParallel: boolean;
    readonly texts: ToolLineTexts;
    readonly paint: ToolPainter;
  },
): readonly TerminalLine[] {
  const { texts, paint } = options;
  const head = headLine(tool, texts, paint);
  // A start without an ID cannot be joined with its end, so it says nothing about it.
  if (tool.state === "running" && tool.callId === null) return [head];
  if (tool.state === "running" && !options.hasEnded)
    return [head, { text: paint("muted", `${EMPTY_GUTTER}${texts.running}`) }];
  const isSuccess = tool.state === "completed";
  const view = outputView(tool);
  const text = resultText(tool, view, options);
  const mark = isSuccess ? "✓" : "✕";
  const result = paint(isSuccess ? "success" : "error", `${mark} ${text}`);
  if (!view || !isLong(tool, view) || tool.callId === null)
    return [head, { text: `${EMPTY_GUTTER}${result}`, hang: HEAD_HANG }];
  const label = toggleLabel(view, options);
  const toggleLine: TerminalLine = {
    text: `${EMPTY_GUTTER}${result}  ${paint("muted", label)}`,
    toggle: { callId: tool.callId, label },
    hang: HEAD_HANG,
  };
  return options.isExpanded
    ? [head, toggleLine, ...expandedLines(tool, view, options)]
    : [head, toggleLine];
}
