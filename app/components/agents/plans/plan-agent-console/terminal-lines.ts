import { wrapTerminalLine } from "./terminal-wrap";
import {
  applyToolEvent,
  firstLine,
  plainText as plain,
  toolLines,
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
  thought: "\u001b[2;3m",
  tool: "\u001b[36m",
  toolName: "\u001b[1;36m",
  success: "\u001b[32m",
  error: "\u001b[31m",
  todo: "\u001b[33m",
  resume: "\u001b[35m",
} as const;

type Style = keyof typeof STYLE;

/** The rule after the start line of an attempt. */
const RULE = "─".repeat(14);

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
  readonly history: (note: TerminalHistoryNote) => string;
  readonly todoActive: (id: string, text: string) => string;
  readonly todoDone: (id: string) => string;
  readonly turnEnded: string;
  readonly interrupted: string;
  readonly reportReceived: (done: number, total: number) => string;
  readonly sessionClosed: string;
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
  /** The kind or title of the call, such as `Shell`. */
  readonly name: string;
  /** Its command or path; empty when the name says all. */
  readonly detail: string;
  /** Milliseconds since the epoch; `null` when the event time is unreadable. */
  readonly startedAt: number | null;
}

type Block =
  | { readonly kind: "lines"; readonly lines: readonly string[] }
  | { readonly kind: "text"; text: string; readonly style: Style | null }
  | ToolLine;

function styled(style: Style, text: string): string {
  return `${STYLE[style]}${text}${STYLE.reset}`;
}

const paintTool: ToolPainter = (style, text) => styled(style, text);

function localTime(at: string | null): string {
  const date = at ? new Date(at) : null;
  if (!date || Number.isNaN(date.getTime())) return "--:--";
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

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
  const active = changed.filter((todo) => todo.status === "active");
  const done = changed.filter((todo) => todo.status === "done");
  // What is finished comes first, then what starts next.
  const lines =
    done.length > 0
      ? [
          styled(
            "todo",
            `◆ ${done.map((todo) => texts.todoDone(todo.id)).join(" · ")}`,
          ),
        ]
      : [];
  for (const todo of active)
    lines.push(
      styled(
        "todo",
        `◆ ${texts.todoActive(todo.id, todoTexts.get(todo.id) ?? "")}`,
      ),
    );
  if (lines.length > 0) state.blocks.push({ kind: "lines", lines });
}

