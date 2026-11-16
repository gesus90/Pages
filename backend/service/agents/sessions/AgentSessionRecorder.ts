import { AgentError } from "@/backend/error/AgentErrors";
import { openRouterPriceCatalog } from "./OpenRouterPriceCatalog";
import { logCaughtError, logDiagnostic } from "@/backend/logging/Logger";

import { codexThreadReportSchema } from "@/definition/CodexPlanUsage";

import { codexPromptTokens } from "../usage/CodexPromptTokens";
import { buildPromptUsage } from "./AgentSessionPromptUsage";
import {
  PROGRESS_TOOL,
  describeInput,
  describeOutput,
  toolText,
  activityEvent,
  progressText,
} from "./AgentSessionRecorderEvents";
import type { ToolCallState } from "./AgentSessionRecorderEvents";
import { readContinuationCapabilities } from "./AgentSessionContinuation";
import {
  ACP_USAGE_CAPABILITIES,
  readContextUsage,
  readTurnTokens,
} from "./AgentSessionUsage";
import { readOpenCodeNativeUsage } from "./OpenCodeNativeUsage";
import { chargeOpenRouterMessage } from "./OpenRouterPricing";

import type { ClaudeUsageObservation } from "@/definition/ClaudeUsage";
import type { AgentSessionTurnUsage } from "@/definition/AgentSessionJournal";
import type {
  AgentCapabilities,
  SessionUpdate,
  Usage,
} from "@agentclientprotocol/sdk";
import type { AcpSessionListener } from "@/backend/agents/acp/AcpChat";
import type { AcpContinuationCapabilities } from "./AgentSessionContinuation";
import type {
  AgentSessionEventInput,
  AgentSessionJournal,
} from "./AgentSessionJournal";
import type {
  AgentSessionAttemptRecord,
  AgentSessionStore,
} from "./AgentSessionStore";
import type { AgentSessionCost } from "@/definition/AgentSessionJournal";
import type { TurnTokenDelta } from "./AgentSessionUsage";
import type { OpenCodeMessageUsage } from "@/backend/agents/cli/OpenCodeSessionUsage";
import type { OpenRouterPricing } from "./OpenRouterPricing";
import type { OpenCodeNativeMessage } from "./OpenCodeNativeUsage";

/** The key under which claude-agent-acp names the model of a usage update. */
const CLAUDE_MODEL_KEY = "_claude/model";

/** What a recorder writes to. */
export interface AgentSessionRecorderDependencies {
  readonly journal: AgentSessionJournal;
  readonly store: AgentSessionStore;
  readonly clock?: () => string;
  readonly saveUsage?: (usage: AgentSessionTurnUsage) => Promise<void>;
  readonly pricing?: OpenRouterPricing;
}

/** Updates of agent activity that end the current message. */
const MESSAGE_BOUNDARIES: ReadonlySet<SessionUpdate["sessionUpdate"]> = new Set(
  ["agent_thought_chunk", "tool_call", "tool_call_update", "plan"],
);

/** Updates that end the current thought. */
const THOUGHT_BOUNDARIES: ReadonlySet<SessionUpdate["sessionUpdate"]> = new Set(
  ["agent_message_chunk", "tool_call", "tool_call_update", "plan"],
);

/**
 * A message that is still being written is stored in pieces at most this
 * far apart, so the Pages terminal shows the answer while it is written.
 */
const LIVE_MESSAGE_MS = 1_000;

function readCost(
  update: Extract<SessionUpdate, { sessionUpdate: "usage_update" }>,
): AgentSessionCost | null {
  const cost = update.cost;
  return cost && Number.isFinite(cost.amount) && cost.currency
    ? { amount: cost.amount, currency: cost.currency.slice(0, 10) }
    : null;
}

function reportedModel(
  update: Extract<SessionUpdate, { sessionUpdate: "usage_update" }>,
): string | null {
  const model = update._meta?.[CLAUDE_MODEL_KEY];
  return typeof model === "string" && model.length > 0 ? model : null;
}

function nativeMessages(
  dataHome: string,
  sessionId: string,
): readonly OpenCodeNativeMessage[] {
  try {
    return readOpenCodeNativeUsage(dataHome, sessionId);
  } catch (error: unknown) {
    logCaughtError("AgentSessionRecorder", error);
    return [];
  }
}

/**
 * Records what the adapter process of a plan session reports into the attempt whose turn runs.
 *
 * @remarks
 * Members of an ACP group take turns in one process, so the recorder of the
 * process is pointed at each member's attempt before its turn; their turns,
 * events and usage never mix. Message chunks become one event when the
 * message ends. Usage counts only as the adapter reports it: a turn's
 * tokens are written once per turn, the context occupancy replaces the one
 * before. Writes run one after another; the session awaits `drained()` and
 * fails its turn if persistence failed instead of acknowledging missing history.
 */
