import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import {
  describeSessionModel,
  requireSessionAttempt,
  sessionStart,
} from "./AgentSessionAttempts";
import { decideContinuation } from "./AgentSessionContinuation";
import { AgentSessionRecorder } from "./AgentSessionRecorder";
import { UNKNOWN_CONTEXT, sumTurnUsage } from "./AgentSessionUsage";
import { checkSessionWorkspace } from "./AgentSessionWorkspace";

import type { AcpSessionListener } from "@/backend/agents/acp/AcpChat";
import type { PlanSessionTurn } from "@/backend/agents/AgentPlanExecution";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type {
  AgentSessionEventPage,
  AgentSessionKey,
  AgentSessionMessageKind,
  AgentSessionState,
  AgentSessionView,
} from "@/definition/AgentSessionJournal";
import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";
import type {
  AgentSessionAttempt,
  AgentSessionNode,
  AgentSessionStart,
} from "./AgentSessionAttempts";
import type {
  AgentSessionInbox,
  AgentSessionSendResult,
} from "./AgentSessionInbox";
import type {
  AgentSessionEventListener,
  AgentSessionJournal,
} from "./AgentSessionJournal";
import type {
  AgentSessionAttemptRecord,
  AgentSessionStore,
} from "./AgentSessionStore";

/** Reads and stops runs with every current right of their executor checked. */
export interface AgentSessionRunAccess {
  run(userId: string, runId: string): Promise<AgentPlanRun>;
  stop(userId: string, runId: string): Promise<AgentPlanRun>;
}

/** An open native session that can take one more turn of an attempt. */
export interface AgentSessionLiveTurn {
  /** Sends an instruction as a turn of its own; resolves when that turn ended. */
  readonly instruct: (text: string) => Promise<void>;
  /** Cancels the running turn only; absent where only ending the process would stop it. */
  readonly cancelTurn?: () => Promise<boolean>;
}

/** What the session service works with. */
export interface AgentSessionServiceDependencies {
  readonly runs: AgentSessionRunAccess;
  readonly store: AgentSessionStore;
  readonly journal: AgentSessionJournal;
  readonly inbox: AgentSessionInbox;
  /** Whether a node waits for a free ACP slot. */
  readonly isWaitingForCapacity?: (runId: string, stepId: string) => boolean;
  /** A Pages completion is independent of native ACP continuation capabilities. */
  readonly hasPlanCheckpoint?: (runId: string) => Promise<boolean>;
  readonly clock?: () => string;
}

const UNKNOWN_VALUE = { value: null, source: null, reportedAt: null } as const;

const ACTIVE_STATES: ReadonlySet<AgentSessionState> = new Set([
  "starting",
  "running",
  "waiting_for_input",
  "idle",
  "recovering",
]);

function isRunActive(run: AgentPlanRun): boolean {
  return ["running", "pausing", "paused", "stopping"].includes(run.status);
}

function legacyState(attempt: AgentSessionAttempt): AgentSessionState {
  const { step, record } = attempt;
  if (step.status === "cancelled") return "cancelled";
  if (step.status === "failed") return "failed";
  if (record.endedAt !== null || step.status === "succeeded") return "ended";
  if (step.status === "running")
    return record.startedAt === null ? "starting" : "running";
  return "idle";
}

/**
 * The PageAgentCLI sessions of plan nodes: recording, reading and steering.
 *
 * @remarks
 * Every read and every operation first reads the run through the plan
 * service, which checks the executor's current rights to plan, workspace,
 * agents and tickets, and then requires that plan, run, node and attempt
 * belong together. Reading and following use only the journal; they start
 * no process and occupy no resource slot. An instruction reaches an agent
 * only through a native session that the step runner offered as live; the
 * frozen plan assignment is never changed.
 */
export class AgentSessionService {
  private readonly dependencies: AgentSessionServiceDependencies;
  private readonly clock: () => string;
  private readonly recorders = new Map<string, AgentSessionRecorder>();
  /** Open native sessions offered for instructions, by attempt, with their process instance. */
  private readonly live = new Map<
    string,
    { readonly instanceId: string; readonly turn: AgentSessionLiveTurn }
  >();

  public constructor(dependencies: AgentSessionServiceDependencies) {
    this.dependencies = dependencies;
    this.clock = dependencies.clock ?? (() => new Date().toISOString());
  }

