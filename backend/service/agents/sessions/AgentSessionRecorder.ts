import { canonicalClaudeModel } from "@/definition/ClaudePriceModels";
import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError, logDiagnostic } from "@/backend/logging/Logger";
import {
  AGENT_TODO_LIMIT,
  AGENT_TODO_TEXT_LENGTH,
} from "@/definition/AgentPlanAgentTodos";

import { readContinuationCapabilities } from "./AgentSessionContinuation";
import { MAXIMUM_EVENT_TEXT } from "./AgentSessionJournal";
import {
  ACP_USAGE_CAPABILITIES,
  readContextUsage,
  readTurnTokens,
} from "./AgentSessionUsage";

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

/** The key under which claude-agent-acp names the model of a usage update. */
const CLAUDE_MODEL_KEY = "_claude/model";

/** What a recorder writes to. */
export interface AgentSessionRecorderDependencies {
  readonly journal: AgentSessionJournal;
  readonly store: AgentSessionStore;
  readonly clock?: () => string;
  readonly saveUsage?: (usage: AgentSessionTurnUsage) => Promise<void>;
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

/** The Pages tool whose calls become todo lines instead of tool lines (PAGE-284). */
const PROGRESS_TOOL = /update_step_progress/u;

/** Longest command or output kept of one tool call; the journal limits the event as a whole. */
const TOOL_TEXT = 3_000;

/** What a tool call reported so far: its title, kind and input. */
interface ToolCallState {
  title: string;
  kind: string;
  input: string;
  /** The raw input, kept only for a call of `update_step_progress`. */
  raw?: unknown;
  /** The start was recorded; an adapter that names the arguments only later is announced then. */
  isAnnounced?: boolean;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}

function shortened(text: string): string {
  return text.length > TOOL_TEXT ? `${text.slice(0, TOOL_TEXT)} …` : text;
}

/** The command, file or query a tool call works on, as the adapter reported it. */
function describeInput(raw: unknown): string {
  if (raw === undefined || raw === null) return "";
  if (typeof raw === "string") return shortened(raw);
  const input = readRecord(raw);
  // An adapter announces a call before its arguments; an empty input says nothing yet.
  if (input && Object.keys(input).length === 0) return "";
  const command = input?.command ?? input?.cmd;
  if (typeof command === "string") return shortened(command);
  if (Array.isArray(command)) return shortened(command.map(String).join(" "));
  for (const field of [
    "file_path",
    "filePath",
    "path",
    "pattern",
    "query",
    "url",
  ]) {
    const value = input?.[field];
    if (typeof value === "string") return shortened(value);
  }
  return shortened(JSON.stringify(raw));
}

/** What a tool call returned: its text content, diffs and raw output. */
function describeOutput(
  update: Extract<SessionUpdate, { sessionUpdate: "tool_call_update" }>,
): string {
  const parts: string[] = [];
  for (const entry of update.content ?? []) {
    if (entry.type === "content" && entry.content.type === "text")
      parts.push(entry.content.text);
    else if (entry.type === "diff")
      parts.push(`diff ${entry.path}\n${entry.newText}`);
  }
  const raw = update.rawOutput;
  const output = readRecord(raw);
  if (parts.length === 0 && typeof raw === "string") parts.push(raw);
  else if (parts.length === 0 && output) {
    for (const field of [
      "formatted_output",
      "output",
      "stdout",
      "stderr",
      "result",
    ]) {
      const value = output[field];
      if (typeof value === "string" && value.trim()) parts.push(value);
    }
    if (parts.length === 0) parts.push(JSON.stringify(raw));
  }
  return shortened(parts.join("\n").trim());
}

/**
 * The text of a tool call: its title, its kind, the command and, once it ended, its output.
 *
 * @remarks
 * A call without a title is named by its kind, never by the internal ID of
 * the call, which says nothing to a reader. The kind line (`@kind read`)
 * lets the Pages terminal name the call the same way for every provider
 * (PAGE-284).
 */
function toolText(state: ToolCallState, output = ""): string {
  const title = state.title.trim() || state.kind;
  return [
    title,
    `@kind ${state.kind}`,
    state.input ? `$ ${state.input}` : "",
    output,
  ]
    .filter((part) => part !== "")
    .join("\n");
}

/**
 * The journal text of a structured plan update (PAGE-306): JSON with the status and text of each entry.
 *
 * @remarks
 * The journal shortens a text beyond its limit, which would break the JSON.
 * A list that does not fit loses its last entries instead, so the text always
 * stays readable and the entries that are kept stay exact.
 */
function planText(
  entries: Extract<SessionUpdate, { sessionUpdate: "plan" }>["entries"],
): string {
  const kept = entries.slice(0, AGENT_TODO_LIMIT).map((entry) => ({
    content: entry.content.trim().slice(0, AGENT_TODO_TEXT_LENGTH),
    status: entry.status,
  }));
  let text = JSON.stringify({ entries: kept });
  while (text.length > MAXIMUM_EVENT_TEXT && kept.length > 0) {
    kept.pop();
    text = JSON.stringify({ entries: kept });
  }
  return text;
}

/** The event an update of plans or modes is recorded as; `null` for other updates. */
function activityEvent(
  update: SessionUpdate,
): Omit<AgentSessionEventInput, "turn"> | null {
  if (update.sessionUpdate === "plan")
    return { kind: "plan", text: planText(update.entries) };
  if (update.sessionUpdate === "current_mode_update")
    return { kind: "status", text: `mode ${update.currentModeId}` };
  return null;
}

/**
 * The todo states and activity of a successful `update_step_progress` call, as JSON.
 *
 * @returns `null` when the call reported no readable todos.
 */
function progressText(raw: unknown): string | null {
  const input = readRecord(raw);
  if (!input || !Array.isArray(input.todos)) return null;
  const todos = input.todos.flatMap((entry: unknown) => {
    const todo = readRecord(entry);
    return typeof todo?.id === "string" && typeof todo.status === "string"
      ? [{ id: todo.id.slice(0, 200), status: todo.status.slice(0, 20) }]
      : [];
  });
  if (todos.length === 0) return null;
  const activity =
    typeof input.activity === "string" ? input.activity.slice(0, 200) : null;
  return JSON.stringify({ todos, activity });
}

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
  private attempt: AgentSessionAttemptRecord;
  private message = "";
  private messageBytes = 0;
  private messageFlushedAt = 0;
  private thought = "";
  private pendingWrites = 0;
  private hasWriteFailure = false;
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
    const { provider, key } = this.attempt;
    const turn = this.turn();
    const capability = ACP_USAGE_CAPABILITIES[provider];
    const isEmptyClaudeTally =
      provider === "claude_code" &&
      usage?.totalTokens === 0 &&
      !this.hasClaudeObservation;
    const delta = readTurnTokens(
      capability,
      isEmptyClaudeTally ? null : usage,
      this.lastUsage,
    );
    this.lastUsage = usage ?? this.lastUsage;
    this.turns.set(key.attemptId, turn + 1);
    this.record({
      kind: "status",
      text: isContinued ? `turn ${turn} continued` : `turn ${turn} ended`,
      turn,
    });
    if (provider === "claude_code" && this.hasClaudeObservation) {
      this.hasClaudeObservation = false;
      return;
    }
    if (delta === null && provider !== "claude_code") return;
    const reportedAt = this.clock();
    const model =
      provider === "claude_code"
        ? (this.attempt.confirmedModel.value ??
          this.attempt.requestedModel ??
          null)
        : this.attempt.confirmedModel.value;
    this.enqueue(() =>
      (
        this.dependencies.saveUsage ??
        this.dependencies.store.saveTurnUsage.bind(this.dependencies.store)
      )({
        ...(delta?.tokens ?? {
          inputTokens: null,
          outputTokens: null,
          cacheReadTokens: null,
          cacheWriteTokens: null,
          totalTokens: null,
          inputIncludesCache: false,
          isPartial: true,
        }),
        ...(provider === "claude_code" && nativeSessionId && delta
          ? {
              claudeObservation: {
                sessionId: nativeSessionId,
                id: `${key.attemptId}:${turn}`,
                kind: "prompt" as const,
                models: [
                  {
                    model: canonicalClaudeModel(model ?? "unknown"),
                    inputTokens: delta.tokens.inputTokens,
                    outputTokens: delta.tokens.outputTokens,
                    cacheReadTokens: delta.tokens.cacheReadTokens,
                    cacheWriteTokens: delta.tokens.cacheWriteTokens,
                  },
                ],
              },
            }
          : {}),
        attemptId: key.attemptId,
        turn,
        provider,
        model,
        reportedAt,
      }),
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
    const cost = readCost(update) ?? this.attempt.context.cost ?? null;
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