export class AgentSessionRecorder implements AcpSessionListener {
  private readonly dependencies: AgentSessionRecorderDependencies;
  private readonly clock: () => string;
  private readonly turns = new Map<string, number>();
  private readonly tools = new Map<string, ToolCallState>();
  private readonly openCodeSnapshots = new Map<string, string>();
  private attempt: AgentSessionAttemptRecord;
  private message = "";
  private messageBytes = 0;
  private messageFlushedAt = 0;
  private thought = "";
  private pendingWrites = 0;
  private hasWriteFailure = false;
  private hasNativeCodexUsage = false;
  private lastUsage: Usage | null = null;
  private hasClaudeObservation = false;
  private continuation: AcpContinuationCapabilities | null = null;
  private writes: Promise<void> = Promise.resolve();

  public constructor(
    dependencies: AgentSessionRecorderDependencies,
    attempt: AgentSessionAttemptRecord,
  ) {
    this.dependencies = dependencies;
    this.clock = dependencies.clock ?? (() => new Date().toISOString());
    this.attempt = attempt;
    this.turns.set(attempt.key.attemptId, 1);
    this.persist(attempt);
  }

  /** What the adapter confirmed about continuing its sessions; `null` before `initialize`. */
  public get capabilities(): AcpContinuationCapabilities | null {
    return this.continuation;
  }

  /** The attempt whose turn the process runs now. */
  public get current(): AgentSessionAttemptRecord {
    return this.attempt;
  }

  /**
   * Points the recorder at the attempt whose turn starts next in the same process.
   *
   * @param attempt - The attempt of the next group member or the next instruction.
   */
  public bind(attempt: AgentSessionAttemptRecord): void {
    this.flushMessage();
    this.attempt = attempt;
    this.hasClaudeObservation = false;
    if (!this.turns.has(attempt.key.attemptId))
      this.turns.set(attempt.key.attemptId, 1);
    this.persist(attempt);
  }

  /**
   * Stores a new state of the current attempt, such as its workspace or the end of its turn.
   *
   * @param attempt - The changed attempt; its key stays the same.
   */
  public revise(attempt: AgentSessionAttemptRecord): void {
    this.persist(attempt);
  }

  /** The turn of the current attempt that runs now, from 1. */
  public turn(): number {
    return this.turns.get(this.attempt.key.attemptId) ?? 1;
  }

  /** Records the capabilities the adapter announced. */
  public readonly announced = (
    capabilities: AgentCapabilities | null | undefined,
  ): void => {
    this.continuation = readContinuationCapabilities(capabilities);
    this.record({
      kind: "status",
      text: `adapter can resume: ${this.continuation.canResume ? "yes" : "no"}, load: ${this.continuation.canLoad ? "yes" : "no"}`,
    });
  };

  /** Receives one update of the adapter. */
  public readonly update = (update: SessionUpdate): void => {
    if (this.attempt.provider === "codex_cli") this.readCodexUsage(update);
    if (THOUGHT_BOUNDARIES.has(update.sessionUpdate)) this.flushThought();
    if (update.sessionUpdate === "agent_message_chunk") {
      if (update.content.type === "text") {
        this.messageBytes += Buffer.byteLength(update.content.text);
        if (this.messageBytes > 1_048_576)
          throw new AgentError("acp_output_overflow");
        this.message += update.content.text;
        this.flushLiveMessage();
      }
      return;
    }
    if (update.sessionUpdate === "agent_thought_chunk") {
      if (update.content.type === "text") this.thought += update.content.text;
    }
    if (update.sessionUpdate === "usage_update") {
      this.readUsage(update);
      return;
    }
    // Like the plan session's own reader, thoughts, tools and plans end the current message.
    if (MESSAGE_BOUNDARIES.has(update.sessionUpdate)) this.flushMessage();
    const event = this.toolEvent(update) ?? activityEvent(update);
    if (event) this.record(event);
  };

