import { allPlanRunResults } from "@/definition/AgentPlanLoopResults";
import { isRemoteCloseoutUnconfirmed } from "@/definition/AgentPlanRemoteCloseout";
import { AgentPlanValidationError } from "@/backend/error/AgentPlanValidationError";
import { planTargetIssues } from "@/definition/AgentPlanTarget";
import { allPlanSteps } from "@/definition/AgentPlanGroup";
import { withInheritedPlanTarget } from "@/definition/AgentPlanTarget";
import { AgentError } from "@/backend/error/AgentErrors";
import { planContentDigest } from "@/backend/agents/AgentPlanContentDigest";
import {
  RUNNER_TOOL_PROVIDERS,
  runnerExecutionSchema,
} from "@/definition/RunnerExecution";

import {
  remoteTextInputs,
  remoteScriptCommand,
  remoteModelCommand,
  remotePlanContract,
} from "./AgentPlanRemoteCommand";
import { validateRemoteParameterPrompt } from "./AgentPlanRemoteParameters";
import {
  requireRemoteResultPayload,
  resolvedRemoteCommand,
} from "./AgentPlanRemoteResolvedCommand";
import { AgentPlanRemoteSources } from "./AgentPlanRemoteSources";
import { remoteTodoChecklists } from "./AgentPlanRemoteChecklist";
import { isOriginalRemoteJob } from "./AgentPlanRemoteCancellation";
import {
  settleRemoteAcceptance,
  requiresRemoteAcceptance,
} from "./AgentPlanRemoteAcceptance";

