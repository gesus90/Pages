import { logCaughtError } from "@/backend/logging/Logger";
import { redactCredentials } from "@/backend/security/AgentTextSafety";
import { openRouterCatalogId } from "@/definition/AgentModelIdentity";

import type { AgentAnswerModel } from "@/definition/AgentChatControl";
import type { ChatJobEvent, ChatSteerStatus } from "@/definition/ChatJob";
import type {
  LiveAnswerChatKind,
  LiveAnswerDelivery,
  LiveAnswerEnd,
  LiveAnswerEndState,
  LiveAnswerEventPayload,
  LiveAnswerHead,
  LiveAnswerSnapshot,
  LiveAnswerTool,
  StoredAgentAnswer,
} from "@/definition/ConversationLiveAnswer";

/** Thoughts reach the readers at most this often, after complete words. */
const THOUGHT_FLUSH_MS = 300;

/** Who reads an answer and how it ends. */
export interface LiveAnswerTarget {
  readonly agentId: string;
  readonly chatKind: LiveAnswerChatKind;
  readonly chatId: string;
  /** Every member who sees the answer. */
  readonly recipientIds: readonly string[];
  /** The members who see its thoughts: the person of a direct chat, the owner of a group. */
  readonly thoughtRecipientIds: readonly string[];
  /**
   * Each turn is stored as a message of its own, as in a direct chat with an
   * agent; otherwise the caller ends the answer with the stored message.
   */
  readonly isTurnStored: boolean;
  /**
   * Keeps the model of the run with a stored answer, so its head reads the
   * same after a reload; absent keeps nothing.
   */
  readonly recordModel?: (
    messageId: string,
    model: AgentAnswerModel,
  ) => Promise<void>;
}

/** What a running job reports of the answer it writes; no method throws. */
export interface LiveAnswerSink {
  /** Publishes the start of an admitted answer before its first output. */
  start(turn?: number): void;
  /** Captures the final measurement for the group reply or the given direct-chat turn. */
  complete(turn?: number): StoredAgentAnswer | undefined;
  /** An entry the job journaled: text, a tool call, a steer, a stored answer or the end. */
  journaled(event: ChatJobEvent): void;
  /** A piece of the thoughts of a turn, as the adapter reported it. */
  thought(turn: number, delta: string): void;
  /** The person cancelled the running tool calls. */
  cancelTools(): void;
  /** The model the run answers with, from the catalog of the connection it uses. */
  useModel(model: AgentAnswerModel): void;
  /** The adapter's confirmed model selector and effort after a completed turn. */
  confirmModel?(reported: Readonly<Record<string, string>>): void;
  /** Ends the open answers of the job. */
  finish(end: LiveAnswerEnd): void;
}

/** What the answer reports to the stream it belongs to. */
export interface LiveAnswerHost {
  publish(
    payload: LiveAnswerEventPayload,
    recipientIds: readonly string[],
  ): void;
  now(): Date;
  createId(): string;
}

/** The answer being written now. */
interface AnswerState {
  readonly answerId: string;
  readonly startedAt: string;
  seq: number;
  lastAt: string;
  model: AgentAnswerModel | null;
  turn: number;
  text: string;
  thought: { text: string; startedAt: string; endedAt: string } | null;
  readonly tools: Map<string, LiveAnswerTool>;
  end: LiveAnswerEnd | null;
  completedAt: string | null;
  pendingThought: string;
  thoughtTimer: ReturnType<typeof setTimeout> | undefined;
}

const END_STATES: Readonly<Record<string, LiveAnswerEndState>> = {
  completed: "answered",
  stopped: "stopped",
  failed: "failed",
  interrupted: "failed",
};

/** What a steer status tells the person about their message. */
function deliveryOf(status: ChatSteerStatus): LiveAnswerDelivery {
  if (status === "followUp") return "waiting";
  if (status === "failed") return "failed";
  return "injected";
}

function toolDetails(
  event: Extract<ChatJobEvent, { kind: "tool" }>,
  known: LiveAnswerTool | undefined,
): Pick<LiveAnswerTool, "input" | "output" | "summary" | "isNative"> {
  const input = event.input ?? known?.input;
  const output = event.output ?? known?.output;
  const summary = event.summary ?? known?.summary;
  return {
    ...(input === undefined ? {} : { input }),
    ...(output === undefined ? {} : { output }),
    ...(summary === undefined ? {} : { summary }),
    ...(event.isNative === true || known?.isNative === true
      ? { isNative: true }
      : {}),
  };
}

