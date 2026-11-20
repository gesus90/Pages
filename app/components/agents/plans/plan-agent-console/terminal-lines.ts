import { GUTTER_WIDTH, EMPTY_GUTTER, timeGutter } from "./terminal-gutter";
import { toolLines } from "./terminal-tool-lines";
import { wrapTerminalLine } from "./terminal-wrap";
import {
  applyToolEvent,
  eventTime,
  firstLine,
  parallelCalls,
  plainText as plain,
  toolDisplayName,
  toolParts,
} from "./terminal-tools";

import type { AgentSessionEvent } from "@/definition/AgentSessionJournal";
import type {
  TerminalLine,
  ToolLine,
  ToolLineTexts,
  ToolPainter,
} from "./terminal-tools";

/** ANSI styles of the Pages terminal; the colors are the `agent-terminal` tokens of the theme. */
const STYLE = {
  reset: "\u001b[0m",
  strong: "\u001b[1;97m",
  muted: "\u001b[90m",
  thought: "\u001b[90;3m",
  toolName: "\u001b[1;36m",
  success: "\u001b[32m",
  error: "\u001b[31m",
  todo: "\u001b[33m",
  resume: "\u001b[35m",
} as const;

type Style = keyof typeof STYLE;

/** The rule after the start line of an attempt, when the width of the terminal is not known. */
const RULE = "─".repeat(14);
/** The shortest rule worth drawing after the start line. */
const MINIMUM_RULE = 3;
/** Columns of a mark such as `✓ ` or `☐ ` and the text column before it. */
const MARK_HANG = GUTTER_WIDTH + 2;

/** How an attempt ended, as the step tells it; `null` while it runs. */
export type TerminalEnding =
  | {
      readonly kind: "aborted";
      readonly reason: string;
      /** The planned resume; absent when none follows. */
      readonly resume: {
        readonly delaySeconds: number;
        readonly restart: number;
        readonly limit: number;
        readonly isSameSession: boolean;
        /** A repair round of the agent instead of a restart after a technical failure. */
        readonly isRepair: boolean;
      } | null;
    }
  | {
      readonly kind: "succeeded";
      readonly done: number;
      readonly total: number;
    }
  | {
      readonly kind: "blocked";
      readonly reason: string;
      readonly attempts: number;
    }
  | { readonly kind: "stopped" };

/** One attempt of the node with its history. */
export interface TerminalAttempt {
  /** Counts from 1. */
  readonly number: number;
  readonly startedAt: string | null;
  readonly events: readonly AgentSessionEvent[];
  readonly ending: TerminalEnding | null;
  /** Why the stored history of the attempt is incomplete; `null` when it is complete. */
  readonly historyNote?: TerminalHistoryNote | null;
}

/**
 * How the stored history of an attempt is incomplete: older entries were
 * removed by retention, only the short lines of an older record exist, or
 * nothing is stored.
 */
export type TerminalHistoryNote = "retained" | "legacy" | "missing";

/** The translated words of the terminal. */
export interface TerminalTexts extends ToolLineTexts {
  readonly attempt: (number: number) => string;
  /** A time of day as `HH:MM` on a 24-hour clock, for the start line of an attempt. */
  readonly minute: (at: string | null) => string;
  readonly history: (note: TerminalHistoryNote) => string;
  /** A todo of the contract: its ID and its text. */
  readonly todo: (id: string, text: string) => string;
  readonly turnEnded: string;
  readonly interrupted: string;
  readonly reportReceived: (done: number, total: number) => string;
  readonly sessionClosed: string;
  /** The closing line of a swarm session, such as „H1 abgeschlossen“; `null` outside a swarm. */
  readonly swarmClosed: string | null;
  readonly abort: (reason: string) => string;
  /** A turn ended without a valid report; a repair round follows. */
  readonly noReport: string;
  readonly resume: (
    seconds: number,
    restart: number,
    limit: number,
    isSameSession: boolean,
  ) => string;
  readonly repair: (
    restart: number,
    limit: number,
    isSameSession: boolean,
  ) => string;
  readonly blocked: (reason: string, attempts: number) => string;
  readonly stopped: string;
}