  /**
   * Starts recording a turn of a node and returns the listener of its process.
   *
   * @param node - The run, node and record of the turn.
   * @param instanceId - The process the turn runs in.
   * @returns `undefined` for a node without an ACP attempt, such as an API request.
   *
   * @remarks
   * Members of an ACP group share the recorder of their process, which is
   * pointed at each member's attempt in turn.
   */
  public listen(
    node: AgentSessionNode,
    instanceId: string,
  ): AcpSessionListener | undefined {
    const start = sessionStart(node, instanceId);
    return start === null ? undefined : this.record(start);
  }

  /**
   * Records how a turn ended and lets waiting instructions follow it.
   *
   * @param record - The node's record; nothing is recorded without one.
   * @param turn - The end of the turn as the session reported it.
   */
  public async settle(
    record: AgentPlanSessionRecord | null,
    turn: Pick<PlanSessionTurn, "failure" | "errorCode">,
  ): Promise<void> {
    if (record) await this.settleInstance(record.instanceId, turn);
  }

  /**
   * Ends the recording of a node whose start or evaluation failed outside its turn.
   *
   * @param record - The node's record; nothing is recorded without one.
   * @param failure - Whether a stop or a failure ended the node.
   */
  public async abandon(
    record: AgentPlanSessionRecord | null,
    failure: "cancelled" | "failed",
  ): Promise<void> {
    await this.settle(record, { failure, errorCode: null });
    await this.released(record);
  }

  /** Records that the process of a node's session ended; its attempts can no longer continue live. */
  public async released(record: AgentPlanSessionRecord | null): Promise<void> {
    if (record) await this.releaseInstance(record.instanceId);
  }

  /**
   * Offers the open native session of an attempt for further instructions.
   *
   * @returns Withdraws the offer, for example before the session closes.
   */
  public offer(
    attempt: { readonly attemptId: string; readonly instanceId: string },
    turn: AgentSessionLiveTurn,
  ): () => void {
    const entry = { instanceId: attempt.instanceId, turn };
    this.live.set(attempt.attemptId, entry);
    return () => {
      if (this.live.get(attempt.attemptId) === entry)
        this.live.delete(attempt.attemptId);
    };
  }

  /**
   * Reads status, metadata, usage, continuation, instructions and allowed actions of a session.
   *
   * @throws {AgentError} `plan_access_denied` for a session of another run,
   * node or attempt, or without the executor's current rights.
   */
  public async view(
    userId: string,
    key: AgentSessionKey,
  ): Promise<AgentSessionView> {
    const { run, attempt } = await this.authorize(userId, key);
    const stored = await this.dependencies.store.findAttempt(key.attemptId);
    const runTurns = await this.dependencies.store.listRunUsage(run.id);
    const turns = runTurns.filter((turn) => turn.attemptId === key.attemptId);
    const isLive = this.live.has(key.attemptId) && isRunActive(run);
    const state = this.state(run, attempt, stored);
    const recorder = this.recorders.get(attempt.record.instanceId);
    return {
      key,
      provider: attempt.record.runner,
      state,
      groupId: attempt.step.groupId ?? null,
      workspace: stored?.workspace ?? null,
      model: describeSessionModel(attempt.record, stored),
      context: stored?.context ?? UNKNOWN_CONTEXT,
      turns,
      totals: sumTurnUsage(turns),
      runTotals: sumTurnUsage(runTurns),
      continuation: decideContinuation({
        isAuthorized: true,
        isConfigurationCompatible: true,
        isProcessAlive: isLive,
        acpSessionId: attempt.record.sessionId,
        capabilities:
          recorder?.capabilities ??
          attempt.record.continuationCapabilities ??
          null,
        // Plan nodes have no resume or load path yet; it is reported, never offered.
        canUseCapabilities: false,
        // No path starts a reconstructed session yet; it is never offered.
        canReconstruct: false,
        hasPlanCheckpoint:
          (await this.dependencies.hasPlanCheckpoint?.(run.id)) ?? false,
      }),
      messages: await this.dependencies.store.listMessages(key.attemptId),
      actions: {
        canSend: isLive,
        canCancelTurn:
          isLive &&
          state === "running" &&
          this.live.get(key.attemptId)?.turn.cancelTurn !== undefined,
        canCancelRun: isRunActive(run),
        canRecover: false,
      },
    };
  }