/**
 * The live answer of one job of an agent: it turns what the job
 * journals, and the thoughts the adapter reports, into parts of
 * `conversations.v1` for the members of the chat.
 * @remarks
 * Text arrives as the journal writes it, after complete words and with
 * credentials masked; thoughts are collected the same way here. A thought
 * goes only to {@link LiveAnswerTarget.thoughtRecipientIds}. A direct chat
 * ends an answer with every stored turn; a group ends it once the caller
 * stored the reply. The last state stays readable for a client that
 * connects later, until the stream forgets it.
 */
export class ConversationLiveAnswer implements LiveAnswerSink {
  private readonly target: LiveAnswerTarget;
  private readonly host: LiveAnswerHost;
  private readonly states = new Map<number, AnswerState>();
  private lastActiveAt: number;
  private currentTurn = 1;
  private model: AgentAnswerModel | null = null;

  /**
   * Creates the live answer of one job.
   * @param target - Who reads it and how it ends.
   * @param host - The stream it publishes to.
   */
  public constructor(target: LiveAnswerTarget, host: LiveAnswerHost) {
    this.target = target;
    this.host = host;
    this.lastActiveAt = host.now().getTime();
  }

  /** The agent and chat of the answer. */
  public get head(): Pick<LiveAnswerTarget, "agentId" | "chatKind" | "chatId"> {
    return {
      agentId: this.target.agentId,
      chatKind: this.target.chatKind,
      chatId: this.target.chatId,
    };
  }

  /** Publishes the start of an admitted answer before its first output. */
  public start(turn = 1): void {
    this.open(turn);
  }

  /** Captures the measurement and settles open calls at the time of completion. */
  public complete(turn?: number): StoredAgentAnswer | undefined {
    if ((turn !== undefined) !== this.target.isTurnStored) return undefined;
    const state = this.states.get(turn ?? 1);
    if (!state) return undefined;
    const endedAt = this.completeState(state);
    return {
      answerId: state.answerId,
      durationMs: Math.max(
        0,
        Date.parse(endedAt) - Date.parse(state.startedAt),
      ),
      tools: [...state.tools.values()],
    };
  }

  /** Receives an entry of the job's journal. */
  public journaled(event: ChatJobEvent): void {
    switch (event.kind) {
      case "text":
        this.text(event.turn, event.isReset, event.delta);
        return;
      case "tool":
        this.tool(event);
        return;
      case "steer":
        this.steer(event.messageId, event.status);
        return;
      case "answer":
        this.journaledAnswer(event);
        return;
      case "end":
        this.journaledEnd(event);
        return;
      case "session":
      case "phase":
      case "turn":
      case "usage":
      case "compaction":
      case "capabilities":
        return;
    }
  }

  /** Collects thoughts after complete words, so a credential reaches the filter whole. */
  public thought(turn: number, delta: string): void {
    if (delta === "") return;
    const state = this.open(turn);
    if (state.end) return;
    const at = this.host.now().toISOString();
    state.thought ??= { text: "", startedAt: at, endedAt: at };
    state.pendingThought += delta;
    state.thoughtTimer ??= setTimeout(
      () => this.flushThought(state, false),
      THOUGHT_FLUSH_MS,
    );
    state.thoughtTimer.unref();
  }

  /** Marks every running tool call cancelled. */
  public cancelTools(): void {
    const endedAt = this.host.now().toISOString();
    for (const state of this.states.values())
      this.cancelStateTools(state, endedAt);
  }

  /** Takes the model of the run, which every stored answer of it keeps. */
  public useModel(model: AgentAnswerModel): void {
    this.model = model;
    for (const state of this.states.values()) {
      if (state.end !== null) continue;
      state.model = model;
      this.publishModelSnapshot(state);
    }
  }

  /** Keeps a confirmation only for the OpenRouter model the assignment resolved. */
  public confirmModel(reported: Readonly<Record<string, string>>): void {
    const model = this.model;
    if (model?.provider !== "openrouter" || reported.model === undefined)
      return;
    if (openRouterCatalogId(reported.model) !== model.modelId) return;
    this.useModel({
      ...model,
      modelStatus: "confirmed",
      reasoningStatus:
        model.reasoningEffort !== null &&
        reported.reasoningEffort === model.reasoningEffort
          ? "confirmed"
          : "requested",
    });
  }