/** Everything the terminal of one node shows. */
export interface TerminalInput {
  readonly provider: string;
  readonly model: string;
  /** The session of a swarm, such as `H1`; it stands between model and attempt in the start line. */
  readonly sessionLabel?: string;
  /** The instruction of the node, shown as the plan prompt of the first attempt. */
  readonly prompt: string | null;
  readonly attempts: readonly TerminalAttempt[];
  /** The text of each todo of the contract, by its ID such as `T1`. */
  readonly todoTexts: ReadonlyMap<string, string>;
  /** Columns of a measured terminal; `null` keeps the lines unwrapped. */
  readonly columns: number | null;
  readonly texts: TerminalTexts;
  /** The `toolCallId` of every call whose full output the reader opened. */
  readonly expandedCalls: ReadonlySet<string>;
}

/** Where a toggle of a call's output stands among the rows, columns from 1 and inclusive. */
export interface TerminalRowToggle {
  readonly row: number;
  readonly startColumn: number;
  readonly endColumn: number;
  readonly callId: string;
}

/** The rows of the Pages terminal and where each line before wrapping starts. */
export interface TerminalRows {
  /** ANSI rows, each narrower than the terminal. */
  readonly rows: readonly string[];
  /** For each line before wrapping, the index of its first row. */
  readonly lineStarts: readonly number[];
  /** The rows that open or close the output of a call. */
  readonly toggles: readonly TerminalRowToggle[];
}

/** The newest tool call of the running attempt that has no result yet. */
export interface TerminalRunningTool {
  /** The tool, such as `Bash` or `pages · read_ticket`. */
  readonly name: string;
  /** Its short description or the first line of its command; empty when the name says all. */
  readonly detail: string;
  /** Milliseconds since the epoch; `null` when the event time is unreadable. */
  readonly startedAt: number | null;
}

type Block =
  | {
      readonly kind: "lines";
      /** When the event happened; the time column of the first line. */
      readonly at: number | null;
      /** Lines in one style each, starting with their mark such as `☐`. */
      readonly lines: readonly string[];
    }
  | {
      readonly kind: "text";
      readonly at: number | null;
      text: string;
      readonly style: Style | null;
    }
  | ToolLine;

function styled(style: Style, text: string): string {
  return `${STYLE[style]}${text}${STYLE.reset}`;
}

const paintTool: ToolPainter = (style, text) => styled(style, text);

/** The todo states of an `update_step_progress` event; an unreadable one reports none. */
function readProgress(
  text: string,
): readonly { readonly id: string; readonly status: string }[] {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) return [];
    const todos = "todos" in parsed ? parsed.todos : null;
    if (!Array.isArray(todos)) return [];
    return todos.flatMap((entry: unknown) =>
      typeof entry === "object" &&
      entry !== null &&
      "id" in entry &&
      "status" in entry &&
      typeof entry.id === "string" &&
      typeof entry.status === "string"
        ? [{ id: entry.id, status: entry.status }]
        : [],
    );
  } catch {
    return [];
  }
}

/** Tracks what the terminal already said about todos and running tools. */
interface BlockState {
  readonly blocks: Block[];
  readonly todos: Map<string, string>;
  readonly input: TerminalInput;
}

function addTool(state: BlockState, event: AgentSessionEvent): void {
  const calls = state.blocks.filter(
    (block): block is ToolLine => block.kind === "tool",
  );
  const added = applyToolEvent(calls, event);
  if (added) state.blocks.push(added);
}

function addProgress(state: BlockState, event: AgentSessionEvent): void {
  const { texts, todoTexts } = state.input;
  const changed = readProgress(event.text).filter(
    (todo) => state.todos.get(todo.id) !== todo.status,
  );
  for (const todo of changed) state.todos.set(todo.id, todo.status);
  const todoLine = (mark: string, id: string): string =>
    styled("todo", `${mark} ${texts.todo(id, todoTexts.get(id) ?? "")}`);
  // What is finished comes first, then what starts next.
  const lines = [
    ...changed
      .filter((todo) => todo.status === "done")
      .map((todo) => todoLine("☑", todo.id)),
    ...changed
      .filter((todo) => todo.status === "active")
      .map((todo) => todoLine("☐", todo.id)),
  ];
  if (lines.length > 0)
    state.blocks.push({ kind: "lines", at: eventTime(event), lines });
}