  /**
   * Reads the history of a session after a cursor.
   *
   * @remarks
   * A run from before PAGE-85 has only the short event lines of its record;
   * they are returned once, marked as such.
   */
  public async history(
    userId: string,
    key: AgentSessionKey,
    page: { readonly after: number; readonly limit: number },
  ): Promise<AgentSessionEventPage> {
    const { attempt } = await this.authorize(userId, key);
    if (attempt.isLegacy) return this.legacyHistory(attempt, page.after);
    return this.dependencies.journal.page(
      key.attemptId,
      page.after,
      page.limit,
    );
  }

  /**
   * Follows the history of a session live from a cursor.
   *
   * @returns Ends the following; it keeps no process open.
   */
  public async follow(
    userId: string,
    key: AgentSessionKey,
    after: number,
    listener: AgentSessionEventListener,
  ): Promise<() => void> {
    await this.authorize(userId, key);
    return this.dependencies.journal.follow(key.attemptId, after, listener);
  }

  /**
   * Sends an additional or repair instruction to the session of an attempt.
   *
   * @throws {AgentError} `plan_run_unavailable` for a run that ended, and
   * `plan_session_unavailable` without an open native session to continue.
   */
  public async send(
    userId: string,
    key: AgentSessionKey,
    input: { readonly kind: AgentSessionMessageKind; readonly text: string },
  ): Promise<AgentSessionSendResult> {
    const { run, attempt } = await this.authorize(userId, key);
    if (run.status !== "running" || run.stopRequested)
      throw new AgentError("plan_run_unavailable");
    const text = input.text.trim();
    if (text === "") throw new AgentError("plan_invalid");
    if (!this.live.has(key.attemptId))
      throw new AgentError("plan_session_unavailable");
    return this.dependencies.inbox.send(
      {
        attemptId: key.attemptId,
        instanceId: attempt.record.instanceId,
        userId,
      },
      { kind: input.kind, text },
      async (message) => {
        // Rights, run and session are checked again right before the native write.
        const current = await this.authorize(userId, key);
        const live = this.live.get(key.attemptId);
        if (
          current.run.status !== "running" ||
          current.run.stopRequested ||
          !live
        )
          throw new AgentError("plan_session_unavailable");
        await live.turn.instruct(message.text);
      },
    );
  }

  /**
   * Cancels the running turn of a session, or the whole run.
   *
   * @returns What happened; a turn without a running one changes nothing.
   */
  public async cancel(
    userId: string,
    key: AgentSessionKey,
    scope: "turn" | "run",
  ): Promise<"turn_cancelled" | "run_stopped" | "nothing_running"> {
    const { run } = await this.authorize(userId, key);
    if (scope === "run") {
      if (!isRunActive(run)) return "nothing_running";
      await this.dependencies.runs.stop(userId, run.id);
      return "run_stopped";
    }
    const live = this.live.get(key.attemptId);
    const cancelTurn = live?.turn.cancelTurn;
    if (!cancelTurn || !(await cancelTurn())) return "nothing_running";
    await this.dependencies.journal.append(key.attemptId, [
      { turn: null, kind: "status", text: "turn cancelled by the executor" },
    ]);
    return "turn_cancelled";
  }

  private record(start: AgentSessionStart): AgentSessionRecorder {
    const existing = this.recorders.get(start.instanceId);
    // A later member continues the same native session: its last reports hold, with their time.
    const shared = existing?.current;
    const attempt: AgentSessionAttemptRecord = {
      key: start.key,
      userId: start.userId,
      provider: start.provider,
      instanceId: start.instanceId,
      groupId: start.groupId,
      state: "running",
      context: shared?.context ?? UNKNOWN_CONTEXT,
      confirmedModel: shared?.confirmedModel ?? UNKNOWN_VALUE,
      confirmedReasoning: shared?.confirmedReasoning ?? UNKNOWN_VALUE,
      workspace: null,
      updatedAt: this.clock(),
    };
    const recorder =
      existing ??
      new AgentSessionRecorder(
        { journal: this.dependencies.journal, store: this.dependencies.store },
        attempt,
      );
    if (existing) existing.bind(attempt);
    this.recorders.set(start.instanceId, recorder);
    this.dependencies.inbox.turnStarted(start.instanceId);
    if (start.directory !== null)
      void this.readWorkspace(recorder, start.directory);
    return recorder;
  }