  /** Ends the open answers of the job. */
  public finish(end: LiveAnswerEnd): void {
    for (const state of this.states.values()) this.finishState(state, end);
  }

  /**
   * What a reader of the chat knows of each answer; thoughts only for the
   * readers allowed to see them.
   */
  public snapshotsFor(userId: string): LiveAnswerSnapshot[] {
    if (!this.target.recipientIds.includes(userId)) return [];
    const isThoughtReader = this.target.thoughtRecipientIds.includes(userId);
    return [...this.states.values()].map((state) =>
      this.snapshot(state, isThoughtReader),
    );
  }

  /** Drops expired answers and reports whether the stream can forget this job. */
  public forgetEndedBefore(milliseconds: number): boolean {
    for (const [turn, state] of this.states) {
      const endedAt = state.end?.endedAt;
      if (endedAt && Date.parse(endedAt) < milliseconds)
        this.states.delete(turn);
    }
    return this.states.size === 0 && this.lastActiveAt < milliseconds;
  }

  private snapshot(
    state: AnswerState,
    isThoughtReader: boolean,
  ): LiveAnswerSnapshot {
    return {
      ...this.partHead(state),
      ...(state.model === null ? {} : { model: state.model }),
      startedAt: state.startedAt,
      text: state.text,
      thought: isThoughtReader ? state.thought : null,
      tools: [...state.tools.values()],
      end: state.end,
    };
  }

  private publishModelSnapshot(state: AnswerState): void {
    const { recipientIds, thoughtRecipientIds } = this.target;
    this.next(state);
    for (const isThoughtReader of [false, true]) {
      const recipients = recipientIds.filter(
        (id) => thoughtRecipientIds.includes(id) === isThoughtReader,
      );
      if (recipients.length > 0)
        this.publish(
          {
            type: "answer_snapshot",
            data: this.snapshot(state, isThoughtReader),
          },
          recipients,
        );
    }
  }

  private completeState(state: AnswerState): string {
    if (state.completedAt !== null) return state.completedAt;
    const endedAt = this.host.now().toISOString();
    state.completedAt = endedAt;
    this.cancelStateTools(state, endedAt);
    return endedAt;
  }

  private cancelStateTools(state: AnswerState, endedAt: string): void {
    for (const tool of state.tools.values())
      if (tool.status === "running")
        this.publishTool(state, { ...tool, status: "cancelled", endedAt });
  }

  private finishState(state: AnswerState, end: LiveAnswerEnd): void {
    if (state.end) return;
    const endedAt = this.completeState(state);
    this.flushThought(state, true);
    const result = { ...end, endedAt };
    state.end = result;
    this.lastActiveAt = this.host.now().getTime();
    this.keepModel(end.messageId, state.model);
    this.publish(
      { type: "answer_end", data: { ...this.next(state), ...result } },
      this.target.recipientIds,
    );
  }

  /** Stores the model of the run with the answer; a failed write only loses the badge. */
  private keepModel(
    messageId: string | null,
    model: AgentAnswerModel | null,
  ): void {
    const { recordModel } = this.target;
    if (messageId === null || model === null || !recordModel) return;
    void Promise.resolve()
      .then(() => recordModel(messageId, model))
      .catch((error: unknown) => {
        logCaughtError("ConversationLiveAnswer", error, "warn");
      });
  }

  private text(turn: number, isReset: boolean, delta: string): void {
    const state = this.open(turn);
    if (state.end) return;
    this.flushThought(state, true);
    // A new turn of a group answer replaces the text, as the stored answer does.
    const isNewTurn = state.turn !== turn && state.text !== "";
    state.turn = turn;
    const shouldReset = isReset || isNewTurn;
    if (delta === "" && !shouldReset) return;
    state.text = shouldReset ? delta : state.text + delta;
    this.publish(
      {
        type: "answer_text",
        data: { ...this.next(state), delta, isReset: shouldReset },
      },
      this.target.recipientIds,
    );
  }