/** Text of the model: consecutive pieces of one answer form one block. */
function addText(
  state: BlockState,
  event: AgentSessionEvent,
  style: Style | null,
): void {
  const text = plain(event.text);
  const last = state.blocks.at(-1);
  if (last?.kind === "text" && last.style === style) {
    last.text += text;
    return;
  }
  state.blocks.push({ kind: "text", at: eventTime(event), text, style });
}

/** A prompt ended: a tool call it left without a result was cut short. */
function abortRunningTools(state: BlockState): void {
  // A start without an ID cannot be joined with its end, so it is never called cut short.
  for (const block of state.blocks)
    if (
      block.kind === "tool" &&
      block.state === "running" &&
      block.callId !== null
    )
      block.state = "failed";
}

function addStatus(state: BlockState, event: AgentSessionEvent): void {
  const { texts } = state.input;
  const { text } = event;
  if (
    /^turn \d+ (?:ended|continued)$/u.test(text) ||
    text.startsWith("turn cancelled")
  )
    abortRunningTools(state);
  const at = eventTime(event);
  if (/^turn \d+ ended$/u.test(text))
    state.blocks.push({
      kind: "lines",
      at,
      lines: [styled("success", `✓ ${texts.turnEnded}`)],
    });
  else if (text === "turn cancelled by the executor")
    state.blocks.push({
      kind: "lines",
      at,
      lines: [styled("resume", `↻ ${texts.interrupted}`)],
    });
}

function addEvent(state: BlockState, event: AgentSessionEvent): void {
  switch (event.kind) {
    case "user_instruction":
    case "repair_instruction":
      state.blocks.push({
        kind: "lines",
        at: eventTime(event),
        lines: promptLines(event.text),
      });
      return;
    case "agent_message":
      addText(state, event, null);
      return;
    case "thought":
      addText(state, event, "thought");
      return;
    case "tool_started":
    case "tool_completed":
    case "tool_failed":
      addTool(state, event);
      return;
    case "progress":
      addProgress(state, event);
      return;
    case "status":
      addStatus(state, event);
      return;
    case "error":
      // How a turn failed is the abort station of the attempt; the line would only repeat it.
      if (/^turn \w+/u.test(event.text)) return;
      state.blocks.push({
        kind: "lines",
        at: eventTime(event),
        lines: [styled("error", `✕ ${firstLine(plain(event.text))}`)],
      });
      return;
    case "recovery":
      state.blocks.push({
        kind: "lines",
        at: eventTime(event),
        lines: [styled("resume", `↻ ${firstLine(plain(event.text))}`)],
      });
      return;
    case "plan":
    case "usage":
      // Plans feed the activity, usage the sidebar; they draw no line.
      return;
  }
}

/** The prompt or instruction of a person: bold, the first line with its `>`. */
function promptLines(text: string): readonly string[] {
  return plain(text)
    .split("\n")
    .map((line, index) =>
      styled("strong", `${index === 0 ? "> " : "  "}${line}`),
    );
}

/** Where a block's lines stand: the time column on the first line, the text column behind it. */
function withGutter(
  lines: readonly string[],
  options: {
    readonly at: number | null;
    readonly texts: TerminalTexts;
    /** Columns the wrapped rows of a line start at. */
    readonly hang: number;
  },
): readonly TerminalLine[] {
  const time = timeGutter(options.texts.clock(options.at), (text) =>
    styled("muted", text),
  );
  return lines.map((text, index) => ({
    text: text === "" ? "" : `${index === 0 ? time : EMPTY_GUTTER}${text}`,
    hang: options.hang,
  }));
}

