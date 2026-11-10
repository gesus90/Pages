import { wrapTerminalLine } from "./terminal-wrap";

import type { AgentSessionEvent } from "@/definition/AgentSessionJournal";

/** ANSI styles of the Pages terminal; the colors are the `agent-terminal` tokens of the theme. */
const STYLE = {
  reset: "\u001b[0m",
  strong: "\u001b[1;97m",
  muted: "\u001b[90m",
  thought: "\u001b[2;3m",
  tool: "\u001b[36m",
  success: "\u001b[32m",
  error: "\u001b[31m",
  todo: "\u001b[33m",
  resume: "\u001b[35m",
} as const;

type Style = keyof typeof STYLE;

/** The longest result line of a tool call. */
const RESULT_LENGTH = 160;
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
}

/** The translated words of the terminal. */
export interface TerminalTexts {
  readonly attempt: (number: number) => string;
  /** The name of a tool kind such as `read` or `execute`; `null` where the title names the call better. */
  readonly toolKind: (kind: string) => string | null;
  readonly done: string;
  readonly aborted: string;
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
}

/** The rows of the Pages terminal and where each line before wrapping starts. */
export interface TerminalRows {
  /** ANSI rows, each narrower than the terminal. */
  readonly rows: readonly string[];
  /** For each line before wrapping, the index of its first row. */
  readonly lineStarts: readonly number[];
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

/** One tool call as the terminal draws it. */
interface ToolLine {
  readonly kind: "tool";
  readonly title: string;
  readonly toolKind: string;
  input: string;
  readonly startedAt: number;
  state: "running" | "completed" | "failed";
  output: string;
}

type Block =
  | { readonly kind: "lines"; readonly lines: readonly string[] }
  | { readonly kind: "text"; text: string; readonly style: Style | null }
  | ToolLine;

function styled(style: Style, text: string): string {
  return `${STYLE[style]}${text}${STYLE.reset}`;
}

/** Removes control sequences an adapter may send, so only Pages colors the terminal. */
function plain(text: string): string {
  return text
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/gu, "")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/gu, "");
}