  private async settleInstance(
    instanceId: string,
    turn: Pick<PlanSessionTurn, "failure" | "errorCode">,
  ): Promise<void> {
    const recorder = this.recorders.get(instanceId);
    try {
      if (!recorder) return;
      const isCompleted = turn.failure === null && turn.errorCode === null;
      if (!isCompleted)
        recorder.note({
          kind: "error",
          text: `turn ${turn.failure ?? "failed"}${turn.errorCode ? `: ${turn.errorCode}` : ""}`,
        });
      await this.update(recorder, (current) => ({
        ...current,
        state: isCompleted ? "idle" : this.failedState(turn),
      }));
    } finally {
      this.dependencies.inbox.turnEnded(instanceId);
    }
  }

  private async releaseInstance(instanceId: string): Promise<void> {
    const recorder = this.recorders.get(instanceId);
    if (!recorder) return;
    this.recorders.delete(instanceId);
    for (const [attemptId, entry] of this.live)
      if (entry.instanceId === instanceId) this.live.delete(attemptId);
    await this.update(recorder, (current) => ({
      ...current,
      state: ACTIVE_STATES.has(current.state) ? "ended" : current.state,
    }));
  }

  private async authorize(
    userId: string,
    key: AgentSessionKey,
  ): Promise<{
    readonly run: AgentPlanRun;
    readonly attempt: AgentSessionAttempt;
  }> {
    const run = await this.dependencies.runs.run(userId, key.runId);
    return { run, attempt: requireSessionAttempt(run, key) };
  }

  private state(
    run: AgentPlanRun,
    attempt: AgentSessionAttempt,
    stored: AgentSessionAttemptRecord | null,
  ): AgentSessionState {
    if (
      attempt.step.status === "waiting" &&
      this.dependencies.isWaitingForCapacity?.(run.id, attempt.key.stepId)
    )
      return "waiting_for_capacity";
    if (!stored) return legacyState(attempt);
    // A server stop leaves the last stored state behind; the run tells how it ended.
    if (ACTIVE_STATES.has(stored.state) && !isRunActive(run))
      return legacyState(attempt) === "failed" ? "failed" : "ended";
    return stored.state;
  }

  private failedState(
    turn: Pick<PlanSessionTurn, "failure">,
  ): AgentSessionState {
    return turn.failure === "cancelled" ? "cancelled" : "failed";
  }

  private legacyHistory(
    attempt: AgentSessionAttempt,
    after: number,
  ): AgentSessionEventPage {
    const { record, key } = attempt;
    const events = record.events
      .map((text, index) => ({
        id: `${key.attemptId}:${index + 1}`,
        sequence: index + 1,
        stepId: key.stepId,
        attemptId: key.attemptId,
        turn: null,
        kind: "status" as const,
        createdAt: record.turnEndedAt ?? record.startedAt ?? "",
        text,
        isTruncated: false,
      }))
      .filter((event) => event.sequence > after);
    return {
      events,
      cursor: events.at(-1)?.sequence ?? (after > 0 ? after : null),
      hasMore: false,
      retainedFrom: null,
      source: "legacy_record",
    };
  }

  private async readWorkspace(
    recorder: AgentSessionRecorder,
    directory: string,
  ): Promise<void> {
    const attemptId = recorder.current.key.attemptId;
    try {
      const workspace = await checkSessionWorkspace(
        { directory, workspace: directory },
        this.clock(),
      );
      if (recorder.current.key.attemptId !== attemptId) return;
      await this.update(recorder, (current) => ({ ...current, workspace }));
    } catch (error: unknown) {
      logCaughtError("AgentSessionService", error);

      recorder.note({
        kind: "error",
        text: `workspace unavailable: ${error instanceof AgentError ? error.code : "unreadable"}`,
      });
    }
  }

  private async update(
    recorder: AgentSessionRecorder,
    change: (current: AgentSessionAttemptRecord) => AgentSessionAttemptRecord,
  ): Promise<void> {
    recorder.revise({ ...change(recorder.current), updatedAt: this.clock() });
    await recorder.settled();
  }
}
