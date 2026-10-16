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
  /** New text of the current message; `isReset` begins another message. */
  readonly text: (isReset: boolean, delta: string) => void;
  readonly context: (context: ChatContextUsage, cost: ChatCost | null) => void;
  /** Tokens of the prompt that just ended, or `null` when the adapter named none. */
  readonly tokens: (tokens: Omit<ChatTokenUsage, "isPartial"> | null) => void;
  /** The Codex thread became active or stopped being active. */
  readonly threadStatus: (isActive: boolean) => void;
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
 * stored. Consumption is passed on only as the adapter reports it.
 */
export class PicaAcpUpdates implements AcpSessionListener {
  private readonly sink: PicaAcpUpdateSink;
  private readonly state = createAcpSessionState();
  private shown = "";

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

  /** Receives the usage the adapter returned with a prompt. */
  public readonly prompted = (usage: Usage | null): void => {
    this.sink.tokens(readTokens(usage));
  };

  /** The message of the agent shown last, the answer once its turn ended. */
  public answer(): string {
    return this.state.text;
  }

  private show(): void {
    const { text } = this.state;
    if (text === this.shown) return;
    const isReset = !text.startsWith(this.shown);
    const delta = isReset ? text : text.slice(this.shown.length);
    this.shown = text;
    this.sink.text(isReset, delta);
  }
}
