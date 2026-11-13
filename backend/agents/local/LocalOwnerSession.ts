import { randomUUID } from "node:crypto";
import path from "node:path";

import { AgentSessionJournal } from "@/backend/service/agents/sessions/AgentSessionJournal";
import { AgentSessionRecorder } from "@/backend/service/agents/sessions/AgentSessionRecorder";
import { UNKNOWN_CONTEXT } from "@/backend/service/agents/sessions/AgentSessionUsage";
import { checkSessionWorkspace } from "@/backend/service/agents/sessions/AgentSessionWorkspace";
import { sanitizePlanOutput } from "@/backend/service/agents/AgentPlanOutput";
import { logCaughtError } from "@/backend/logging/Logger";
import { AgentError } from "@/backend/error/AgentErrors";
import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";
import { AcpCleanupUnconfirmedError } from "@/backend/error/AcpCleanupUnconfirmedError";
import { allPlanRunResults } from "@/definition/AgentPlanLoopResults";
import { sessionStart } from "@/backend/service/agents/sessions/AgentSessionAttempts";

import { LocalSessionOutbox } from "./LocalSessionOutbox";
import { localDeferred } from "./LocalDeferred";
import { LocalAcpJournalListener } from "./LocalAcpJournalListener";
import { readLocalRecord, writeLocalRecord } from "./LocalSessionFiles";
import { canContinueLocalTurn } from "./LocalOwnerRunAuthorization";