  private tool(event: Extract<ChatJobEvent, { kind: "tool" }>): void {
    const state = this.open(event.turn ?? this.currentTurn);
    if (state.completedAt !== null) return;
    this.flushThought(state, true);
    const at = this.host.now().toISOString();
    const known = state.tools.get(event.callId);
    const status = known?.endedAt === undefined ? event.status : known.status;
    this.publishTool(state, {
      callId: event.callId,
      name: event.tool,
      status,
      error: event.error,
      ...toolDetails(event, known),
      startedAt: known?.startedAt ?? event.startedAt ?? at,
      ...(status === "running"
        ? {}
        : { endedAt: known?.endedAt ?? event.endedAt ?? at }),
    });
  }

  private steer(messageId: string, status: ChatSteerStatus): void {
    const state = this.states.get(this.turnKey(this.currentTurn));
    if (!state) return;
    this.publish(
      {
        type: "answer_steer",
        data: { ...this.next(state), messageId, delivery: deliveryOf(status) },
      },
      this.target.recipientIds,
    );
  }

  private journaledAnswer(
    event: Extract<ChatJobEvent, { kind: "answer" }>,
  ): void {
    if (!this.target.isTurnStored) return;
    const state = this.states.get(event.turn);
    if (state)
      this.finishState(state, {
        messageId: event.messageId,
        state: event.isStopped ? "stopped" : "answered",
      });
  }

  private journaledEnd(event: Extract<ChatJobEvent, { kind: "end" }>): void {
    if (!this.target.isTurnStored) return;
    this.finish({
      messageId: null,
      state: END_STATES[event.state] ?? "failed",
    });
  }

  private publishTool(state: AnswerState, tool: LiveAnswerTool): void {
    state.tools.set(tool.callId, tool);
    this.publish(
      { type: "answer_tool", data: { ...this.next(state), tool } },
      this.target.recipientIds,
    );
  }

  /** Writes the thoughts collected so far; `isFinal` writes an unfinished word too. */
  private flushThought(state: AnswerState, isFinal: boolean): void {
    clearTimeout(state.thoughtTimer);
    state.thoughtTimer = undefined;
    const pending = state.pendingThought;
    if (!state.thought || pending === "") return;
    const length = isFinal
      ? pending.length
      : (/\S*$/u.exec(pending)?.index ?? 0);
    if (length === 0) return;
    state.pendingThought = pending.slice(length);
    const delta = redactCredentials(pending.slice(0, length));
    const at = this.host.now().toISOString();
    state.thought = {
      text: state.thought.text + delta,
      startedAt: state.thought.startedAt,
      endedAt: at,
    };
    this.publish(
      {
        type: "answer_thought",
        data: {
          ...this.next(state, at),
          delta,
          startedAt: state.thought.startedAt,
        },
      },
      this.target.thoughtRecipientIds.filter((id) =>
        this.target.recipientIds.includes(id),
      ),
    );
  }

  private turnKey(turn: number): number {
    return this.target.isTurnStored ? turn : 1;
  }

  private open(turn: number): AnswerState {
    const key = this.turnKey(turn);
    const known = this.states.get(key);
    if (known) return known;
    this.currentTurn = turn;
    const startedAt = this.host.now().toISOString();
    const state: AnswerState = {
      answerId: this.host.createId(),
      startedAt,
      seq: 1,
      lastAt: startedAt,
      model: this.model,
      turn,
      text: "",
      thought: null,
      tools: new Map(),
      end: null,
      completedAt: null,
      pendingThought: "",
      thoughtTimer: undefined,
    };
    this.states.set(key, state);
    this.publish(
      { type: "answer_snapshot", data: this.snapshot(state, false) },
      this.target.recipientIds,
    );
    return state;
  }

  private next(
    state: AnswerState,
    at = this.host.now().toISOString(),
  ): LiveAnswerHead {
    state.seq += 1;
    state.lastAt = at;
    return this.partHead(state);
  }

  private partHead(state: AnswerState): LiveAnswerHead {
    return {
      ...this.head,
      answerId: state.answerId,
      seq: state.seq,
      at: state.lastAt,
      answerStartedAt: state.startedAt,
    };
  }

  private publish(
    payload: LiveAnswerEventPayload,
    recipientIds: readonly string[],
  ): void {
    if (recipientIds.length === 0) return;
    this.host.publish(payload, recipientIds);
  }
}
