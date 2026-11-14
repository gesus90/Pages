import type {
  LiveAnswerChatKind,
  LiveAnswerDelivery,
  LiveAnswerEnd,
  LiveAnswerEventPayload,
  LiveAnswerHead,
  LiveAnswerThought,
  LiveAnswerTool,
} from "@/definition/ConversationLiveAnswer";

/** One answer as the chat page shows it while it is written and right after (PAGE-381). */
export interface LiveAnswerView {
  readonly answerId: string;
  readonly chatKind: LiveAnswerChatKind;
  readonly chatId: string;
  readonly agentId: string;
  /** The number of the last part the page took. */
  readonly seq: number;
  readonly startedAt: string;
  /** ISO time of the last part. */
  readonly lastAt: string;
  readonly text: string;
  readonly thought: LiveAnswerThought | null;
  readonly tools: readonly LiveAnswerTool[];
  readonly end: LiveAnswerEnd | null;
}

/** How a message reached an agent, as the stream told it. */
export interface LiveDelivery {
  readonly delivery: LiveAnswerDelivery;
  readonly agentId: string;
}

/** Everything the page knows of the answers being written. */
export interface LiveAnswerState {
  readonly answers: Readonly<Record<string, LiveAnswerView>>;
  readonly deliveries: Readonly<Record<string, LiveDelivery>>;
}

/** The chat a view belongs to. */
export interface LiveChat {
  readonly chatKind: LiveAnswerChatKind;
  readonly chatId: string;
}

/** What an agent is doing now, for the line at the input. */
export type LiveActivity =
  | { readonly kind: "writing" }
  | { readonly kind: "thinking" }
  | { readonly kind: "working" }
  /** The agent generates images with its model (PAGE-382), such as "erzeugt 4 Bilder …". */
  | { readonly kind: "images"; readonly count: number }
  /** The agent generates a video or a sound with its model (PAGE-384), such as "erzeugt Video …". */
  | { readonly kind: "video" }
  | { readonly kind: "audio" }
  | {
      readonly kind: "tool";
      /** The action the call stands for, such as `read` or `test`. */
      readonly action: ToolAction;
      /** The file, command or input the call works on; empty when it names none. */
      readonly target: string;
      readonly running: number;
    };

/** The actions the line at the input names for a tool call. */
export type ToolAction =
  "read" | "edit" | "test" | "run" | "search" | "browse" | "use";

/** The state before anything arrived. */
export const EMPTY_LIVE_STATE: LiveAnswerState = { answers: {}, deliveries: {} };

const TOOL_ACTIONS: readonly {
  readonly pattern: RegExp;
  readonly action: ToolAction;
}[] = [
  { pattern: /\b(?:vitest|jest|pytest|test)\b/iu, action: "test" },
  { pattern: /read|view|cat|open/iu, action: "read" },
  { pattern: /edit|write|patch|apply|create|save|update|set_/iu, action: "edit" },
  { pattern: /grep|glob|search|find|list|query/iu, action: "search" },
  { pattern: /fetch|browse|web|url|http/iu, action: "browse" },
  { pattern: /bash|shell|exec|command|terminal|run/iu, action: "run" },
];

function emptyView(head: LiveAnswerHead): LiveAnswerView {
  return {
    answerId: head.answerId,
    chatKind: head.chatKind,
    chatId: head.chatId,
    agentId: head.agentId,
    seq: 0,
    startedAt: head.at,
    lastAt: head.at,
    text: "",
    thought: null,
    tools: [],
    end: null,
  };
}

function withTool(
  tools: readonly LiveAnswerTool[],
  tool: LiveAnswerTool,
): LiveAnswerTool[] {
  const index = tools.findIndex((known) => known.callId === tool.callId);
  if (index === -1) return [...tools, tool];
  return tools.map((known, position) => (position === index ? tool : known));
}

