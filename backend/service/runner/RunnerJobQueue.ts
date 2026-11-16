import { AgentError } from "@/backend/error/AgentErrors";
import {
  runnerExecutionSchema,
  type RunnerExecution,
} from "@/definition/RunnerExecution";
import { runnerPlanBindingSchema } from "@/definition/RunnerProtocol";

import { LOCAL_RUNNER_CONNECTION_ID } from "./LocalRunnerIdentity";
import { queuedRunnerJob, repeatedRunnerJob } from "./RunnerServiceSupport";

import type { RunnerStore } from "./RunnerServiceSupport";
import type { SerialQueue } from "@/backend/concurrency/SerialQueue";
import type { RunnerRecord } from "@/backend/database/repositories/runner/RunnerRepository";
import type { RunnerPlanEventService } from "./RunnerPlanEventService";
import type {
  RunnerJob,
  RunnerPlanBinding,
  RunnerState,
} from "@/definition/RunnerProtocol";

interface RunnerJobQueueContext {
  readonly repository: RunnerStore;
  readonly events?: RunnerPlanEventService;
  readonly writes: SerialQueue;
  readonly requireUsable: (
    userId: string,
    connectionId: string,
  ) => Promise<unknown>;
  readonly requireRevision: (record: RunnerRecord) => Promise<void>;
  readonly checkOutput: (
    record: RunnerRecord,
    execution: RunnerExecution | undefined,
  ) => void;
  readonly dispatch: (
    connectionId: string,
    job: RunnerJob,
    state?: RunnerState,
  ) => void;
  readonly observe: (connectionId: string, jobs: readonly RunnerJob[]) => void;
  readonly hasLiveHistory: (connectionId: string) => boolean;
}

interface QueueRequest {
  readonly userId: string;
  readonly connectionId: string;
  readonly plan?: RunnerPlanBinding;
  readonly execution?: RunnerExecution;
  readonly allowTerminalRerun?: boolean;
}

/** Records and dispatches runner jobs under the existing serial write queue. */
export class RunnerJobQueue {
  private readonly context: RunnerJobQueueContext;

  public constructor(context: RunnerJobQueueContext) {
    this.context = context;
  }

  /** Records a job before dispatch; callers retain its ID instead of resubmitting after a loss. */
  public async enqueue(
    userId: string,
    connectionId: string,
    plan?: RunnerPlanBinding,
    execution?: RunnerExecution,
  ): Promise<RunnerJob> {
    return this.write({ userId, connectionId, plan, execution });
  }

  /** Follows a finished job of the same frozen attempt with one explicitly requested retry job. */
  public async enqueueRetry(
    userId: string,
    connectionId: string,
    plan: RunnerPlanBinding,
    execution: RunnerExecution,
  ): Promise<RunnerJob> {
    return this.write({
      userId,
      connectionId,
      plan,
      execution,
      allowTerminalRerun: true,
    });
  }

  private async write(input: QueueRequest): Promise<RunnerJob> {
    const { userId, connectionId, plan, execution } = input;
    if (execution) runnerExecutionSchema.parse(execution);
    if (Buffer.byteLength(JSON.stringify(execution) ?? "", "utf8") > 1_000_000)
      throw new Error("Runner command exceeds transport budget");
    const binding = plan ? runnerPlanBindingSchema.parse(plan) : undefined;
    await this.context.requireUsable(userId, connectionId);
    return this.context.writes.run(async () => {
      const record = await this.context.repository.find(connectionId);
      if (!record) throw new Error("Runner queue unavailable");
      await this.context.requireRevision(record);
      const previous = await this.previousJob(record, input, binding);
      if (previous) return previous;
      return this.dispatch(record, binding, execution);
    });
  }