  /**
   * Records the tokens of the prompt that just ended; the next turn of the attempt begins.
   *
   * @remarks
   * A prompt a person's input cut short counts with its tokens as well, but
   * the history says that the turn went on instead of ending.
   */
  public readonly prompted = (
    usage: Usage | null,
    isContinued = false,
    nativeSessionId?: string,
  ): void => {
    this.flushThought();
    this.flushMessage();
    const attempt = this.attempt;
    const turn = this.turn();
    if (
      attempt.provider === "opencode" &&
      attempt.requestedModel?.startsWith("openrouter/")
    ) {
      this.endTurn(turn, isContinued);
      return;
    }
    const delta = this.promptDelta(usage);
    this.lastUsage = usage ?? this.lastUsage;
    this.endTurn(turn, isContinued);
    if (this.consumeObservedPrompt(usage)) return;
    if (
      delta === null &&
      attempt.provider !== "claude_code" &&
      attempt.provider !== "antigravity"
    )
      return;
    const recorded = buildPromptUsage({
      attempt,
      turn,
      delta,
      nativeSessionId,
      reportedAt: this.clock(),
    });
    this.enqueue(() =>
      (
        this.dependencies.saveUsage ??
        this.dependencies.store.saveTurnUsage.bind(this.dependencies.store)
      )(recorded),
    );
  };

  /** Allocates native Claude reports to the current step and turn while work is running. */
  public readonly claudeUsage = (observation: ClaudeUsageObservation): void => {
    if (this.attempt.provider !== "claude_code") return;
    this.hasClaudeObservation = true;
    const usage: AgentSessionTurnUsage = {
      attemptId: this.attempt.key.attemptId,
      turn: this.turn(),
      provider: "claude_code",
      model:
        this.attempt.confirmedModel.value ??
        this.attempt.requestedModel ??
        null,
      inputTokens: null,
      outputTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      totalTokens: null,
      inputIncludesCache: false,
      isPartial: false,
      reportedAt: this.clock(),
      claudeObservation: observation,
    };
    this.enqueue(async () => {
      await (
        this.dependencies.saveUsage ??
        this.dependencies.store.saveTurnUsage.bind(this.dependencies.store)
      )(usage);
      await this.dependencies.journal.append(usage.attemptId, [
        { kind: "usage", turn: usage.turn, text: "Claude usage updated" },
      ]);
    });
  };

  /** Captures native message usage as OpenCode updates each model step. */
  public readonly openCodeMessages = (
    messages: readonly OpenCodeMessageUsage[],
    pricingDirectory: string,
    freeModelId: string | null,
    mapping: Readonly<Record<string, string>>,
  ): void => {
    const save = this.dependencies.store.saveOpenCodeMessage;
    if (!save || this.attempt.provider !== "opencode") return;
    for (const message of messages) {
      const key = `${message.sessionId}:${message.id}`;
      const fingerprint = JSON.stringify(message);
      if (this.openCodeSnapshots.get(key) === fingerprint) continue;
      this.openCodeSnapshots.set(key, fingerprint);
      const attemptId = this.attempt.key.attemptId;
      const turn = this.turn();
      const reportedAt = this.clock();
      this.enqueue(async () => {
        const price = await openRouterPriceCatalog(pricingDirectory).calculate(
          message,
          mapping,
          freeModelId !== null && message.model === freeModelId,
        );
        await save.call(this.dependencies.store, {
          ...message,
          attemptId,
          turn,
          price,
          reportedAt,
        });
      });
      this.record({
        kind: "usage",
        text: `OpenCode message ${message.id} usage updated`,
      });
    }
  };

  /** Reads each completed native OpenCode message once, including sub-sessions. */
  public readonly nativeUsage = async (
    sessionId: string,
    dataHome: string,
  ): Promise<void> => {
    if (!this.attempt.requestedModel?.startsWith("openrouter/")) return;
    const save = this.dependencies.store.saveOpenRouterUsage;
    if (!save) return;
    const snapshot = this.dependencies.pricing?.current() ?? null;
    const attemptId = this.attempt.key.attemptId;
    const reportedAt = this.clock();
    for (const message of nativeMessages(dataHome, sessionId)) {
      const charge = chargeOpenRouterMessage(
        message.model,
        message.tokens,
        snapshot,
      );
      const inserted = await save.call(this.dependencies.store, {
        sessionId: message.sessionId,
        messageId: message.messageId,
        attemptId,
        model: message.model,
        inputTokens: message.tokens.input,
        outputTokens: message.tokens.output,
        reasoningTokens: message.tokens.reasoning,
        cacheReadTokens: message.tokens.cacheRead,
        cacheWriteTokens: message.tokens.cacheWrite,
        nativeCost: message.nativeCost,
        costAmount: charge.amount,
        costState: charge.state,
        priceSnapshot: charge.prices ? JSON.stringify(charge.prices) : null,
        pricedAt: charge.pricedAt,
        reportedAt,
      });
      if (!inserted) continue;
      this.record({
        kind: "usage",
        text: `OpenRouter usage ${message.messageId}`,
      });
      if (
        charge.amount !== null &&
        message.nativeCost !== null &&
        Math.abs(charge.amount - message.nativeCost) > 0.00000001
      )
        this.record({
          kind: "status",
          text: `OpenRouter catalog cost $${charge.amount} differs from OpenCode $${message.nativeCost} for ${message.messageId}`,
        });
    }
  };

