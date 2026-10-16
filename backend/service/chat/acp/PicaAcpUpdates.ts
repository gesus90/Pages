import {
  createAcpSessionState,
  readAcpUpdate,
} from "@/backend/agents/acp/AcpEvents";

import type { SessionUpdate, Usage } from "@agentclientprotocol/sdk";
import type { AcpSessionListener } from "@/backend/agents/acp/AcpChat";
import type {
  ChatContextUsage,
  ChatCost,
  ChatJobCompactionEvent,
  ChatTokenUsage,
} from "@/definition/ChatJob";

/** The name Claude Code gives the tool call that reports a compaction (claude-agent-acp 0.90). */
const CLAUDE_COMPACTION_TOOL = "compact";

/** Where the updates of a Pica session go. */
export interface PicaAcpUpdateSink {
  /** New text of the current message of a turn; `isReset` begins another message. */
  readonly text: (turn: number, isReset: boolean, delta: string) => void;
  /** The latest occupancy, `null` while the adapter reports none that holds, and the cost. */
  readonly context: (
    context: ChatContextUsage | null,
    cost: ChatCost | null,
  ) => void;
  /** The agent compacted the context of its session, or is doing so. */
  readonly compaction: (
    compaction: Omit<ChatJobCompactionEvent, "kind">,
  ) => void;
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

/** How the cost an adapter reports is meant. */
export interface PicaAcpUpdateOptions {
  /** The adapter computes the cost itself, so every amount is an estimate. */
  readonly isCostEstimated: boolean;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function readCost(
  update: Extract<SessionUpdate, { sessionUpdate: "usage_update" }>,
  options: PicaAcpUpdateOptions,
): ChatCost | null {
  if (!update.cost) return null;
  const { amount, currency } = update.cost;
  return Number.isFinite(amount) && currency
    ? { amount, currency, isEstimated: options.isCostEstimated }
    : null;
}

/**
 * The occupancy of a usage report, or `null` when it holds none.
 *
 * @remarks
 * No turn ends with an empty context. claude-agent-acp reports `used: 0` after
 * a compaction whose remaining size the CLI did not name, until the next
 * answer corrects it, so a zero is shown as unknown, never as zero.
 */
function readContext(
  update: Extract<SessionUpdate, { sessionUpdate: "usage_update" }>,
): ChatContextUsage | null {
  const { used, size } = update;
  return isCount(used) && isCount(size) && used > 0 && size > 0
    ? { used, size }
    : null;
}

function readRecord(input: unknown): Readonly<Record<string, unknown>> | null {
  return typeof input === "object" && input !== null && !Array.isArray(input)
    ? Object.fromEntries(Object.entries(input))
    : null;
}

function nullableCount(value: unknown): number | null {
  return isCount(value) ? value : null;
}

function compactionStatus(
  update: Extract<
    SessionUpdate,
    { sessionUpdate: "tool_call" | "tool_call_update" }
  >,
): ChatJobCompactionEvent["status"] | null {
  if (update.status === "completed" || update.status === "failed")
    return update.status;
  if (update.status === "pending" || update.status === "in_progress")
    return "running";
  // A later report without a status only adds facts to a compaction that already ended.
  return update.sessionUpdate === "tool_call" ? "running" : null;
}

/**
 * The compaction a tool call of Claude Code reports, or `null` for any other update.
 *
 * @remarks
 * Without the ACP compaction capability, which Pages does not negotiate,
 * claude-agent-acp reports a compaction as a tool call named `compact` in
 * `_meta.claudeCode.toolName`; its final report carries the token counts in
 * `rawOutput`. It is not a tool of Pages and not the end of a turn.
 */
function readCompaction(
  update: SessionUpdate,
): Omit<ChatJobCompactionEvent, "kind"> | null {
  if (
    update.sessionUpdate !== "tool_call" &&
    update.sessionUpdate !== "tool_call_update"
  )
    return null;
  const claude = readRecord(readRecord(update._meta)?.claudeCode);
  if (claude?.toolName !== CLAUDE_COMPACTION_TOOL) return null;
  const status = compactionStatus(update);
  if (status === null) return null;
  const facts = readRecord(update.rawOutput);
  return {
    status,
    tokensBefore: nullableCount(facts?.preTokens),
    tokensAfter: nullableCount(facts?.postTokens),
  };
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
 * Reads the updates of a Pica session into answer text, consumption,
 * compaction and thread status.
 *
 * @remarks
 * The current message follows the same boundaries as a plan session: a tool
 * call, plan or thought ends it, so the text shown last is the answer that is
 * stored. The end of a prompt of Pages starts the next turn at once, in the
 * order of the adapter's messages, so a turn the adapter starts for a steer
 * never continues the text of the turn before. Consumption is passed on only
 * as the adapter reports it, an estimated cost marked as such.
 */
export class PicaAcpUpdates implements AcpSessionListener {
  private readonly sink: PicaAcpUpdateSink;
  private readonly options: PicaAcpUpdateOptions;
  private readonly state = createAcpSessionState();
  private shown = "";
  private turn = 1;

  public constructor(sink: PicaAcpUpdateSink, options: PicaAcpUpdateOptions) {
    this.sink = sink;
    this.options = options;
  }

  /** Receives one update of the adapter. */
  public readonly update = (update: SessionUpdate): void => {
    if (update.sessionUpdate === "usage_update") {
      this.sink.context(readContext(update), readCost(update, this.options));
      return;
    }
    const status = readThreadStatus(update);
    if (status !== null) {
      this.sink.threadStatus(status === "active");
      return;
    }
    const compaction = readCompaction(update);
    if (compaction !== null) this.sink.compaction(compaction);
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