/** Applies one part to its answer; the caller checked that it is new. */
function applyPart(
  view: LiveAnswerView,
  payload: Exclude<LiveAnswerEventPayload, { type: "answer_snapshot" }>,
): LiveAnswerView {
  const base = { ...view, seq: payload.data.seq, lastAt: payload.data.at };
  switch (payload.type) {
    case "answer_text":
      return {
        ...base,
        text: payload.data.isReset
          ? payload.data.delta
          : view.text + payload.data.delta,
      };
    case "answer_thought":
      return {
        ...base,
        thought: {
          text: (view.thought?.text ?? "") + payload.data.delta,
          startedAt: view.thought?.startedAt ?? payload.data.startedAt,
          endedAt: payload.data.at,
        },
      };
    case "answer_tool":
      return { ...base, tools: withTool(view.tools, payload.data.tool) };
    case "answer_end":
      return {
        ...base,
        end: { messageId: payload.data.messageId, state: payload.data.state },
      };
    case "answer_steer":
      return base;
  }
}

/**
 * Takes one live part of `conversations.v1` (PAGE-381).
 *
 * @param state - What the page knows so far.
 * @param payload - A snapshot or a part of an answer.
 * @returns The new state; a part the page already holds changes nothing, so
 * a snapshot after a reconnect and the events after it never show twice.
 */
export function applyLiveAnswerEvent(
  state: LiveAnswerState,
  payload: LiveAnswerEventPayload,
): LiveAnswerState {
  const known = state.answers[payload.data.answerId];
  if (payload.type === "answer_snapshot") {
    if (known && known.seq >= payload.data.seq) return state;
    const { at, ...snapshot } = payload.data;
    return {
      ...state,
      answers: {
        ...state.answers,
        [snapshot.answerId]: { ...snapshot, lastAt: at },
      },
    };
  }
  if (known && payload.data.seq <= known.seq) return state;
  const view = applyPart(known ?? emptyView(payload.data), payload);
  const deliveries =
    payload.type === "answer_steer"
      ? {
          ...state.deliveries,
          [payload.data.messageId]: {
            delivery: payload.data.delivery,
            agentId: payload.data.agentId,
          },
        }
      : state.deliveries;
  return {
    answers: { ...state.answers, [view.answerId]: view },
    deliveries,
  };
}

/**
 * The answers of one chat, oldest first.
 *
 * @param state - What the page knows.
 * @param chat - The opened chat.
 */
export function answersOfChat(
  state: LiveAnswerState,
  chat: LiveChat | null,
): LiveAnswerView[] {
  if (chat === null) return [];
  return Object.values(state.answers)
    .filter(
      (view) => view.chatKind === chat.chatKind && view.chatId === chat.chatId,
    )
    .sort((first, second) => first.startedAt.localeCompare(second.startedAt));
}

/**
 * The answer that ended with a stored message, by that message.
 *
 * @param views - The answers of the opened chat.
 * @returns The ended answers by the ID of their stored message.
 */
export function endedByMessage(
  views: readonly LiveAnswerView[],
): ReadonlyMap<string, LiveAnswerView> {
  const result = new Map<string, LiveAnswerView>();
  for (const view of views)
    if (view.end?.messageId) result.set(view.end.messageId, view);
  return result;
}

/**
 * The answers the history shows as written now: running ones, and ended ones
 * whose stored message is not in the history yet, so the answer never
 * vanishes before the stored message takes its place, nor shows twice.
 *
 * @param views - The answers of the opened chat.
 * @param storedIds - The IDs of the messages in the history.
 */
export function shownLiveAnswers(
  views: readonly LiveAnswerView[],
  storedIds: ReadonlySet<string>,
): LiveAnswerView[] {
  return views.filter((view) => {
    if (view.end === null) return true;
    const { messageId } = view.end;
    return messageId !== null && !storedIds.has(messageId);
  });
}

/** What the name of a tool and its input say it does. */
export function toolAction(tool: Pick<LiveAnswerTool, "name" | "input">): ToolAction {
  const words = `${tool.name} ${tool.input ?? ""}`;
  for (const { pattern, action } of TOOL_ACTIONS)
    if (pattern.test(words)) return action;
  return "use";
}

