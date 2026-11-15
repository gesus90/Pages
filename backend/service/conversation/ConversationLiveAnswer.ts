import { redactCredentials } from "@/backend/security/AgentTextSafety";

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
}

/** What a running job reports of the answer it writes (PAGE-381); no method throws. */
export interface LiveAnswerSink {
  /** An entry the job journaled: text, a tool call, a steer, a stored answer or the end. */
  journaled(event: ChatJobEvent): void;
  /** A piece of the thoughts of a turn, as the adapter reported it. */
  thought(turn: number, delta: string): void;
  /** The person cancelled the running tool calls. */
  cancelTools(): void;
  /** Ends the answer; later parts begin a new one. */
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
  turn: number;
  text: string;
  thought: { text: string; startedAt: string; endedAt: string } | null;
  readonly tools: Map<string, LiveAnswerTool>;
  end: LiveAnswerEnd | null;
  endedAtMs: number | null;
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

/**
 * The live answer of one job of an agent (PAGE-381): it turns what the job
 * journals, and the thoughts the adapter reports, into parts of
 * `conversations.v1` for the members of the chat.
 *
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
  private readonly createdAtMs: number;
  private state: AnswerState | null = null;
  private pendingThought = "";
  private thoughtTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * Creates the live answer of one job.
   *
   * @param target - Who reads it and how it ends.
   * @param host - The stream it publishes to.
   */
  public constructor(target: LiveAnswerTarget, host: LiveAnswerHost) {
    this.target = target;
    this.host = host;
    this.createdAtMs = host.now().getTime();
  }

  /** The agent and chat of the answer. */
  public get head(): Pick<LiveAnswerTarget, "agentId" | "chatKind" | "chatId"> {
    return {
      agentId: this.target.agentId,
      chatKind: this.target.chatKind,
      chatId: this.target.chatId,
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
        if (this.target.isTurnStored)
          this.finish({ messageId: event.messageId, state: "answered" });
        return;
      case "end":
        if (this.target.isTurnStored)
          this.finish({
            messageId: null,
            state: END_STATES[event.state] ?? "failed",
          });
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
    const at = this.host.now().toISOString();
    state.thought ??= { text: "", startedAt: at, endedAt: at };
    this.pendingThought += delta;
    this.thoughtTimer ??= setTimeout(
      () => this.flushThought(false),
      THOUGHT_FLUSH_MS,
    );
    this.thoughtTimer.unref();
  }

  /** Marks every running tool call cancelled. */
  public cancelTools(): void {
    const state = this.state;
    if (!state || state.end) return;
    for (const tool of state.tools.values())
      if (tool.status === "running")
        this.publishTool(state, { ...tool, status: "cancelled" });
  }

  /** Ends the answer with its stored message; a running tool call counts as cancelled. */
  public finish(end: LiveAnswerEnd): void {
    const state = this.state;
    if (!state || state.end) return;
    this.flushThought(true);
    this.cancelTools();
    state.end = end;
    state.endedAtMs = this.host.now().getTime();
    this.publish(
      { type: "answer_end", data: { ...this.next(state), ...end } },
      this.target.recipientIds,
    );
  }

  /**
   * What a reader of the chat knows of the answer; thoughts only for the
   * readers allowed to see them.
   *
   * @returns The answer, or `null` before it began or for another account.
   */
  public snapshotFor(userId: string): LiveAnswerSnapshot | null {
    const state = this.state;
    if (!state || !this.target.recipientIds.includes(userId)) return null;
    const isThoughtReader = this.target.thoughtRecipientIds.includes(userId);
    return {
      ...this.head,
      answerId: state.answerId,
      seq: state.seq,
      at: this.host.now().toISOString(),
      startedAt: state.startedAt,
      text: state.text,
      thought: isThoughtReader ? state.thought : null,
      tools: [...state.tools.values()],
      end: state.end,
    };
  }

  /**
   * Whether the answer ended before the given time, or never began since,
   * so nobody needs it any more.
   */
  public hasEndedBefore(milliseconds: number): boolean {
    if (this.state === null) return this.createdAtMs < milliseconds;
    const endedAt = this.state.endedAtMs;
    return endedAt !== null && endedAt < milliseconds;
  }

  private text(turn: number, isReset: boolean, delta: string): void {
    const state = this.open(turn);
    this.flushThought(true);
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
    const state = this.open(null);
    this.flushThought(true);
    const at = this.host.now().toISOString();
    const known = state.tools.get(event.callId);
    const isRunning = event.status === "running";
    // A later report of a call adds to what its start named.
    const input = event.input ?? known?.input;
    const output = event.output ?? known?.output;
    this.publishTool(state, {
      callId: event.callId,
      name: event.tool,
      status: event.status,
      ...(input === undefined ? {} : { input }),
      ...(output === undefined ? {} : { output }),
      error: event.error,
      ...(event.isNative === true || known?.isNative === true
        ? { isNative: true }
        : {}),
      startedAt: known?.startedAt ?? at,
      ...(isRunning ? {} : { endedAt: at }),
    });
  }

  private steer(messageId: string, status: ChatSteerStatus): void {
    const state = this.open(null);
    this.publish(
      {
        type: "answer_steer",
        data: { ...this.next(state), messageId, delivery: deliveryOf(status) },
      },
      this.target.recipientIds,
    );
  }

  private publishTool(state: AnswerState, tool: LiveAnswerTool): void {
    state.tools.set(tool.callId, tool);
    this.publish(
      { type: "answer_tool", data: { ...this.next(state), tool } },
      this.target.recipientIds,
    );
  }

  /** Writes the thoughts collected so far; `isFinal` writes an unfinished word too. */
  private flushThought(isFinal: boolean): void {
    clearTimeout(this.thoughtTimer);
    this.thoughtTimer = undefined;
    const state = this.state;
    const pending = this.pendingThought;
    if (!state?.thought || pending === "") return;
    const length = isFinal
      ? pending.length
      : (/\S*$/u.exec(pending)?.index ?? 0);
    if (length === 0) return;
    this.pendingThought = pending.slice(length);
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
          ...this.next(state),
          delta,
          startedAt: state.thought.startedAt,
        },
      },
      this.target.thoughtRecipientIds.filter((id) =>
        this.target.recipientIds.includes(id),
      ),
    );
  }

  /** The answer being written; a part after the end begins the next one. */
  private open(turn: number | null): AnswerState {
    if (this.state && this.state.end === null) return this.state;
    this.pendingThought = "";
    this.state = {
      answerId: this.host.createId(),
      startedAt: this.host.now().toISOString(),
      seq: 0,
      turn: turn ?? this.state?.turn ?? 1,
      text: "",
      thought: null,
      tools: new Map(),
      end: null,
      endedAtMs: null,
    };
    return this.state;
  }

  private next(state: AnswerState): LiveAnswerHead {
    state.seq += 1;
    return {
      ...this.head,
      answerId: state.answerId,
      seq: state.seq,
      at: this.host.now().toISOString(),
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