import type {
  AgentPlanRemoteParameters,
  RemotePlanParameters,
} from "./AgentPlanRemoteParameters";
import type { RunnerPagesAccessService } from "@/backend/service/runner/RunnerPagesAccessService";
import type { AgentPlanRemoteStatus } from "@/definition/AgentPlanTarget";
import type { AgentPlanRunResources } from "@/backend/agents/AgentPlanRunResources";
import type { AgentPlanInput } from "@/definition/AgentPlan";
import type { ActivePlanRun } from "./AgentPlanRunState";
import type {
  AgentPlan,
  AgentPlanStep,
  AgentPlanRun,
  AgentPlanStepResult,
} from "@/definition/AgentPlan";
import type {
  AgentPlanScript,
  AgentPlanInterpreter,
} from "@/definition/AgentPlanScript";
import type { AgentPlanRemoteTarget } from "@/definition/AgentPlanExecution";
import type { RunnerExecution } from "@/definition/RunnerExecution";
import type { RunnerJob } from "@/definition/RunnerProtocol";
import type { PageAgentModel } from "@/definition/PageAgent";
import type { AgentPlanTaskSnapshot } from "./AgentPlanBindings";
import type { AgentPlanContract } from "@/definition/AgentPlanSession";
import type { AgentPlanRemoteTargets } from "./AgentPlanRemoteTargets";
import type { AgentPlanAccess } from "./AgentPlanAccess";
import type { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import type { RunnerService } from "@/backend/service/runner/RunnerService";
import type { RunnerOpenRouterService } from "@/backend/service/runner/RunnerOpenRouterService";
import type {
  AgentPlanTasks,
  AgentPlanTicketChecklist,
} from "./AgentPlanTasks";

const OBSERVATION_STALE_MILLISECONDS = 45_000;

const CANCELLED_BEFORE_DISPATCH: Partial<AgentPlanStepResult> = {
  status: "cancelled",
  cancellation: "not_started",
  output: null,
  error: null,
};

/** Private snapshot: exact command, source inputs and authorized target, without credentials. */
export interface RemotePlanStep {
  readonly step: AgentPlanStep | AgentPlanScript;
  readonly target: AgentPlanRemoteTarget;
  readonly command: RunnerExecution;
  readonly inputs: Readonly<Record<string, string>>;
  readonly parameters?: RemotePlanParameters;
  /** The exact prompt contract for a remote OpenCode acceptance check. */
  readonly acceptanceContract?: AgentPlanContract;
}

interface RemoteExecutionDependencies {
  readonly tasks?: Pick<AgentPlanTasks, "checklist">;
  readonly parameters?: AgentPlanRemoteParameters;
  readonly pages?: RunnerPagesAccessService;
  readonly targets: Pick<AgentPlanRemoteTargets, "list" | "choices">;
  readonly access: Pick<AgentPlanAccess, "require">;
  readonly runners: Pick<
    RunnerService,
    | "availability"
    | "catalog"
    | "supportsPagesAccess"
    | "supportsOpenCode"
    | "supportsExactResultPayload"
    | "supportsAssetFiles"
    | "ready"
    | "enqueue"
    | "cancel"
    | "progress"
    | "historyPending"
    | "contact"
  >;
  readonly provider: Pick<RunnerOpenRouterService, "catalog">;
  readonly runs: Pick<AgentPlanRunRepository, "find">;
}

interface RemoteClaim {
  readonly run: AgentPlanRun;
  readonly remote: RemotePlanStep;
  readonly command: RunnerExecution;
  readonly attemptId: string;
  readonly signal: AbortSignal;
}

/** Authorizes runner catalogs and dispatches immutable claims; nothing executes on Pages. */
export class AgentPlanRemoteExecution {
  private readonly dependencies: RemoteExecutionDependencies;

  public constructor(dependencies: RemoteExecutionDependencies) {
    this.dependencies = dependencies;
  }

  /** Offers only models and interpreter identities from an executing, authorized runner. */
  public async sources(
    userId: string,
    projectId: string,
    workspaceIds?: readonly string[],
  ): Promise<{
    readonly models: readonly PageAgentModel[];
    readonly interpreters: readonly AgentPlanInterpreter[];
    readonly statuses: readonly AgentPlanRemoteStatus[];
  }> {
    return new AgentPlanRemoteSources(this.dependencies).read(
      userId,
      projectId,
      workspaceIds,
    );
  }

  /** Verifies exact catalog selection and current workspace access before saving a model copy. */
  public async validateModel(
    userId: string,
    plan: Pick<AgentPlan, "projectId">,
    step: AgentPlanStep,
  ): Promise<void> {
    const route = requireRemoteModelRoute(step);
    const { models, statuses } = await this.sources(userId, plan.projectId, [
      route.workspaceId,
    ]);
    const issues = planTargetIssues(
      {
        name: "",
        workspaceId: route.workspaceId,
        usage: "private",
        projectId: plan.projectId,
        nodes: [step],
        edges: [],
        globals: {},
      },
      statuses,
    );
    if (issues.length)
      throw new AgentPlanValidationError(
        issues.map((issue) => ({
          nodeId: issue.nodeId,
          port: issue.port ?? null,
          reason: issue.problem,
        })),
      );
    if (
      !models.some(
        (model) =>
          model.id === step.configuration?.modelProfileId &&
          model.model === step.configuration.model &&
          (step.configuration.reasoningEffort === null ||
            model.reasoningEfforts.includes(
              step.configuration.reasoningEffort,
            )) &&
          planContentDigest(model.runnerRoute) === planContentDigest(route),
      )
    )
      throw new AgentError("plan_remote_unavailable");
  }

  /** Freezes source and text parameters at the plan revision before a job can be claimed. */
  public async prepare(
    userId: string,
    plan: AgentPlan,
    step: AgentPlanStep | AgentPlanScript,
    tasks: readonly AgentPlanTaskSnapshot[],
  ): Promise<RemotePlanStep> {
    const target = await this.target(userId, plan, step);
    const interpreters = await this.dependencies.runners
      .ready(userId, target.connectionId)
      .catch(() => {
        throw new AgentError("plan_remote_unavailable");
      });
    let command: RunnerExecution;
    let acceptanceContract: AgentPlanContract | undefined;
    const parameters = await this.prepareParameters(userId, {
      plan,
      step,
      tasks,
      target,
    });
    const inputs = parameters
      ? Object.fromEntries(
          Object.entries(parameters.values).flatMap(([name, bound]) =>
            bound?.type === "text" ? [[name, bound.text]] : [],
          ),
        )
      : remoteTextInputs(plan, step, tasks);
    const basis = {
      version: 1 as const,
      revision: plan.revision,
      workspace: target.path,
      outputBytes: 65536,
      ...(this.canUsePages(step, target) ? { pagesAccess: 1 as const } : {}),
      input: JSON.stringify(inputs),
    };
    if (step.type === "script")
      command = remoteScriptCommand(step, target, interpreters, basis);
    else {
      await this.validateModel(userId, plan, step);
      const tickets = await remoteTodoChecklists({
        step,
        parameters,
        tasks: this.dependencies.tasks,
        userId,
        projectId: plan.projectId,
      });
      command = remoteModelCommand(step, basis, tickets);
      acceptanceContract = remoteAcceptanceContract(step, command, tickets);
      requireRemoteResultPayload(command, () =>
        this.dependencies.runners.supportsExactResultPayload(
          target.connectionId,
        ),
      );
      if (parameters && command.program.kind !== "script")
        await validateRemoteParameterPrompt(
          step,
          parameters,
          command.program.prompt,
        );
      if (
        parameters?.assets.length &&
        !this.dependencies.runners.supportsAssetFiles(target.connectionId)
      )
        throw new AgentPlanValidationError([
          { nodeId: step.id, port: null, reason: "remoteAssetRunner" },
        ]);
      if (parameters?.resources.length && command.pagesAccess !== 1)
        throw new AgentError("plan_mcp_unavailable");
    }
    return {
      step,
      target,
      command: runnerExecutionSchema.parse(command),
      inputs,
      ...(parameters ? { parameters } : {}),
      ...(acceptanceContract ? { acceptanceContract } : {}),
    };
  }

  /** Returns the terminal durable projection; reconnects retain the original attempt and launch. */
  public async run(
    run: AgentPlanRun,
    remote: RemotePlanStep,
    signal: AbortSignal,
  ): Promise<Partial<AgentPlanStepResult>> {
    if (signal.aborted) return CANCELLED_BEFORE_DISPATCH;
    const target = await this.target(
      run.userId,
      {
        projectId: (
          await this.dependencies.access.require(run.userId, run.planId)
        ).projectId,
      },
      remote.step,
    );
    if (planContentDigest(target) !== planContentDigest(remote.target))
      throw new AgentError("plan_context_changed");
    const execution = run.steps.find(
      (entry) => entry.id === remote.step.id,
    )?.execution;
    if (!execution) throw new AgentError("plan_context_changed");
    await this.dependencies.runners.ready(run.userId, target.connectionId);
    if (remote.step.type === "agent")
      await this.validateModel(
        run.userId,
        {
          projectId: (
            await this.dependencies.access.require(run.userId, run.planId)
          ).projectId,
        },
        remote.step,
      );
    if (remote.parameters)
      await this.dependencies.parameters?.authorize(
        run.userId,
        remote.parameters,
        {
          projectId: (
            await this.dependencies.access.require(run.userId, run.planId)
          ).projectId,
          target: remote.target,
        },
      );
    const command = await resolvedRemoteCommand(run, remote);
    requireRemoteResultPayload(command, () =>
      this.dependencies.runners.supportsExactResultPayload(target.connectionId),
    );
    let result: Partial<AgentPlanStepResult>;
    try {
      await this.dependencies.pages?.open(run, remote, execution.attemptId);
      const job = await this.claim({
        run,
        remote,
        command,
        attemptId: execution.attemptId,
        signal,
      });
      if (!job) return CANCELLED_BEFORE_DISPATCH;
      result = await this.waitForJob(run, remote, job, signal);
    } finally {
      await this.dependencies.pages?.close(
        run.id,
        remote.step.id,
        execution.attemptId,
      );
    }
    // Closeout changes persisted access metadata; continuation compares the exact durable view.
    const current = await this.dependencies.runs.find(run.id);
    const completed = completedGatedRemote(
      remote,
      current?.steps.find((step) => step.id === remote.step.id) ?? result,
    );
    return settleRemoteAcceptance({
      remote,
      run,
      result: completed,
      tasks: this.dependencies.tasks,
      projectId: async () =>
        (await this.dependencies.access.require(run.userId, run.planId))
          .projectId,
    });
  }

  /** Rechecks remote resource access before disclosing historical output, without requiring online status. */
  public async requireRead(
    userId: string,
    resources: AgentPlanRunResources,
  ): Promise<void> {
    if (!resources.remoteWorkspaceIds?.length) return;
    const targets = await this.dependencies.targets.list(
      userId,
      resources.projectId,
    );
    if (
      resources.remoteWorkspaceIds.some(
        (id) => !targets.some((target) => target.workspaceId === id),
      )
    )
      throw new AgentError("plan_access_denied");
  }

  /** Replays an authorized owner's stop against every original remote attempt, even after reload or restart. */
  public async stop(run: AgentPlanRun): Promise<void> {
    for (const step of allPlanRunResults(run)) {
      const execution = step.execution;
      if (
        execution?.target.kind !== "remote" ||
        !isRemoteCloseoutUnconfirmed(step)
      )
        continue;
      const job = await this.dependencies.runners.progress(
        execution.target.connectionId,
        run.id,
        execution.attemptId,
      );
      if (isOriginalRemoteJob(run, step, job))
        await this.dependencies.runners.cancel(
          execution.target.connectionId,
          job.jobId,
        );
    }
  }

  /** Adds current transport health to confirmed job facts without mutating the stored execution state. */
  public async withProgress(run: AgentPlanRun): Promise<AgentPlanRun> {
    const steps = await Promise.all(
      run.steps.map(async (step) => {
        const execution = step.execution;
        if (execution?.target.kind !== "remote") return step;
        const job = await this.dependencies.runners.progress(
          execution.target.connectionId,
          run.id,
          execution.attemptId,
        );
        if (!job) return step;
        return {
          ...step,
          remote: {
            ...step.remote,
            jobId: job.jobId,
            sessionId: job.sessionId,
            status: job.status,
            cancellation: job.cancellation,
            queueReason: job.queueReason,
            historyPending: await this.dependencies.runners.historyPending(
              job.jobId,
            ),
            observedAt: job.observedAt,
            isObservationStale: isObservationStale(job),
            startedAt: step.remote?.startedAt ?? null,
            endedAt: step.remote?.endedAt ?? null,
            closeout: step.remote?.closeout ?? ("pending" as const),
            contact: this.dependencies.runners.contact(
              execution.target.connectionId,
            ),
          },
        };
      }),
    );
    return { ...run, steps };
  }

  private canUsePages(
    step: AgentPlanStep | AgentPlanScript,
    target: AgentPlanRemoteTarget,
  ): boolean {
    return (
      step.type === "agent" &&
      Boolean(step.configuration?.runnerRoute) &&
      Boolean(this.dependencies.pages) &&
      this.dependencies.runners.supportsPagesAccess(target.connectionId)
    );
  }

  private async prepareParameters(
    userId: string,
    input: {
      readonly plan: AgentPlan;
      readonly step: AgentPlanStep | AgentPlanScript;
      readonly tasks: readonly AgentPlanTaskSnapshot[];
      readonly target: AgentPlanRemoteTarget;
    },
  ): Promise<RemotePlanParameters | undefined> {
    if (input.step.type !== "agent" || !this.dependencies.parameters)
      return undefined;
    return this.dependencies.parameters.prepare(userId, {
      ...input,
      step: input.step,
    });
  }

  private async waitForJob(
    run: AgentPlanRun,
    remote: RemotePlanStep,
    job: RunnerJob,
    signal: AbortSignal,
  ): Promise<Partial<AgentPlanStepResult>> {
    for (;;) {
      if (signal.aborted)
        await this.dependencies.runners.cancel(
          remote.target.connectionId,
          job.jobId,
        );
      const current = await this.dependencies.runs.find(run.id);
      const step = current?.steps.find((entry) => entry.id === remote.step.id);
      if (!step) throw new AgentError("plan_context_changed");
      if (
        remote.step.type === "agent" &&
        (remote.step.completionGate || requiresRemoteAcceptance(remote)) &&
        step.remote?.status === "completed"
      )
        return completedGatedRemote(remote, step);
      if (step.remote && step.status !== "running" && step.status !== "waiting")
        return step;
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
    }
  }

  private async claim({
    run,
    remote,
    command,
    attemptId,
    signal,
  }: RemoteClaim): Promise<RunnerJob | null> {
    if (signal.aborted) return null;
    try {
      return await this.dependencies.runners.enqueue(
        run.userId,
        remote.target.connectionId,
        {
          planId: run.planId,
          runId: run.id,
          stepId: remote.step.id,
          attemptId,
          planRevision: run.planRevision,
        },
        command,
      );
    } catch (error: unknown) {
      // Authorization refuses a stopped run before a durable claim exists.
      if (signal.aborted && error instanceof AgentError) return null;
      throw error;
    }
  }

  private async target(
    userId: string,
    plan: Pick<AgentPlan, "projectId">,
    step: AgentPlanStep | AgentPlanScript,
  ): Promise<AgentPlanRemoteTarget> {
    const selected = step.executionTarget;
    if (selected?.kind !== "remote")
      throw new AgentError("plan_context_changed");
    const target = (
      await this.dependencies.targets.list(userId, plan.projectId)
    ).find((entry) => entry.workspaceId === selected.workspaceId);
    if (!target) throw new AgentError("plan_access_denied");
    return target;
  }
}

/** Captures only the acceptance contract that must be checked before remote OpenCode succeeds. */
function remoteAcceptanceContract(
  step: AgentPlanStep,
  command: RunnerExecution,
  tickets: readonly AgentPlanTicketChecklist[],
): AgentPlanContract | undefined {
  return command.program.kind === "cli" &&
    command.program.route.tool === "opencode"
    ? remotePlanContract(step, tickets)
    : undefined;
}

/** Only the engine may turn this provisional runner result into accepted, checkpointed success. */
function completedGatedRemote(
  remote: RemotePlanStep,
  step: Partial<AgentPlanStepResult>,
): Partial<AgentPlanStepResult> {
  if (
    remote.step.type !== "agent" ||
    (!remote.step.completionGate && !requiresRemoteAcceptance(remote)) ||
    step.status !== "running" ||
    step.remote?.status !== "completed"
  )
    return step;
  return {
    ...step,
    status: "succeeded",
    ...(step.session ? { session: { ...step.session, resultCode: 0 } } : {}),
  };
}

/** The runner confirms a quiet worker every 15 to 30 seconds; 45 seconds without it leave the process state unknown. */
function isObservationStale(job: RunnerJob): boolean {
  if (job.status !== "accepted" && job.status !== "running") return false;
  const observedAt = Date.parse(job.observedAt ?? "");
  return (
    !Number.isFinite(observedAt) ||
    Date.now() - observedAt > OBSERVATION_STALE_MILLISECONDS
  );
}

/** Dispatches every explicit remote selection through the same contract, or refuses it. */
export function dispatchRemotePlanStep(
  service: AgentPlanRemoteExecution | undefined,
  active: ActivePlanRun,
  stepId: string,
  signal: AbortSignal,
): Promise<Partial<AgentPlanStepResult>> | null {
  const remote = active.snapshot.remoteSteps?.find(
    (entry) => entry.step.id === stepId,
  );
  if (!remote) {
    const local = active.snapshot.steps.find(
      (entry) => entry.step.id === stepId,
    );
    if (local?.remoteTarget || local?.step.executionTarget?.kind === "remote")
      throw new AgentError("plan_remote_unavailable");
    return null;
  }
  if (!service) throw new AgentError("plan_remote_unavailable");
  if (signal.aborted) return Promise.resolve(CANCELLED_BEFORE_DISPATCH);
  if (active.view.status !== "running")
    return Promise.resolve({ status: "paused" });
  active.dispatched.add(stepId);
  return service.run(active.view, remote, signal);
}

/** Reauthorizes remote model routes before handing local configurations to the local resolver. */
export async function localPlanModelSteps(
  service: AgentPlanRemoteExecution | undefined,
  userId: string,
  plan: AgentPlanInput,
): Promise<readonly AgentPlanStep[]> {
  const local = [];
  // A node checks its model route against the target it runs on, which it may inherit.
  for (const step of allPlanSteps(withInheritedPlanTarget(plan))) {
    if (!step.configuration?.runnerRoute) {
      local.push(step);
      continue;
    }
    if (!service) throw new AgentError("plan_remote_unavailable");
    await service.validateModel(
      userId,
      { projectId: plan.projectId ?? "" },
      step,
    );
  }
  return local;
}

function requireRemoteModelRoute(
  step: AgentPlanStep,
): NonNullable<NonNullable<AgentPlanStep["configuration"]>["runnerRoute"]> {
  const route = step.configuration?.runnerRoute;
  if (
    !route ||
    step.configuration?.connectionId !== undefined ||
    step.configuration?.provider !==
      (route.tool ? RUNNER_TOOL_PROVIDERS[route.tool] : "openrouter") ||
    (!route.tool && step.configuration?.reasoningEffort !== null) ||
    step.executionTarget?.kind !== "remote" ||
    step.executionTarget.workspaceId !== route.workspaceId
  )
    throw new AgentError("plan_context_changed");
  return route;
}