  private async previousJob(
    record: RunnerRecord,
    input: QueueRequest,
    binding: RunnerPlanBinding | undefined,
  ): Promise<RunnerJob | undefined> {
    if (!binding) return undefined;
    const { events } = this.context;
    if (!events) throw new Error("Runner plan binding unavailable");
    await events.authorizeBinding(input.userId, input.connectionId, binding);
    const archived = binding.managed
      ? await this.context.repository.archivedAttempt?.(
          input.connectionId,
          binding.runId,
          binding.attemptId,
        )
      : undefined;
    if (archived && !input.allowTerminalRerun)
      return repeatedRunnerJob(
        { ...record, state: { ...record.state, jobs: [archived] } },
        binding,
        input.execution,
      );
    return repeatedRunnerJob(
      record,
      binding,
      input.execution,
      input.allowTerminalRerun === true,
    );
  }

  private async dispatch(
    record: RunnerRecord,
    binding: RunnerPlanBinding | undefined,
    execution: RunnerExecution | undefined,
  ): Promise<RunnerJob> {
    const { connectionId } = record;
    this.context.checkOutput(record, execution);
    requireDispatchVersions(record, execution);
    requireDispatchTarget(record, execution);
    requireDispatchCapabilities(record, execution);
    const terminal = record.state.jobs.filter(canRetireManagedJob);
    const retired = new Set(
      terminal
        .slice(0, Math.max(0, terminal.length - 8))
        .map((job) => job.jobId),
    );
    const retained = record.state.jobs.filter((job) => !retired.has(job.jobId));
    if (retained.length >= 1000) throw new Error("Runner queue unavailable");
    const job = queuedRunnerJob({
      sessionId: record.state.sessionId,
      binding,
      execution,
      hasLiveHistory: this.context.hasLiveHistory(connectionId),
    });
    job.canFreezeExecution =
      record.state.executionControlVersion === 1 &&
      record.state.cgroupVersion === 1;
    const jobs = [...retained, job];
    await this.context.repository.checkpoint(
      connectionId,
      { ...record.state, jobs },
      async (transaction) => {
        if (!binding) return;
        await this.context.events?.requireDispatchFence(transaction, binding);
        await this.context.events?.bindManaged(transaction, connectionId, job);
      },
    );
    this.context.dispatch(
      connectionId,
      job,
      retired.size ? { ...record.state, jobs } : undefined,
    );
    this.context.observe(connectionId, jobs);
    return job;
  }
}

function canRetireManagedJob(job: RunnerJob): boolean {
  return (
    job.plan?.managed === true &&
    ["completed", "failed", "interrupted", "lost"].includes(job.status) &&
    (job.outcome?.closeout === "confirmed" ||
      job.cancellation?.closeout === "confirmed") &&
    (job.historyCursor ?? 0) >= (job.historyLength ?? 0)
  );
}

function requireDispatchVersions(
  record: RunnerRecord,
  execution: RunnerExecution | undefined,
): void {
  if (execution?.managed && record.state.managedExecutionVersion !== 1)
    throw new AgentError("plan_runner_update_required");
  if (execution && record.state.planControlVersion !== 1)
    throw new AgentError("plan_runner_control_update_required");
}

function requireDispatchTarget(
  record: RunnerRecord,
  execution: RunnerExecution | undefined,
): void {
  if (
    execution?.program.kind === "cli" &&
    execution.program.access === "full_environment" &&
    record.connectionId !== LOCAL_RUNNER_CONNECTION_ID
  )
    throw new AgentError("plan_full_environment_local_only");
  if (
    execution?.program.kind === "cli" &&
    execution.program.route.accountId &&
    execution.agentAccount?.id !== execution.program.route.accountId
  )
    throw new AgentError("plan_context_changed");
}

function requireDispatchCapabilities(
  record: RunnerRecord,
  execution: RunnerExecution | undefined,
): void {
  if (execution?.agentAccount && record.state.agentAccountsVersion !== 1)
    throw new AgentError("plan_runner_update_required");
  if (execution?.browser && record.state.browserVersion !== 1)
    throw new AgentError("plan_runner_update_required");
  if (execution?.progressVersion && record.state.progressVersion !== 1)
    throw new AgentError("plan_runner_update_required");
}