import type { Database } from "@/backend/database/Database";
import type { AgentSessionState } from "@/definition/AgentSessionJournal";
import type {
  PlanExecution,
  PlanSession,
  PlanSessionObserver,
  PlanSessionClosed,
  PlanSessionTurn,
} from "@/backend/agents/AgentPlanExecution";
import type { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import type { AgentLocalSessionPreparation } from "@/backend/service/agents/AgentLocalSessionPreparation";
import type {
  LocalOwnerManifest,
  LocalSessionLaunch,
  LocalSessionMutation,
} from "./LocalSessionContracts";
import type { LocalSessionJournal } from "./LocalSessionJournal";

/** The API hands the bearer over right after it attached; a start without it fails. */
const BEARER_WAIT_MS = 60_000;

interface OwnerDependencies {
  readonly database: Database;
  readonly runs: AgentPlanRunRepository;
  readonly preparation: AgentLocalSessionPreparation;
  readonly execution: PlanExecution;
}

/** Owns the genuine ACP client, pending turn and native processes independently of Pages HTTP. */
export class LocalOwnerSession {
  private readonly manifest: LocalOwnerManifest;
  private readonly dependencies: OwnerDependencies;
  private readonly journal: LocalSessionJournal;
  private readonly outbox: LocalSessionOutbox;
  private readonly controller = new AbortController();
  private session: PlanSession | null = null;
  private starting: Promise<void> | null = null;
  private readonly startupReady = localDeferred<void>();
  private recorder: AgentSessionRecorder | null = null;
  private listener: LocalAcpJournalListener | null = null;
  private opening: Promise<PlanSession> | null = null;
  private observing: Promise<void> | null = null;
  private isTurnPending = false;
  private turns = 0;
  private canConfirmNoSession = true;
  private launch: LocalSessionLaunch;
  /** The plan bridge bearer; it arrives over the private socket and never reaches a file. */
  private readonly bearer = localDeferred<string>();
  private closing: Promise<PlanSessionClosed> | null = null;
  private cancellation: Promise<void> | null = null;
  private checkingStop = false;
  private stopTimer: ReturnType<typeof setInterval> | null = null;
  private hasJournalFailure = false;

  public constructor(
    manifest: LocalOwnerManifest,
    journal: LocalSessionJournal,
    dependencies: OwnerDependencies,
  ) {
    this.manifest = manifest;
    this.journal = journal;
    this.dependencies = dependencies;
    this.outbox = new LocalSessionOutbox(dependencies.database, journal);
    this.launch = manifest.launch;
  }

  /** Starts the claimed native turn once and settles its startup record before closeout can finish. */
  public start(): Promise<void> {
    this.starting ??= this.startOnce();
    return this.starting;
  }

  /** A retried IPC request for an already claimed attempt never sends its prompt twice. */
  public async next(launch: LocalSessionLaunch): Promise<void> {
    if (
      launch.instanceId !== this.launch.instanceId ||
      launch.runId !== this.launch.runId
    )
      throw new Error("Foreign native turn");
    const file = path.join(
      this.manifest.directory,
      `turn-${launch.turnId}.json`,
    );
    try {
      const existing = await readLocalRecord(file);
      if (JSON.stringify(existing) !== JSON.stringify(launch))
        throw new Error("Native turn request changed");
      return;
    } catch (error: unknown) {
      if (!isMissing(error)) throw error;
    }
    if (!this.session?.next || this.closing || this.isTurnPending)
      throw new Error("Native session cannot continue");
    const input = await this.prepare(launch);
    if (
      !canContinueLocalTurn(
        await this.dependencies.runs.find(launch.runId),
        launch,
      )
    )
      throw new AgentPlanCancelledError();
    await writeLocalRecord(file, launch);
    this.launch = launch;
    await writeLocalRecord(
      path.join(this.manifest.directory, "current.json"),
      launch,
    );
    await this.position(launch);
    this.observe(
      this.session.next(input, this.controller.signal, this.observer()),
      launch,
    );
  }

  /** Takes the plan bridge bearer into memory; the first one wins. */
  public receiveBearer(token: string): void {
    this.bearer.resolve(token);
  }

  /** A user's durable Stop ends only this owner's native session. */
  public cancel(): Promise<void> {
    this.cancellation ??= this.cancelOnce();
    return this.cancellation;
  }

  /** Gracefully closes the native protocol once; detaching the web process never calls this. */
  public close(): Promise<PlanSessionClosed> {
    this.closing ??= this.closeOnce();
    return this.closing;
  }

  /** Interrupts the running prompt of the turn, which then waits for a person's input (PAGE-284). */
  public async interrupt(): Promise<boolean> {
    return (await this.session?.interrupt?.()) ?? false;
  }

  /** Preserves native steering semantics with a durable command receipt before dispatch. */
  public async steer(prompt: string, commandId: string): Promise<string> {
    const file = path.join(this.manifest.directory, `steer-${commandId}.json`);
    try {
      await readLocalRecord(file);
      return "failed";
    } catch (error: unknown) {
      if (!isMissing(error)) throw error;
    }
    await writeLocalRecord(file, { prompt });
    return (
      (await this.session?.steer?.([{ type: "text", text: prompt }])) ??
      "inactive"
    );
  }

  /** Prevents a journal fault from masquerading as a complete history. */
  public async fail(error: unknown): Promise<void> {
    logCaughtError("LocalOwnerSession", error);
    this.hasJournalFailure = true;
    this.controller.abort();
    try {
      await this.close();
    } catch (closeError: unknown) {
      logCaughtError("LocalOwnerSession", closeError);
    }
  }

  private async startOnce(): Promise<void> {
    let hasFailed = false;
    try {
      await this.startNative();
    } catch (error: unknown) {
      hasFailed = true;
      logCaughtError("LocalOwnerSession", error);
      try {
        await this.recordStartupFailure(error);
      } catch (historyError: unknown) {
        this.hasJournalFailure = true;
        throw historyError;
      }
    } finally {
      this.startupReady.resolve();
    }
    if (hasFailed) await this.close();
  }

  private async startNative(): Promise<void> {
    const input = await this.prepare(this.launch);
    if (this.controller.signal.aborted || this.closing)
      throw new AgentPlanCancelledError();
    await writeLocalRecord(
      path.join(this.manifest.directory, "dispatch.json"),
      {
        attemptId: this.launch.attemptId,
        prompt: this.launch.prompt,
        commandId: randomUUID(),
      },
    );
    await this.position(this.launch);
    this.stopTimer = setInterval(() => {
      void this.checkStop();
    }, 250);
    const currentRun = await this.dependencies.runs.find(this.launch.runId);
    if (
      !canContinueLocalTurn(currentRun, this.launch) ||
      this.closing ||
      this.controller.signal.aborted
    ) {
      await this.markCancelled();
      throw new AgentPlanCancelledError();
    }
    this.canConfirmNoSession = false;
    this.opening = this.dependencies.execution.open(
      input,
      this.controller.signal,
      this.observer(),
    );
    this.session = await this.opening;
    this.observe(this.session.turn, this.launch);
    void this.session.terminated
      ?.then(() => this.close())
      .catch((error: unknown) => this.fail(error));
  }

  /** Records a real preparation/start failure rather than leaving a pending turn without a result. */
  private async recordStartupFailure(error: unknown): Promise<void> {
    this.canConfirmNoSession = !(error instanceof AcpCleanupUnconfirmedError);
    await this.failureRecorder();
    this.recorder?.note({
      kind: "error",
      text: `native startup: ${error instanceof AgentError ? error.code : "plan_step_failed"}`,
    });
    await this.recorder?.settled();
    await this.journal.append({
      kind: "turn",
      attemptId: this.launch.attemptId,
      turnId: this.launch.turnId,
      result: {
        output: "",
        sessionId: null,
        failure:
          error instanceof AgentPlanCancelledError ? "cancelled" : "failed",
        errorCode:
          error instanceof AgentError ? error.code : "plan_step_failed",
        endedAt: new Date().toISOString(),
        permissionDenials: 0,
        effective: {},
        events: ["native session startup failed"],
      },
    });
  }

  private async prepare(
    launch: LocalSessionLaunch,
  ): Promise<
    Awaited<ReturnType<AgentLocalSessionPreparation["prepare"]>>["input"]
  > {
    const prepared = await this.dependencies.preparation.prepare(
      launch,
      await this.bearerFor(launch),
    );
    const shared = this.recorder?.current;
    await this.listener?.drained();
    const attempt = {
      ...prepared.recording,
      state: "running" as const,
      context: shared?.context ?? UNKNOWN_CONTEXT,
      confirmedModel: shared?.confirmedModel ?? {
        value: null,
        source: null,
        reportedAt: null,
      },
      confirmedReasoning: shared?.confirmedReasoning ?? {
        value: null,
        source: null,
        reportedAt: null,
      },
      workspace: await checkSessionWorkspace(
        {
          directory: prepared.input.directory,
          workspace: prepared.input.directory,
        },
        new Date().toISOString(),
      ),
      updatedAt: new Date().toISOString(),
    };
    if (this.recorder) this.recorder.bind(attempt);
    else
      this.recorder = new AgentSessionRecorder(
        { store: this.outbox, journal: new AgentSessionJournal(this.outbox) },
        attempt,
      );
    this.listener ??= new LocalAcpJournalListener(this.recorder, this.journal);
    await this.recorder.drained();
    return { ...prepared.input, journal: this.listener };
  }

  private async bearerFor(launch: LocalSessionLaunch): Promise<string | null> {
    if (launch.mcp === null) return null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new AgentError("plan_mcp_unavailable")),
        BEARER_WAIT_MS,
      );
    });
    try {
      return await Promise.race([this.bearer.promise, expired]);
    } finally {
      clearTimeout(timer);
    }
  }

  private observer(): PlanSessionObserver {
    const emit = (mutation: LocalSessionMutation): void => {
      void this.journal
        .append(mutation)
        .catch((error: unknown) => this.fail(error));
    };
    return {
      started: (details) =>
        emit({
          kind: "started",
          details: { ...details, arguments: [...details.arguments] },
        }),
      identified: (sessionId) => emit({ kind: "identified", sessionId }),
      capabilities: (capabilities) =>
        emit({ kind: "capabilities", capabilities }),
      progressed: (events) =>
        emit({ kind: "progressed", events: events.map(sanitizePlanOutput) }),
      activity: (activity) =>
        emit({
          kind: "activity",
          activity: {
            ...activity,
            titles: activity.titles.map(sanitizePlanOutput),
          },
        }),
    };
  }

  private async observeTurn(
    pending: Promise<PlanSessionTurn>,
    launch: LocalSessionLaunch,
  ): Promise<void> {
    const result = await pending.catch((error: unknown): PlanSessionTurn => ({
      output: "",
      sessionId: null,
      failure: "failed",
      errorCode: error instanceof AgentError ? error.code : "plan_step_failed",
      endedAt: new Date().toISOString(),
      permissionDenials: 0,
      effective: {},
      events: ["native turn failed"],
    }));
    if (this.hasJournalFailure) throw new Error("Native history is incomplete");
    const recorder = this.recorder;
    if (!recorder) throw new Error("Native recorder is unavailable");
    if (result.failure !== null || result.errorCode !== null)
      recorder.note({
        kind: "error",
        text: `turn ${result.failure ?? "failed"}${result.errorCode ? `: ${result.errorCode}` : ""}`,
      });
    recorder.revise({
      ...recorder.current,
      state: nativeTurnState(result),
      updatedAt: new Date().toISOString(),
    });
    await this.listener?.drained();
    await recorder.settled();
    await this.journal.append({
      kind: "turn",
      attemptId: launch.attemptId,
      turnId: launch.turnId,
      result: {
        ...result,
        output: sanitizePlanOutput(result.output),
        events: result.events.map(sanitizePlanOutput),
      },
    });
  }

  private observe(
    pending: Promise<PlanSessionTurn>,
    launch: LocalSessionLaunch,
  ): void {
    this.isTurnPending = true;
    this.observing = this.observeTurn(pending, launch).finally(() => {
      this.isTurnPending = false;
    });
    void this.observing.catch((error: unknown) => this.fail(error));
  }

  private async cancelOnce(): Promise<void> {
    await this.markCancelled();
    await this.close();
  }

  private async markCancelled(): Promise<void> {
    // End native work even if recording the cancellation fails.
    this.controller.abort();
    await writeLocalRecord(path.join(this.manifest.directory, "cancel.json"), {
      requestedAt: new Date().toISOString(),
    });
  }

  private async position(launch: LocalSessionLaunch): Promise<void> {
    this.turns += 1;
    await this.journal.append({
      kind: "position",
      turns: this.turns,
      attemptId: launch.attemptId,
      turnId: launch.turnId,
    });
  }

  private async closeOnce(): Promise<PlanSessionClosed> {
    // Containment must start before any database or journal operation can block it.
    if (this.isTurnPending || (this.opening !== null && this.session === null))
      this.controller.abort();
    const run = await this.dependencies.runs.find(this.launch.runId);
    if (!canContinueLocalTurn(run, this.launch) || this.isTurnPending)
      await this.markCancelled();
    await this.startupReady.promise;
    if (this.stopTimer) clearInterval(this.stopTimer);
    const native =
      this.session ??
      (await this.opening?.catch((error: unknown) => {
        this.canConfirmNoSession = !(
          error instanceof AcpCleanupUnconfirmedError
        );
        return null;
      }));
    const result = native
      ? await native.close()
      : {
          exit: null,
          endedAt: new Date().toISOString(),
          leftovers: 0,
          isConfirmed: this.canConfirmNoSession,
        };
    await this.observing;
    if (this.hasJournalFailure)
      throw new AgentError("plan_history_unavailable");
    if (this.recorder) {
      const current = this.recorder.current;
      this.recorder.revise({
        ...current,
        state:
          current.state === "cancelled" || current.state === "failed"
            ? current.state
            : "ended",
        updatedAt: new Date().toISOString(),
      });
      await this.listener?.drained();
      await this.recorder.settled();
    }
    await this.journal.append({ kind: "closed", result });
    return result;
  }

  private async failureRecorder(): Promise<void> {
    if (this.recorder) return;
    const run = await this.dependencies.runs.find(this.launch.runId);
    const result =
      run &&
      allPlanRunResults(run).find(
        (step) =>
          step.id === this.launch.stepId &&
          step.session?.attemptId === this.launch.attemptId,
      );
    if (!run || !result?.session)
      throw new Error("Failed native attempt is not bound to its run");
    const start = sessionStart(
      {
        run,
        step: { step: { id: result.id }, groupId: result.groupId },
        record: result.session,
      },
      this.launch.instanceId,
    );
    if (!start) throw new Error("Failed native recording is unavailable");
    this.recorder = new AgentSessionRecorder(
      { store: this.outbox, journal: new AgentSessionJournal(this.outbox) },
      {
        ...start,
        state: "failed",
        context: UNKNOWN_CONTEXT,
        confirmedModel: { value: null, source: null, reportedAt: null },
        confirmedReasoning: { value: null, source: null, reportedAt: null },
        workspace: null,
        updatedAt: new Date().toISOString(),
      },
    );
  }

  private async checkStop(): Promise<void> {
    if (this.checkingStop || this.closing) return;
    this.checkingStop = true;
    try {
      const run = await this.dependencies.runs.find(this.launch.runId);
      if (!canContinueLocalTurn(run, this.launch)) await this.cancel();
    } catch (error: unknown) {
      // Database loss does not fabricate a user Stop or terminate a surviving native session.
      logCaughtError("LocalOwnerSession", error);
    } finally {
      this.checkingStop = false;
    }
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function nativeTurnState(result: PlanSessionTurn): AgentSessionState {
  if (result.failure === "cancelled") return "cancelled";
  if (result.failure === null && result.errorCode === null) return "idle";
  return "failed";
}