/** Text of the model: consecutive pieces of one answer form one block. */
function addText(state: BlockState, text: string, style: Style | null): void {
  const last = state.blocks.at(-1);
  if (last?.kind === "text" && last.style === style) {
    last.text += text;
    return;
  }
  state.blocks.push({ kind: "text", text, style });
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

function addStatus(state: BlockState, text: string): void {
  const { texts } = state.input;
  if (
    /^turn \d+ (?:ended|continued)$/u.test(text) ||
    text.startsWith("turn cancelled")
  )
    abortRunningTools(state);
  if (/^turn \d+ ended$/u.test(text))
    state.blocks.push({
      kind: "lines",
      lines: [styled("success", `◆ ${texts.turnEnded}`)],
    });
  else if (text === "turn cancelled by the executor")
    state.blocks.push({
      kind: "lines",
      lines: [styled("resume", `◆ ${texts.interrupted}`)],
    });
}

function addEvent(state: BlockState, event: AgentSessionEvent): void {
  switch (event.kind) {
    case "user_instruction":
    case "repair_instruction":
      state.blocks.push({
        kind: "lines",
        lines: plain(event.text)
          .split("\n")
          .map((line, index) =>
            styled("strong", `${index === 0 ? "> " : "  "}${line}`),
          ),
      });
      return;
    case "agent_message":
      addText(state, plain(event.text), null);
      return;
    case "thought":
      addText(state, plain(event.text), "thought");
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
      addStatus(state, event.text);
      return;
    case "error":
      // How a turn failed is the abort station of the attempt; the line would only repeat it.
      if (/^turn \w+/u.test(event.text)) return;
      state.blocks.push({
        kind: "lines",
        lines: [styled("error", `✗ ${firstLine(plain(event.text))}`)],
      });
      return;
    case "recovery":
      state.blocks.push({
        kind: "lines",
        lines: [styled("resume", `◆ ${firstLine(plain(event.text))}`)],
      });
      return;
    case "plan":
    case "usage":
      // Plans feed the activity, usage the sidebar; they draw no line.
      return;
  }
}

function blockLines(
  block: Block,
  input: TerminalInput,
  hasEnded: boolean,
): readonly TerminalLine[] {
  if (block.kind === "lines") return block.lines.map((text) => ({ text }));
  if (block.kind === "tool")
    return toolLines(block, {
      hasEnded,
      isExpanded:
        block.callId !== null && input.expandedCalls.has(block.callId),
      texts: input.texts,
      paint: paintTool,
    });
  const lines = block.text
    .replace(/\s+$/u, "")
    .replace(/^\n+/u, "")
    .split("\n");
  const text = lines.map((line) => ({
    text: block.style ? styled(block.style, line) : line,
  }));
  // An answer stands apart from tools and todos, as in a CLI.
  return [{ text: "" }, ...text, { text: "" }];
}

function endingLines(
  ending: TerminalEnding,
  texts: TerminalTexts,
): readonly string[] {
  if (ending.kind === "succeeded")
    return [
      styled("success", `◆ ${texts.reportReceived(ending.done, ending.total)}`),
      styled("success", `◆ ${texts.sessionClosed}`),
    ];
  if (ending.kind === "blocked")
    return [
      styled("error", `◆ ${texts.blocked(ending.reason, ending.attempts)}`),
    ];
  if (ending.kind === "stopped") return [styled("error", `◆ ${texts.stopped}`)];
  const { resume } = ending;
  const lines = [
    styled(
      "error",
      `◆ ${resume?.isRepair ? texts.noReport : texts.abort(ending.reason)}`,
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
  return [...lines, styled("resume", `◆ ${text}`)];
}

function attemptLines(
  attempt: TerminalAttempt,
  input: TerminalInput,
  todos: Map<string, string>,
): readonly TerminalLine[] {
  const header = styled(
    "muted",
    `── ${input.provider} · ${input.model} · ${input.texts.attempt(attempt.number)} · ${localTime(attempt.startedAt)} ${RULE}`,
  );
  const note = attempt.historyNote
    ? [
        {
          text: styled(
            "muted",
            `◇ ${input.texts.history(attempt.historyNote)}`,
          ),
        },
      ]
    : [];
  const state: BlockState = { blocks: [], todos, input };
  const prompt =
    attempt.number === 1 && input.prompt
      ? plain(input.prompt)
          .split("\n")
          .map((line, index) => ({
            text: styled("strong", `${index === 0 ? "> " : "  "}${line}`),
          }))
      : [];
  for (const event of attempt.events) addEvent(state, event);
  const body = state.blocks.flatMap((block) =>
    blockLines(block, input, attempt.ending !== null),
  );
  const ending = attempt.ending
    ? endingLines(attempt.ending, input.texts).map((text) => ({ text }))
    : [];
  return [{ text: header }, ...note, ...prompt, ...body, ...ending];
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
 * Every attempt starts with `── Anbieter · Modell · Versuch n · HH:MM` in
 * local time. Prompts and inputs of people are bold, answers plain,
 * thoughts dimmed, tool calls cyan with a green result or a red abort, todo
 * changes yellow, resumes orange and closing stations green. Tool IDs never
 * appear: a tool is named by its title and its command or path, and its
 * start and end are joined by the stored `toolCallId` within its turn alone.
 * A journal without identities pairs a result only with the one running call
 * of its title.
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
      columns === null ? [line.text] : wrapTerminalLine(line.text, columns);
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
  return { ...toolParts(tool, input.texts), startedAt: tool.startedAt };
}