  /** Records that the connection to the adapter ended. */
  public readonly closed = (): void => {
    this.flushThought();
    this.flushMessage();
    this.record({ kind: "status", text: "adapter connection closed" });
  };

  /**
   * Records an event of the current attempt that does not come from the adapter.
   *
   * @param event - A status, error or recovery event of Pages.
   */
  public note(event: Omit<AgentSessionEventInput, "turn">): void {
    this.record(event);
  }

  /** Resolves once everything reported so far is stored. */
  public async settled(): Promise<void> {
    this.flushThought();
    this.flushMessage();
    await this.drained();
  }

  /** Applies storage backpressure after each native notification and reports a durable history failure. */
  public readonly drained = async (): Promise<void> => {
    await this.writes;
    if (this.hasWriteFailure) throw new AgentError("plan_history_unavailable");
  };

  /**
   * The event of a tool call: one when it starts, with its command, and one
   * when it ends, with command and output; updates in between only add to
   * what the call reported.
   */
  private promptDelta(usage: Usage | null): TurnTokenDelta | null {
    const provider = this.attempt.provider;
    if (provider === "codex_cli") return codexPromptTokens(usage);
    const isEmptyClaudeTally =
      provider === "claude_code" &&
      usage?.totalTokens === 0 &&
      !this.hasClaudeObservation;
    return readTurnTokens(
      ACP_USAGE_CAPABILITIES[provider],
      isEmptyClaudeTally ? null : usage,
      this.lastUsage,
    );
  }

  private endTurn(turn: number, isContinued: boolean): void {
    this.turns.set(this.attempt.key.attemptId, turn + 1);
    this.record({
      kind: "status",
      text: isContinued ? `turn ${turn} continued` : `turn ${turn} ended`,
      turn,
    });
  }

  /** Whether the provider already reported this prompt's usage, which then goes unrecorded here. */
  private consumeObservedPrompt(usage: Usage | null): boolean {
    const provider = this.attempt.provider;
    if (provider === "codex_cli" && this.hasNativeCodexUsage) {
      this.hasNativeCodexUsage = false;
      return usage !== null;
    }
    if (provider === "claude_code" && this.hasClaudeObservation) {
      this.hasClaudeObservation = false;
      return true;
    }
    return false;
  }

  private toolEvent(
    update: SessionUpdate,
  ): Omit<AgentSessionEventInput, "turn"> | null {
    if (update.sessionUpdate === "tool_call") {
      const state: ToolCallState = {
        title: update.title,
        kind: update.kind ?? "other",
        input: describeInput(update.rawInput),
        ...(PROGRESS_TOOL.test(update.title) ? { raw: update.rawInput } : {}),
      };
      this.tools.set(update.toolCallId, state);
      return this.announcement(update.toolCallId, state);
    }
    if (update.sessionUpdate !== "tool_call_update") return null;
    const state = this.updatedTool(update);
    if (update.status !== "completed" && update.status !== "failed")
      return this.announcement(update.toolCallId, state);
    this.tools.delete(update.toolCallId);
    const progress =
      update.status === "completed" ? progressText(state.raw) : null;
    if (progress !== null)
      return {
        kind: "progress",
        text: progress,
        dedupeKey: `tool:${update.toolCallId}:progress`,
      };
    return {
      kind: update.status === "completed" ? "tool_completed" : "tool_failed",
      text: toolText(state, describeOutput(update)),
      dedupeKey: `tool:${update.toolCallId}:${update.status}`,
    };
  }

  /** What a tool call reported so far, with this update applied. */
  private updatedTool(
    update: Extract<SessionUpdate, { sessionUpdate: "tool_call_update" }>,
  ): ToolCallState {
    const state = this.tools.get(update.toolCallId) ?? {
      title: "",
      kind: "other",
      input: "",
    };
    if (update.title) state.title = update.title;
    if (update.kind) state.kind = update.kind;
    if (update.rawInput !== undefined)
      state.input = describeInput(update.rawInput);
    if (PROGRESS_TOOL.test(state.title) && update.rawInput !== undefined)
      state.raw = update.rawInput;
    this.tools.set(update.toolCallId, state);
    return state;
  }