function localTime(at: string | null): string {
  const date = at ? new Date(at) : null;
  if (!date || Number.isNaN(date.getTime())) return "--:--";
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function firstLine(text: string): string {
  const line = text.split("\n").find((entry) => entry.trim() !== "") ?? "";
  const trimmed = line.trim();
  return trimmed.length > RESULT_LENGTH
    ? `${trimmed.slice(0, RESULT_LENGTH)} …`
    : trimmed;
}

/** Title, kind, command and output of a tool event: `title`, `@kind k`, `$ command`, then the output. */
function readTool(text: string): {
  readonly title: string;
  readonly toolKind: string;
  readonly input: string;
  readonly output: string;
} {
  const [title = "", ...rest] = plain(text).split("\n");
  const hasKind = rest[0]?.startsWith("@kind ") === true;
  const afterKind = hasKind ? rest.slice(1) : rest;
  const hasInput = afterKind[0]?.startsWith("$ ") === true;
  return {
    title: title.trim(),
    toolKind: hasKind ? (rest[0]?.slice(6).trim() ?? "other") : "other",
    input: hasInput ? (afterKind[0]?.slice(2).trim() ?? "") : "",
    output: (hasInput ? afterKind.slice(1) : afterKind).join("\n"),
  };
}

/**
 * The running call a result belongs to: the one with the same title, else
 * the oldest one, since an adapter may rename a call when it ends.
 */
function runningTool(
  blocks: readonly Block[],
  title: string,
): ToolLine | undefined {
  const running = blocks.filter(
    (block): block is ToolLine =>
      block.kind === "tool" && block.state === "running",
  );
  return running.find((block) => block.title === title) ?? running[0];
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
  const tool = readTool(event.text);
  const running =
    event.kind === "tool_started"
      ? undefined
      : runningTool(state.blocks, tool.title);
  if (running) {
    running.state = event.kind === "tool_completed" ? "completed" : "failed";
    running.output = tool.output;
    // The input is complete only once the call ended.
    running.input = tool.input || running.input;
    return;
  }
  state.blocks.push({
    kind: "tool",
    title: tool.title,
    toolKind: tool.toolKind,
    input: tool.input,
    startedAt: Date.parse(event.createdAt),
    state: toolState(event.kind),
    output: tool.output,
  });
}

function toolState(kind: AgentSessionEvent["kind"]): ToolLine["state"] {
  if (kind === "tool_completed") return "completed";
  return kind === "tool_failed" ? "failed" : "running";
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
  for (const block of state.blocks)
    if (block.kind === "tool" && block.state === "running")
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

/** Name and detail of a call: a known kind names it, its command or path follows. */
function toolParts(
  tool: ToolLine,
  texts: TerminalTexts,
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

/** `Title  command or path`. */
function toolHead(tool: ToolLine, texts: TerminalTexts): string {
  const { name, detail } = toolParts(tool, texts);
  return detail ? `${name}  ${detail}` : name;
}

function toolLines(
  tool: ToolLine,
  input: TerminalInput,
  hasEnded: boolean,
): readonly string[] {
  const { texts } = input;
  const head = styled("tool", `● ${toolHead(tool, texts)}`);
  // The JSON answer of a Pages tool says less than „done“; its station follows.
  const result = /^[[{]/u.test(tool.output.trimStart())
    ? ""
    : firstLine(tool.output);
  if (tool.state === "completed")
    return [head, styled("success", `  ✓ ${result || texts.done}`)];
  if (tool.state === "failed" || hasEnded)
    return [
      head,
      styled("error", `  ✗ ${firstLine(tool.output) || texts.aborted}`),
    ];
  // How long it runs is the status line below the terminal, so the text never depends on the time.
  return [head];
}

function blockLines(
  block: Block,
  input: TerminalInput,
  hasEnded: boolean,
): readonly string[] {
  if (block.kind === "lines") return block.lines;
  if (block.kind === "tool") return toolLines(block, input, hasEnded);
  const lines = block.text
    .replace(/\s+$/u, "")
    .replace(/^\n+/u, "")
    .split("\n");
  const text = lines.map((line) =>
    block.style ? styled(block.style, line) : line,
  );
  // An answer stands apart from tools and todos, as in a CLI.
  return ["", ...text, ""];
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
): readonly string[] {
  const header = styled(
    "muted",
    `── ${input.provider} · ${input.model} · ${input.texts.attempt(attempt.number)} · ${localTime(attempt.startedAt)} ${RULE}`,
  );
  const state: BlockState = { blocks: [], todos, input };
  const prompt =
    attempt.number === 1 && input.prompt
      ? plain(input.prompt)
          .split("\n")
          .map((line, index) =>
            styled("strong", `${index === 0 ? "> " : "  "}${line}`),
          )
      : [];
  for (const event of attempt.events) addEvent(state, event);
  const body = state.blocks.flatMap((block) =>
    blockLines(block, input, attempt.ending !== null),
  );
  const ending = attempt.ending ? endingLines(attempt.ending, input.texts) : [];
  return [header, ...prompt, ...body, ...ending];
}

/** Collapses runs of empty lines and drops them at the edges of an attempt. */
function compact(lines: readonly string[]): readonly string[] {
  const kept: string[] = [];
  for (const line of lines)
    if (line !== "" || (kept.length > 0 && kept.at(-1) !== "")) kept.push(line);
  while (kept.at(-1) === "") kept.pop();
  return kept;
}

/**
 * Turns the stored ACP history of a node into the lines of the Pages terminal (PAGE-284).
 *
 * @param input - The attempts of the node with their events, the texts and the columns.
 * @returns ANSI rows, the same for every provider, wrapped at word boundaries once the terminal is measured.
 *
 * @remarks
 * Every attempt starts with `── Anbieter · Modell · Versuch n · HH:MM` in
 * local time. Prompts and inputs of people are bold, answers plain,
 * thoughts dimmed, tool calls cyan with a green result or a red abort, todo
 * changes yellow, resumes orange and closing stations green. Tool IDs never
 * appear: a tool is named by its title and its command or path.
 */
export function renderTerminal(input: TerminalInput): TerminalRows {
  const todos = new Map<string, string>();
  const lines = input.attempts.flatMap((attempt, index) => [
    ...(index > 0 ? [""] : []),
    ...compact(attemptLines(attempt, input, todos)),
  ]);
  const { columns } = input;
  const rows: string[] = [];
  const lineStarts: number[] = [];
  for (const line of lines) {
    lineStarts.push(rows.length);
    rows.push(...(columns === null ? [line] : wrapTerminalLine(line, columns)));
  }
  return { rows, lineStarts };
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
  return {
    ...toolParts(tool, input.texts),
    startedAt: Number.isFinite(tool.startedAt) ? tool.startedAt : null,
  };
}