function blockLines(
  block: Block,
  context: {
    readonly input: TerminalInput;
    readonly hasEnded: boolean;
    readonly parallel: ReadonlySet<ToolLine>;
  },
): readonly TerminalLine[] {
  const { input } = context;
  if (block.kind === "lines")
    return withGutter(block.lines, {
      at: block.at,
      texts: input.texts,
      hang: MARK_HANG,
    });
  if (block.kind === "tool")
    return toolLines(block, {
      hasEnded: context.hasEnded,
      isExpanded:
        block.callId !== null && input.expandedCalls.has(block.callId),
      isParallel: context.parallel.has(block),
      texts: input.texts,
      paint: paintTool,
    });
  const lines = block.text
    .replace(/\s+$/u, "")
    .replace(/^\n+/u, "")
    .split("\n")
    .map((line) => (line === "" ? "" : styled(block.style ?? "strong", line)));
  // An answer stands apart from tools and todos, as in a CLI.
  return [
    { text: "" },
    ...withGutter(lines, {
      at: block.at,
      texts: input.texts,
      hang: GUTTER_WIDTH,
    }),
    { text: "" },
  ];
}

function endingLines(
  ending: TerminalEnding,
  texts: TerminalTexts,
): readonly string[] {
  if (ending.kind === "succeeded" && texts.swarmClosed !== null)
    return [styled("success", `✓ ${texts.swarmClosed}`)];
  if (ending.kind === "succeeded")
    return [
      styled("success", `✓ ${texts.reportReceived(ending.done, ending.total)}`),
      styled("success", `✓ ${texts.sessionClosed}`),
    ];
  if (ending.kind === "blocked")
    return [
      styled("error", `✕ ${texts.blocked(ending.reason, ending.attempts)}`),
    ];
  if (ending.kind === "stopped") return [styled("error", `✕ ${texts.stopped}`)];
  const { resume } = ending;
  const lines = [
    styled(
      "error",
      `✕ ${resume?.isRepair ? texts.noReport : texts.abort(ending.reason)}`,
    ),
  ];
  if (!resume) return lines;
  const text = resume.isRepair
    ? texts.repair(resume.restart, resume.limit, resume.isSameSession)
    : texts.resume(
        resume.delaySeconds,
        resume.restart,
        resume.limit,
        resume.isSameSession,
      );
  return [...lines, styled("resume", `↻ ${text}`)];
}

/**
 * The start line of an attempt: provider, model, attempt and the minute it began, then a rule to the right edge.
 * @remarks
 * The rule fills the measured width of the terminal; without a measure it has a fixed length.
 */
function startLine(
  attempt: TerminalAttempt,
  input: TerminalInput,
): TerminalLine {
  const { texts, columns } = input;
  const session = input.sessionLabel ? ` · ${input.sessionLabel}` : "";
  const label = `${input.provider} · ${input.model}${session} · ${texts.attempt(attempt.number)} · ${texts.minute(attempt.startedAt)}`;
  const ruleLength =
    columns === null ? RULE.length : columns - [...label].length - 1;
  const rule = ruleLength >= MINIMUM_RULE ? ` ${"─".repeat(ruleLength)}` : "";
  return { text: styled("muted", `${label}${rule}`) };
}

function attemptLines(
  attempt: TerminalAttempt,
  input: TerminalInput,
  todos: Map<string, string>,
): readonly TerminalLine[] {
  const note = attempt.historyNote
    ? [
        {
          text: `${EMPTY_GUTTER}${styled("muted", `◇ ${input.texts.history(attempt.historyNote)}`)}`,
          hang: MARK_HANG,
        },
      ]
    : [];
  const state: BlockState = { blocks: [], todos, input };
  const prompt =
    attempt.number === 1 && input.prompt
      ? promptLines(input.prompt).map((text) => ({
          text: `${EMPTY_GUTTER}${text}`,
          hang: MARK_HANG,
        }))
      : [];
  for (const event of attempt.events) addEvent(state, event);
  const hasEnded = attempt.ending !== null;
  const calls = state.blocks.filter(
    (block): block is ToolLine => block.kind === "tool",
  );
  const context = {
    input,
    hasEnded,
    parallel: parallelCalls(calls, hasEnded),
  };
  const body = state.blocks.flatMap((block) => blockLines(block, context));
  // The station of the attempt's end is dated by the last thing it did.
  const lastEvent = attempt.events.at(-1);
  const endedAt = lastEvent ? eventTime(lastEvent) : null;
  const ending = attempt.ending
    ? withGutter(endingLines(attempt.ending, input.texts), {
        at: endedAt,
        texts: input.texts,
        hang: MARK_HANG,
      })
    : [];
  return [startLine(attempt, input), ...note, ...prompt, ...body, ...ending];
}

