import { AgentError } from "@/backend/error/AgentErrors";
import {
  runnerExecutionSchema,
  type RunnerExecution,
} from "@/definition/RunnerExecution";
import { runnerPlanBindingSchema } from "@/definition/RunnerProtocol";

import { queuedRunnerJob, repeatedRunnerJob } from "./RunnerServiceSupport";
import type { RunnerStore } from "./RunnerServiceSupport";

import type { SerialQueue } from "@/backend/concurrency/SerialQueue";
import type { RunnerRecord } from "@/backend/database/repositories/runner/RunnerRepository";
import type { RunnerPlanEventService } from "./RunnerPlanEventService";
import type { RunnerJob, RunnerPlanBinding } from "@/definition/RunnerProtocol";

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
  readonly dispatch: (connectionId: string, job: RunnerJob) => void;
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
    if (execution && record.state.planControlVersion !== 1)
      throw new AgentError("plan_runner_control_update_required");
    this.context.checkOutput(record, execution);
    if (record.state.jobs.length >= 1000)
      throw new Error("Runner queue unavailable");
    const job = queuedRunnerJob({
      sessionId: record.state.sessionId,
      binding,
      execution,
      hasLiveHistory: this.context.hasLiveHistory(connectionId),
    });
    const jobs = [...record.state.jobs, job];
    await this.context.repository.checkpoint(
      connectionId,
      { ...record.state, jobs },
      (transaction) =>
        binding
          ? (this.context.events?.requireDispatchFence(transaction, binding) ??
            Promise.resolve())
          : Promise.resolve(),
    );
    this.context.dispatch(connectionId, job);
    this.context.observe(connectionId, jobs);
    return job;
  }
}