/** The file or the first words of the input a call works on. */
export function toolTarget(tool: Pick<LiveAnswerTool, "input">): string {
  const input = (tool.input ?? "").trim().split("\n")[0] ?? "";
  if (input === "") return "";
  const isPath = /^[\w./~-]+$/u.test(input) && input.includes("/");
  if (isPath) return input.split("/").at(-1) ?? input;
  return input.length > 40 ? `${input.slice(0, 40)}…` : input;
}

/**
 * Whether a call is `bilder_erzeugen` (PAGE-382), under whatever prefix the
 * agent's tool host names it.
 *
 * @param tool - A call of a live answer.
 */
export function isImageTool(tool: Pick<LiveAnswerTool, "name">): boolean {
  return /(?:^|[_.:/-])bilder_erzeugen$/u.test(tool.name);
}

/**
 * What a call of `video_erzeugen` or `audio_erzeugen` generates (PAGE-384),
 * under whatever prefix the agent's tool host names it.
 *
 * @param tool - A call of a live answer.
 * @returns `video`, `audio`, or `null` for another tool.
 */
export function mediaToolKind(
  tool: Pick<LiveAnswerTool, "name">,
): "video" | "audio" | null {
  const match = /(?:^|[_.:/-])(video|audio)_erzeugen$/u.exec(tool.name);
  const kind = match?.[1];
  return kind === "video" || kind === "audio" ? kind : null;
}

/**
 * How many images a call of `bilder_erzeugen` asks for (PAGE-382), read from
 * its bounded input; one when it names none.
 *
 * @param tool - A call of `bilder_erzeugen`.
 */
export function imageCount(tool: Pick<LiveAnswerTool, "input">): number {
  const match = /"anzahl"\s*:\s*(\d+)/u.exec(tool.input ?? "");
  const count = Number(match?.[1] ?? 1);
  return Math.min(Math.max(Number.isFinite(count) ? count : 1, 1), 4);
}

/**
 * What an agent is doing in an answer: a running tool call, thinking,
 * writing, or working without a known step.
 *
 * @param view - The answer, `null` when only its start is known.
 * @returns `null` once the answer ended.
 */
export function activityOf(view: LiveAnswerView | null): LiveActivity | null {
  if (view === null) return { kind: "working" };
  if (view.end !== null) return null;
  const running = view.tools.filter((tool) => tool.status === "running");
  const latest = running.at(-1);
  if (latest && isImageTool(latest))
    return { kind: "images", count: imageCount(latest) };
  const media = latest ? mediaToolKind(latest) : null;
  if (media) return { kind: media };
  if (latest)
    return {
      kind: "tool",
      action: toolAction(latest),
      target: toolTarget(latest),
      running: running.length,
    };
  if (view.text !== "") return { kind: "writing" };
  if (view.thought !== null && view.lastAt === view.thought.endedAt)
    return { kind: "thinking" };
  return { kind: "working" };
}

/**
 * The milliseconds between two ISO times, never below zero.
 *
 * @param from - The start.
 * @param to - The end.
 */
export function elapsedMilliseconds(from: string, to: string): number {
  return Math.max(0, Date.parse(to) - Date.parse(from));
}

/** The time all calls of an answer took, from the first start to the last end. */
export function toolsDuration(tools: readonly LiveAnswerTool[]): number | null {
  const ended = tools.filter((tool) => tool.endedAt !== undefined);
  if (ended.length === 0) return null;
  return ended.reduce(
    (sum, tool) =>
      sum + elapsedMilliseconds(tool.startedAt, tool.endedAt ?? tool.startedAt),
    0,
  );
}

/**
 * A duration as "12 s", "3,1 s" or "2 min 5 s" in the given language.
 *
 * @param milliseconds - The duration.
 * @param language - The language of the page.
 */
export function formatSeconds(milliseconds: number, language: string): string {
  const seconds = milliseconds / 1000;
  if (seconds < 10)
    return `${new Intl.NumberFormat(language, { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(seconds)} s`;
  if (seconds < 60) return `${String(Math.round(seconds))} s`;
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes)} min ${String(Math.round(seconds % 60))} s`;
}
