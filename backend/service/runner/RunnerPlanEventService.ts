import { AgentError } from "@/backend/error/AgentErrors";
import { logEvent } from "@/backend/logging/Logger";
import { requirePlanModelResources } from "@/backend/service/agents/AgentPlanModel";
import { planContentDigest } from "@/backend/agents/AgentPlanContentDigest";
import { applyRunnerPlanEvent } from "./RunnerPlanEvents";
import { isTerminalHistory } from "./RunnerProtocol";
import type { AgentPlanAccess } from "@/backend/service/agents/AgentPlanAccess";
import type { AgentProfileService } from "@/backend/service/agents/AgentProfileService";
import type { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import type { AgentPlanRemoteTargets } from "@/backend/service/agents/AgentPlanRemoteTargets";
import type { RunnerPlanBinding } from "@/definition/RunnerProtocol";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { DatabaseTransaction } from "@/backend/database/Database";
import type { RunnerPlanEventRepository } from "@/backend/database/repositories/runner/RunnerPlanEventRepository";
import type {
  RunnerJob,
  RunnerMessage,
  RunnerReply,
  RunnerState,
} from "@/definition/RunnerProtocol";

interface BindingAccess {
  readonly plans: AgentPlanAccess;
  readonly profiles: AgentProfileService;
  readonly runs: AgentPlanRunRepository;
  readonly targets: AgentPlanRemoteTargets;
}

function requireDispatchRun(
  run: AgentPlanRun | null,
  context: {
    readonly canEdit: boolean;
    readonly userId: string;
    readonly binding: RunnerPlanBinding;
  },
): AgentPlanRun {
  const { binding } = context;
  if (
    !context.canEdit ||
    !run ||
    run.userId !== context.userId ||
    run.planId !== binding.planId ||
    run.planRevision !== binding.planRevision ||
    (run.status !== "running" && run.status !== "pausing")
  )
    throw new AgentError("plan_access_denied");
  return run;
}

function isHistoryPacket(
  previous: RunnerState,
  message: RunnerMessage,
): boolean {
  if (message.type !== "event") return false;
  const job = previous.jobs.find((entry) => entry.jobId === message.job.jobId);
  return job !== undefined && isTerminalHistory(job, message);
}

/** Coordinates durable receipts and plan projections inside the runner checkpoint transaction. */
export class RunnerPlanEventService {
  private readonly repository: RunnerPlanEventRepository;
  private readonly access: BindingAccess;
  private isRunOwned: (runId: string) => boolean;
  public constructor(
    repository: RunnerPlanEventRepository,
    access: BindingAccess,
  ) {
    this.access = access;
    this.repository = repository;
    // Until the plan engine attaches, every run counts as owned and never settles here.
    this.isRunOwned = () => true;
  }

  /**
   * Lets runner facts settle a stopped run that no engine of this process owns.
   *
   * @param isOwned - Whether the plan engine of this process still drives the run.
   */
  public attachRunOwnership(isOwned: (runId: string) => boolean): void {
    this.isRunOwned = isOwned;
  }

  /** Authorizes a durable job binding; it queues metadata only and never dispatches execution. */
  public async authorizeBinding(
    userId: string,
    connectionId: string,
    binding: RunnerPlanBinding,
  ): Promise<void> {
    const plan = await this.access.plans.require(userId, binding.planId);
    const run = requireDispatchRun(await this.access.runs.find(binding.runId), {
      canEdit: plan.canEdit,
      userId,
      binding,
    });
    const step = run.steps.find((entry) => entry.id === binding.stepId);
    const execution = step?.execution;
    if (
      !execution ||
      step?.status !== "running" ||
      execution.attemptId !== binding.attemptId ||
      execution.target.kind !== "remote" ||
      execution.target.connectionId !== connectionId
    )
      throw new AgentError("plan_context_changed");
    const target = execution.target;
    const choices = await this.access.targets.list(userId, plan.projectId);
    if (
      !choices.some(
        (entry) =>
          entry.workspaceId === target.workspaceId &&
          entry.workspaceRevision === target.workspaceRevision &&
          entry.connectionId === connectionId &&
          entry.connectionRevision === target.connectionRevision &&
          entry.path === target.path,
      )
    )
      throw new AgentError("plan_context_changed");
    if (
      execution.modelAccess.provider === "script" ||
      execution.modelAccess.connectionId === null
    )
      return;
    await requirePlanModelResources(
      this.access.profiles,
      userId,
      await this.access.runs.resources(run.id),
    );
  }

  /** Confirms an identical historical event without applying it a second time. */
  public async replay(
    connectionId: string,
    state: RunnerState,
    message: RunnerMessage,
  ): Promise<RunnerReply | null> {
    if (message.type !== "event") return null;
    const receipt = await this.repository.receipt(message.eventId);
    if (!receipt) return null;
    if (
      receipt.connectionId !== connectionId ||
      receipt.sessionId !== message.sessionId ||
      message.sessionId !== state.sessionId ||
      receipt.sequence !== message.sequence ||
      message.sequence > state.sequence ||
      receipt.digest !== planContentDigest(message)
    )
      throw new Error("Conflicting runner event");
    return {
      version: 1,
      type: "ack",
      eventId: message.eventId,
      sequence: message.sequence,
    };
  }

  /** Shares one commit for the receipt, all affected run steps, and the runner state. */
  public async apply(
    transaction: DatabaseTransaction,
    connectionId: string,
    input: {
      readonly previous: RunnerState;
      readonly state: RunnerState;
      readonly message: RunnerMessage;
    },
  ): Promise<void> {
    const { message, previous, state } = input;
    const history = message.type === "event" ? (message.history ?? []) : [];
    if (message.type === "event")
      await this.repository.append(transaction, connectionId, {
        event: message,
        digest: planContentDigest(message),
      });
    for (const job of state.jobs) {
      if (message.type === "event" && job.jobId !== message.job.jobId) continue;
      if (
        !job.plan ||
        (message.type !== "event" &&
          previous.jobs.find((entry) => entry.jobId === job.jobId)?.status ===
            job.status)
      )
        continue;
      if (isHistoryPacket(previous, message)) {
        await this.repository.appendHistory(transaction, job, history);
        continue;
      }
      const binding = job.plan;
      await this.repository.apply(
        transaction,
        binding.runId,
        (run, snapshot) => {
          const result = applyRunnerPlanEvent(
            {
              connectionId,
              job,
              isDetached: !this.isRunOwned(binding.runId),
              ...(message.type === "event" ? { event: message } : {}),
            },
            run,
            snapshot,
          );
          if (result.isSettled) logSettledStepFact(connectionId, job);
          return result;
        },
        message.type === "event" && job.liveHistoryVersion === 1
          ? { stepId: binding.stepId, events: history }
          : undefined,
      );
    }
  }
}

function logSettledStepFact(connectionId: string, job: RunnerJob): void {
  logEvent({
    level: "warn",
    event: "runner.plan_event.settled_step",
    component: "RunnerPlanEventService",
    message:
      "Runner fact for an already settled plan step acknowledged without changing the plan",
    metadata: {
      reason: "plan_step_settled",
      connectionId,
      jobId: job.jobId,
      runnerSessionId: job.sessionId,
      runId: job.plan?.runId,
      stepId: job.plan?.stepId,
      attemptId: job.plan?.attemptId,
      status: job.status,
    },
  });
}
