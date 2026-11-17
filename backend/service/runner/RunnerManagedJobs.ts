import { createHash } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";

import { AgentError } from "@/backend/error/AgentErrors";
import { AgentPlanRunnerDetachedError } from "@/backend/service/agents/AgentPlanRunnerDetach";

import type { RunnerService } from "./RunnerService";
import type {
  RunnerJob,
  RunnerJobResult,
  RunnerPlanBinding,
} from "@/definition/RunnerProtocol";
import type { RunnerExecution } from "@/definition/RunnerExecution";
import type { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";

/** The API-owned transport also used by the separate plan process. */
export type ManagedRunnerTransport = Pick<
  RunnerService,
  "ready" | "catalog" | "enqueue" | "progress" | "cancel" | "pauseExecution"
>;

interface ManagedJob {
  readonly userId: string;
  readonly connectionId: string;
  readonly binding: RunnerPlanBinding;
  readonly command: RunnerExecution;
  readonly signal: AbortSignal;
  readonly dispatched?: (job: RunnerJob) => Promise<void>;
  readonly progressed?: (job: RunnerJob) => void;
}

/** Tracks runner claims without scanning or signalling processes on the plan host. */
export class RunnerManagedJobs {
  private readonly runners: ManagedRunnerTransport;
  private readonly runs: Pick<AgentPlanRunRepository, "find">;
  private readonly active = new Map<
    string,
    { readonly job: RunnerJob; readonly connectionId: string }
  >();

  public constructor(
    runners: ManagedRunnerTransport,
    runs: Pick<AgentPlanRunRepository, "find">,
  ) {
    this.runners = runners;
    this.runs = runs;
  }

  /** Persists one idempotent claim and waits for its attested terminal outcome. */
  public async run(input: ManagedJob): Promise<RunnerJobResult> {
    input.signal.throwIfAborted();
    const job = await this.runners.enqueue(
      input.userId,
      input.connectionId,
      input.binding,
      input.command,
    );
    this.active.set(job.jobId, { job, connectionId: input.connectionId });
    try {
      await input.dispatched?.(job);
      return await this.observe(input, job);
    } finally {
      this.active.delete(job.jobId);
    }
  }

  /** Observes a persisted claim after scheduler replacement, without dispatching it again. */
  public async reattach(
    reference: {
      readonly connectionId: string;
      readonly attemptId: string;
      readonly jobId: string;
    },
    runId: string,
    signal: AbortSignal,
  ): Promise<RunnerJobResult> {
    const job = await this.runners.progress(
      reference.connectionId,
      runId,
      reference.attemptId,
    );
    if (!job?.plan || !job.execution || job.jobId !== reference.jobId)
      throw new AgentError("plan_context_changed");
    this.active.set(job.jobId, { job, connectionId: reference.connectionId });
    try {
      return await this.observe(
        {
          userId: "",
          connectionId: reference.connectionId,
          binding: job.plan,
          command: job.execution,
          signal,
        },
        job,
      );
    } finally {
      this.active.delete(job.jobId);
    }
  }

  /** Waits for the same acknowledged freeze contract for every active turn and script. */
  public async setRunPaused(runId: string, isPaused: boolean): Promise<void> {
    await Promise.all(
      [...this.active.values()]
        .filter((entry) => entry.job.plan?.runId === runId)
        .map(async (entry) => {
          await this.runners.pauseExecution(
            entry.connectionId,
            entry.job.jobId,
            isPaused,
          );
          await this.confirmPause(entry.connectionId, entry.job, isPaused);
        }),
    );
  }

  private async confirmPause(
    connectionId: string,
    job: RunnerJob,
    isPaused: boolean,
  ): Promise<void> {
    if (!job.plan) throw new AgentError("plan_context_changed");
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const current = await this.runners.progress(
        connectionId,
        job.plan.runId,
        job.plan.attemptId,
      );
      if (
        current &&
        ["completed", "failed", "interrupted", "lost"].includes(current.status)
      )
        return;
      if (isPauseConfirmed(current, isPaused)) return;
      const control = current?.executionControl;
      if (control?.state === "failed" || control?.state === "unavailable")
        break;
      await wait(25);
    }
    throw new AgentError("plan_runner_control_update_required");
  }

  private async observe(
    input: ManagedJob,
    job: RunnerJob,
  ): Promise<RunnerJobResult> {
    let isCancelled = false;
    let isPaused = false;
    for (;;) {
      if (input.signal.reason instanceof AgentPlanRunnerDetachedError)
        throw input.signal.reason;
      if (input.signal.aborted && !isCancelled) {
        await this.runners.cancel(input.connectionId, job.jobId);
        isCancelled = true;
      }
      const current = await this.runners.progress(
        input.connectionId,
        input.binding.runId,
        input.binding.attemptId,
      );
      if (current) input.progressed?.(current);
      const result = current ? managedOutcome(input, current) : null;
      if (result) return result;
      // A worker that vanished without an exit record is lost, never an incomplete turn to retry.
      if (current?.status === "lost") throw new AgentError("plan_runner_lost");
      if (
        current &&
        ["failed", "interrupted", "completed"].includes(current.status)
      )
        throw new AgentError("plan_runner_incomplete");
      const run = await this.runs.find(input.binding.runId);
      if (!run) throw new AgentError("plan_run_unavailable");
      const shouldPause =
        !input.signal.aborted && ["paused", "pausing"].includes(run.status);
      if (shouldPause !== isPaused) {
        await this.runners.pauseExecution(
          input.connectionId,
          job.jobId,
          shouldPause,
        );
        isPaused = shouldPause;
      }
      await wait(50);
    }
  }
}

function managedOutcome(
  input: ManagedJob,
  job: RunnerJob,
): RunnerJobResult | null {
  if (job.outcome) {
    requireManagedOutcome(input.command, job.outcome);
    if (
      input.binding.recordingAttemptId &&
      job.liveHistoryVersion === 1 &&
      job.historyLength === undefined
    )
      throw new AgentError("plan_runner_incomplete");
    return {
      ...job.outcome,
      historyLength: job.historyLength ?? job.historyCursor ?? 0,
    };
  }
  if (!job.cancellation?.completedAt || !job.cancellation.closeout) return null;
  return {
    output: null,
    exitCode: null,
    signal: null,
    reason: "cancelled",
    closeout: job.cancellation.closeout,
  };
}

function requireManagedOutcome(
  command: RunnerExecution,
  result: RunnerJobResult,
): void {
  if (
    result.exitCode !== 0 ||
    result.reason ||
    result.closeout !== "confirmed" ||
    command.program.kind !== "cli"
  )
    return;
  const terminal = result.terminal;
  if (
    !terminal ||
    terminal.status !== "completed" ||
    !terminal.sessionId ||
    terminal.provider !== command.program.route.tool ||
    terminal.answerDigest !==
      createHash("sha256")
        .update(result.output ?? "")
        .digest("hex")
  )
    throw new AgentError("plan_runner_incomplete");
}

function isPauseConfirmed(
  current: RunnerJob | undefined,
  isPaused: boolean,
): boolean {
  const control = current?.executionControl;
  return Boolean(
    control &&
    control.requestedAt === current?.executionPauseRequestedAt &&
    control.isPaused === isPaused &&
    [isPaused ? "frozen" : "thawed", "terminated"].includes(control.state),
  );
}