  /**
   * The start of a tool call, once its command or path is known.
   *
   * @remarks
   * OpenCode announces a call before its arguments; its start is recorded
   * with the first update that names them, so the terminal shows what runs.
   * A progress report becomes a todo line once Pages took it.
   */
  private announcement(
    toolCallId: string,
    state: ToolCallState,
  ): Omit<AgentSessionEventInput, "turn"> | null {
    if (state.isAnnounced || state.raw !== undefined || state.input === "")
      return null;
    state.isAnnounced = true;
    return {
      kind: "tool_started",
      text: toolText(state),
      dedupeKey: `tool:${toolCallId}:started`,
    };
  }

  private readCodexUsage(update: SessionUpdate): void {
    const parsed = codexThreadReportSchema.safeParse(
      update._meta?.pagesCodexUsage,
    );
    if (!parsed.success) return;
    const report = parsed.data;
    if (!report.baseline) this.hasNativeCodexUsage = true;
    const attempt = this.attempt;
    const turn = this.turn();
    const reportedAt = this.clock();
    this.enqueue(() =>
      this.dependencies.store.saveTurnUsage({
        ...report.totals,
        totalTokens:
          report.totals.inputTokens === null ||
          report.totals.outputTokens === null
            ? null
            : report.totals.inputTokens + report.totals.outputTokens,
        cacheWriteTokens: null,
        inputIncludesCache: true,
        isPartial:
          report.totals.inputTokens === null ||
          report.totals.outputTokens === null,
        attemptId: attempt.key.attemptId,
        turn,
        provider: "codex_cli",
        model: report.model,
        reportedAt,
        codex: {
          connectionId: attempt.connectionId ?? "",
          agentId: attempt.agentId ?? "",
          report,
        },
      }),
    );
    if (!report.baseline)
      this.record({ kind: "usage", text: "Codex thread usage updated" });
  }

  private readUsage(
    update: Extract<SessionUpdate, { sessionUpdate: "usage_update" }>,
  ): void {
    const reportedAt = this.clock();
    const context = readContextUsage(update, reportedAt);
    const model = reportedModel(update);
    // Only the first model counts; a later report may belong to a subagent.
    const confirmedModel =
      model !== null && this.attempt.confirmedModel.value === null
        ? { value: model, source: "acp_usage_report" as const, reportedAt }
        : this.attempt.confirmedModel;
    const cost = this.attempt.requestedModel?.startsWith("openrouter/")
      ? null
      : (readCost(update) ?? this.attempt.context.cost ?? null);
    this.persist({
      ...this.attempt,
      context: {
        ...(context.source === null ? this.attempt.context : context),
        cost,
      },
      confirmedModel,
      updatedAt: reportedAt,
    });
  }

  /** Stores the part of a message written so far, at most once a second. */
  private flushLiveMessage(): void {
    const now = Date.now();
    if (now - this.messageFlushedAt < LIVE_MESSAGE_MS) return;
    this.messageFlushedAt = now;
    if (this.message === "") return;
    const text = this.message;
    this.message = "";
    this.record({ kind: "agent_message", text });
  }

  private flushThought(): void {
    if (this.thought.trim() === "") {
      this.thought = "";
      return;
    }
    const text = this.thought;
    this.thought = "";
    this.record({ kind: "thought", text });
  }

  private flushMessage(): void {
    this.messageFlushedAt = 0;
    this.messageBytes = 0;
    if (this.message.trim() === "") {
      this.message = "";
      return;
    }
    const text = this.message;
    this.message = "";
    this.record({ kind: "agent_message", text });
  }

  private record(
    event: Omit<AgentSessionEventInput, "turn"> & {
      readonly turn?: number;
    },
  ): void {
    const { attemptId } = this.attempt.key;
    const entry: AgentSessionEventInput = {
      ...event,
      turn: event.turn ?? this.turn(),
    };
    this.enqueue(async () => {
      await this.dependencies.journal.append(attemptId, [entry]);
    });
  }

  private persist(attempt: AgentSessionAttemptRecord): void {
    this.attempt = attempt;
    this.enqueue(() => this.dependencies.store.saveAttempt(attempt));
  }

  private enqueue(write: () => Promise<void>): void {
    if (this.pendingWrites >= 64 || this.hasWriteFailure) {
      this.hasWriteFailure = true;
      return;
    }
    this.pendingWrites += 1;
    this.writes = this.writes
      .then(write)
      .catch((error: unknown) => {
        this.hasWriteFailure = true;
        logCaughtError("AgentSessionRecorder", error);

        // The next native acknowledgement is withheld and the owned session fails at drained().
        logDiagnostic(
          "AgentSessionRecorder",
          "warn",
          "PageAgentCLI could not store a session entry",
          error,
        );
      })
      .finally(() => {
        this.pendingWrites -= 1;
      });
  }
}
