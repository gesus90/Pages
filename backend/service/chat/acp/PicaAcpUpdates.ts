import {
  createAcpSessionState,
  readAcpUpdate,
} from "@/backend/agents/acp/AcpEvents";

import type { SessionUpdate, Usage } from "@agentclientprotocol/sdk";
import type { AcpSessionListener } from "@/backend/agents/acp/AcpChat";
import type {
  ChatContextUsage,
  ChatCost,
  ChatTokenUsage,
} from "@/definition/ChatJob";

/** Where the updates of a Pica session go. */
export interface PicaAcpUpdateSink {
  /** New text of the current message of a turn; `isReset` begins another message. */
  readonly text: (turn: number, isReset: boolean, delta: string) => void;
  readonly context: (context: ChatContextUsage, cost: ChatCost | null) => void;
  /**
   * A prompt of Pages ended with these tokens, or `null` when the adapter named
   * none; whatever the adapter reports from now on belongs to the next turn.
   */
  readonly promptEnded: (
    turn: number,
    tokens: Omit<ChatTokenUsage, "isPartial"> | null,
  ) => void;
  /** The Codex thread became active or stopped being active. */
  readonly threadStatus: (isActive: boolean) => void;
  /** The connection to the adapter ended. */
  readonly closed: () => void;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function readCost(update: SessionUpdate): ChatCost | null {
  if (update.sessionUpdate !== "usage_update" || !update.cost) return null;
  const { amount, currency } = update.cost;
  return Number.isFinite(amount) && currency ? { amount, currency } : null;
}

/**
 * The type of the Codex thread status that codex-acp forwards in the metadata
 * of `session_info_update`, or `null` for any other update.
 */
function readThreadStatus(update: SessionUpdate): string | null {
  if (update.sessionUpdate !== "session_info_update") return null;
  const codex: unknown = update._meta?.codex;
  if (typeof codex !== "object" || codex === null) return null;
  const status: unknown = Reflect.get(codex, "threadStatus");
  if (typeof status !== "object" || status === null) return null;
  const type: unknown = Reflect.get(status, "type");
  return typeof type === "string" ? type : null;
}

function readTokens(
  usage: Usage | null,
): Omit<ChatTokenUsage, "isPartial"> | null {
  if (
    usage === null ||
    !isCount(usage.inputTokens) ||
    !isCount(usage.outputTokens) ||
    !isCount(usage.totalTokens)
  )
    return null;
  return {
    input: usage.inputTokens,
    output: usage.outputTokens,
    total: usage.totalTokens,
  };
}

/**
 * Reads the updates of a Pica session into answer text, consumption and thread status.
 *
 * @remarks
 * The current message follows the same boundaries as a plan session: a tool
 * call, plan or thought ends it, so the text shown last is the answer that is
 * stored. The end of a prompt of Pages starts the next turn at once, in the
 * order of the adapter's messages, so a turn the adapter starts for a steer
 * never continues the text of the turn before. Consumption is passed on only
 * as the adapter reports it.
 */
export class PicaAcpUpdates implements AcpSessionListener {
  private readonly sink: PicaAcpUpdateSink;
  private readonly state = createAcpSessionState();
  private shown = "";
  private turn = 1;

  public constructor(sink: PicaAcpUpdateSink) {
    this.sink = sink;
  }

  /** Receives one update of the adapter. */
  public readonly update = (update: SessionUpdate): void => {
    if (update.sessionUpdate === "usage_update") {
      if (isCount(update.used) && isCount(update.size))
        this.sink.context(
          { used: update.used, size: update.size },
          readCost(update),
        );
      return;
    }
    const status = readThreadStatus(update);
    if (status !== null) {
      this.sink.threadStatus(status === "active");
      return;
    }
    readAcpUpdate(this.state, update, {});
    this.show();
  };

  /** Receives the usage the adapter returned with a prompt; the next turn begins. */
  public readonly prompted = (usage: Usage | null): void => {
    const turn = this.turn;
    this.beginNextTurn();
    this.sink.promptEnded(turn, readTokens(usage));
  };

  /** Receives the end of the connection to the adapter. */
  public readonly closed = (): void => {
    this.sink.closed();
  };

  /** The message of the agent shown last, the answer once its turn ended. */
  public answer(): string {
    return this.state.text;
  }

  /** A turn the adapter started for a steer ended without a prompt response; the next turn begins. */
  public endAdapterTurn(): void {
    this.beginNextTurn();
  }

  private beginNextTurn(): void {
    this.turn += 1;
    this.state.text = "";
    this.state.messageId = null;
    this.state.isMessageOpen = false;
    this.shown = "";
  }

  private show(): void {
    const { text } = this.state;
    if (text === this.shown) return;
    const isReset = !text.startsWith(this.shown);
    const delta = isReset ? text : text.slice(this.shown.length);
    this.shown = text;
    this.sink.text(this.turn, isReset, delta);
  }
}
