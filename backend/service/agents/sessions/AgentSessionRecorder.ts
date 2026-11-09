import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError, logDiagnostic } from "@/backend/logging/Logger";

import { readContinuationCapabilities } from "./AgentSessionContinuation";
import {
  ACP_USAGE_CAPABILITIES,
  readContextUsage,
  readTurnTokens,
} from "./AgentSessionUsage";

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

/** The key under which claude-agent-acp names the model of a usage update. */
const CLAUDE_MODEL_KEY = "_claude/model";

/** What a recorder writes to. */
export interface AgentSessionRecorderDependencies {
  readonly journal: AgentSessionJournal;
  readonly store: AgentSessionStore;
  readonly clock?: () => string;
}

/** Updates of agent activity that end the current message. */
const MESSAGE_BOUNDARIES: ReadonlySet<SessionUpdate["sessionUpdate"]> = new Set(
  ["agent_thought_chunk", "tool_call", "tool_call_update", "plan"],
);

/** Longest command or output kept of one tool call; the journal limits the event as a whole. */
const TOOL_TEXT = 3_000;

/** What a tool call reported so far: its title, kind and input. */
interface ToolCallState {
  title: string;
  kind: string;
  input: string;
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
  const command = input?.command ?? input?.cmd;
  if (typeof command === "string") return shortened(command);
  if (Array.isArray(command)) return shortened(command.map(String).join(" "));
  for (const field of ["file_path", "path", "pattern", "query", "url"]) {
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
 * The text of a tool call: its title, the command and, once it ended, its output.
 *
 * @remarks
 * A call without a title is named by its kind, never by the internal ID of
 * the call, which says nothing to a reader.
 */
function toolText(state: ToolCallState, output = ""): string {
  const title = state.title.trim() || state.kind;
  return [title, state.input ? `$ ${state.input}` : "", output]
    .filter((part) => part !== "")
    .join("\n");
}

/** The event an update of plans or modes is recorded as; `null` for other updates. */
function activityEvent(
  update: SessionUpdate,
): Omit<AgentSessionEventInput, "turn"> | null {
  if (update.sessionUpdate === "plan")
    return {
      kind: "plan",
      text: update.entries
        .map((entry) => `[${entry.status}] ${entry.content}`)
        .join("\n"),
    };
  if (update.sessionUpdate === "current_mode_update")
    return { kind: "status", text: `mode ${update.currentModeId}` };
  return null;
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
  private pendingWrites = 0;
  private hasWriteFailure = false;
  private lastUsage: Usage | null = null;
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
    if (update.sessionUpdate === "agent_message_chunk") {
      if (update.content.type === "text") {
        this.messageBytes += Buffer.byteLength(update.content.text);
        if (this.messageBytes > 1_048_576)
          throw new AgentError("acp_output_overflow");
        this.message += update.content.text;
      }
      return;
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

  /** Records the tokens of the prompt that just ended; the next turn of the attempt begins. */
  public readonly prompted = (usage: Usage | null): void => {
    this.flushMessage();
    const { provider, key } = this.attempt;
    const turn = this.turn();
    const capability = ACP_USAGE_CAPABILITIES[provider];
    const delta = readTurnTokens(capability, usage, this.lastUsage);
    this.lastUsage = usage ?? this.lastUsage;
    this.turns.set(key.attemptId, turn + 1);
    this.record({ kind: "status", text: `turn ${turn} ended`, turn });
    if (delta === null) return;
    const reportedAt = this.clock();
    const model = this.attempt.confirmedModel.value;
    this.enqueue(() =>
      this.dependencies.store.saveTurnUsage({
        ...delta.tokens,
        attemptId: key.attemptId,
        turn,
        provider,
        model,
        reportedAt,
      }),
    );
  };

  /** Records that the connection to the adapter ended. */
  public readonly closed = (): void => {
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
      };
      this.tools.set(update.toolCallId, state);
      return {
        kind: "tool_started",
        text: toolText(state),
        dedupeKey: `tool:${update.toolCallId}:started`,
      };
    }
    if (update.sessionUpdate !== "tool_call_update") return null;
    const state = this.tools.get(update.toolCallId) ?? {
      title: "",
      kind: "other",
      input: "",
    };
    if (update.title) state.title = update.title;
    if (update.kind) state.kind = update.kind;
    if (update.rawInput !== undefined)
      state.input = describeInput(update.rawInput);
    this.tools.set(update.toolCallId, state);
    if (update.status !== "completed" && update.status !== "failed")
      return null;
    this.tools.delete(update.toolCallId);
    return {
      kind: update.status === "completed" ? "tool_completed" : "tool_failed",
      text: toolText(state, describeOutput(update)),
      dedupeKey: `tool:${update.toolCallId}:${update.status}`,
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
    this.persist({
      ...this.attempt,
      context: context.source === null ? this.attempt.context : context,
      confirmedModel,
      updatedAt: reportedAt,
    });
  }

  private flushMessage(): void {
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