/** Collapses runs of empty lines and drops them at the edges of an attempt. */
function compact(lines: readonly TerminalLine[]): readonly TerminalLine[] {
  const kept: TerminalLine[] = [];
  for (const line of lines)
    if (line.text !== "" || (kept.length > 0 && kept.at(-1)?.text !== ""))
      kept.push(line);
  while (kept.at(-1)?.text === "") kept.pop();
  return kept;
}

/** The columns of a toggle's label in the last row of its wrapped line. */
function toggleOf(
  rows: readonly string[],
  line: TerminalLine,
): (Omit<TerminalRowToggle, "row"> & { readonly offset: number }) | null {
  const toggle = line.toggle;
  if (!toggle) return null;
  for (let offset = rows.length - 1; offset >= 0; offset -= 1) {
    const column = plain(rows[offset] ?? "").lastIndexOf(toggle.label);
    if (column >= 0)
      return {
        offset,
        startColumn: column + 1,
        endColumn: column + toggle.label.length,
        callId: toggle.callId,
      };
  }
  return null;
}

/**
 * Turns the stored ACP history of a node into the lines of the Pages terminal.
 *
 * @param input - The attempts of the node with their events, the texts and the columns.
 * @returns ANSI rows, the same for every provider, wrapped at word boundaries once the terminal is measured.
 *
 * @remarks
 * Every attempt starts with `Anbieter · Modell · Versuch n · HH:MM` and a
 * rule; every other line stands in the text column behind a time column of
 * `HH:MM:SS` on a 24-hour clock in the app language. Prompts and inputs of
 * people and answers are bold, thoughts muted and italic, a tool call is `▸`,
 * its name in bold and its description, followed by its result `✓` in green
 * or `✕` in red, todos yellow, restarts violet with `↻` and closing stations
 * green or red. Tool IDs never appear: a tool is named by its tool name or
 * title and its description or command, and its start and end are joined by
 * the stored `toolCallId` within its turn alone. A journal without
 * identities pairs a result only with the one running call of its title.
 */
export function renderTerminal(input: TerminalInput): TerminalRows {
  const todos = new Map<string, string>();
  const lines = input.attempts.flatMap((attempt, index) => [
    ...(index > 0 ? [{ text: "" }] : []),
    ...compact(attemptLines(attempt, input, todos)),
  ]);
  const { columns } = input;
  const rows: string[] = [];
  const lineStarts: number[] = [];
  const toggles: TerminalRowToggle[] = [];
  for (const line of lines) {
    lineStarts.push(rows.length);
    const wrapped =
      columns === null
        ? [line.text]
        : wrapTerminalLine(line.text, columns, line.hang);
    const toggle = toggleOf(wrapped, line);
    if (toggle) {
      const { offset, ...columnsOfLabel } = toggle;
      toggles.push({ ...columnsOfLabel, row: rows.length + offset });
    }
    rows.push(...wrapped);
  }
  return { rows, lineStarts, toggles };
}

/**
 * The newest tool call of the running attempt that has no result yet, for the status line.
 *
 * @param input - The same input the terminal draws.
 * @returns The call, or `null` when the last attempt ended or no call runs.
 */
export function runningTerminalTool(
  input: TerminalInput,
): TerminalRunningTool | null {
  const attempt = input.attempts.at(-1);
  if (!attempt || attempt.ending) return null;
  const state: BlockState = { blocks: [], todos: new Map(), input };
  for (const event of attempt.events) addEvent(state, event);
  const tool = state.blocks.findLast(
    (block): block is ToolLine =>
      block.kind === "tool" && block.state === "running",
  );
  if (!tool) return null;
  const parts = toolParts(tool, input.texts);
  return {
    name: toolDisplayName(parts),
    detail: parts.detail,
    startedAt: tool.startedAt,
  };
}
