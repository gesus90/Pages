import { logCaughtError } from "@/backend/logging/Logger";
import { allPlanRunResults } from "@/definition/AgentPlanLoopResults";
import { isRemoteCloseoutUnconfirmed } from "@/definition/AgentPlanRemoteCloseout";
import { AgentPlanValidationError } from "@/backend/error/AgentPlanValidationError";
import {
  planTargetIssues,
  withInheritedPlanTarget,
} from "@/definition/AgentPlanTarget";
import { allPlanSteps } from "@/definition/AgentPlanGroup";
import { AgentError } from "@/backend/error/AgentErrors";
import { planContentDigest } from "@/backend/agents/AgentPlanContentDigest";
import {
  RUNNER_TOOL_PROVIDERS,
  runnerExecutionSchema,
} from "@/definition/RunnerExecution";

import { AgentPlanRemoteSettlement } from "./AgentPlanRemoteSettlement";
import { withRemoteProgress } from "./AgentPlanRemoteProgress";
import { observeRemoteAttempt } from "./AgentPlanRemoteObservation";
import { requireRemoteRunResources } from "./AgentPlanRemoteTargets";
import {
  remoteTextInputs,
  remoteScriptCommand,
  remoteModelCommand,
  remotePlanContract,
} from "./AgentPlanRemoteCommand";
import { validateRemoteParameterPrompt } from "./AgentPlanRemoteParameters";
import { STREAMED_ASSET_REASON } from "./AgentTicketAssetService";
import {
  CANCELLED_BEFORE_DISPATCH,
  type RemoteRetryTerms,
} from "./AgentPlanRemoteDispatch";
import { claimRemoteJob } from "./AgentPlanRemoteClaim";
import { remoteContinuationCommand } from "./AgentPlanRemoteContinuation";
import { remoteRetryCommand } from "./AgentPlanRemoteRetryCommand";
import {
  requireRemoteResultPayload,
  resolvedRemoteCommand,
} from "./AgentPlanRemoteResolvedCommand";
import { AgentPlanRemoteSources } from "./AgentPlanRemoteSources";
import { remoteTodoChecklists } from "./AgentPlanRemoteChecklist";
import { isOriginalRemoteJob } from "./AgentPlanRemoteCancellation";
import {
  completedGatedRemote,
  remoteAssessmentTerms,
  requiresRemoteAcceptance,
} from "./AgentPlanRemoteAcceptance";

import type {
  AgentPlanRemoteParameters,
  RemotePlanParameters,
} from "./AgentPlanRemoteParameters";
import type { RunnerPagesAccessService } from "@/backend/service/runner/RunnerPagesAccessService";
import type { AgentPlanRemoteStatus } from "@/definition/AgentPlanTarget";
import type { AgentPlanRunResources } from "@/backend/agents/AgentPlanRunResources";
import type {
  AgentPlanInput,
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
import type { AgentPlanStepReportService } from "./AgentPlanStepReportService";
import type { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import type { RunnerService } from "@/backend/service/runner/RunnerService";
import type { RunnerOpenRouterService } from "@/backend/service/runner/RunnerOpenRouterService";
import type {
  AgentPlanTasks,
  AgentPlanTicketChecklist,
} from "./AgentPlanTasks";

/** Private snapshot: exact command, source inputs and authorized target, without credentials. */
export interface RemotePlanStep {
  /** Preserved context is appended after binding, so earlier output cannot introduce placeholders. */
  readonly recoveryContext?: string;
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
  readonly pages?: Pick<RunnerPagesAccessService, "open" | "close">;
  readonly stepReports?: Pick<AgentPlanStepReportService, "open" | "close">;
  readonly targets: Pick<AgentPlanRemoteTargets, "list" | "choices">;
  readonly access: Pick<AgentPlanAccess, "require">;
  readonly runners: Pick<
    RunnerService,
    | "availability"
    | "catalog"
    | "supportsPagesAccess"
    | "supportsOpenCode"
    | "supportsExactResultPayload"
    | "supportsContinuation"
    | "supportsAssetFiles"
    | "supportsLargeAssetFiles"
    | "ready"
    | "enqueue"
    | "cancel"
    | "progress"
    | "historyPending"
    | "contact"
  > &
    Partial<Pick<RunnerService, "enqueueRetry" | "pauseExecution">>;
  readonly provider: Pick<RunnerOpenRouterService, "catalog">;
  readonly runs: Pick<AgentPlanRunRepository, "find">;
}

/** Authorizes runner catalogs and dispatches immutable claims; nothing executes on Pages. */
export class AgentPlanRemoteExecution {
  private readonly dependencies: RemoteExecutionDependencies;
  private readonly settlement: AgentPlanRemoteSettlement;

  public constructor(dependencies: RemoteExecutionDependencies) {
    this.dependencies = dependencies;
    this.settlement = new AgentPlanRemoteSettlement(dependencies);
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
        !this.canReceiveFiles(target, parameters)
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
    retry?: RemoteRetryTerms,
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
    const command = await this.dispatchCommand(run, remote, retry);
    let result: Partial<AgentPlanStepResult>;
    try {
      await this.openStepReport(run, remote, execution.attemptId);
      await this.dependencies.pages?.open(run, remote, execution.attemptId);
      const job = await claimRemoteJob({
        runners: this.dependencies.runners,
        run,
        remote: { ...remote, command },
        attemptId: execution.attemptId,
        signal,
        allowTerminalRerun: retry?.allowTerminalRerun === true,
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
    return this.settlement.settle(run, remote, result, execution.attemptId);
  }

  /** Reattaches the saved remote claim and retains its original completion and acceptance gates. */
  public observe(
    run: AgentPlanRun,
    remote: RemotePlanStep,
    signal: AbortSignal,
  ): Promise<Partial<AgentPlanStepResult>> {
    return observeRemoteAttempt(run, remote, {
      runners: this.dependencies.runners,
      pages: this.dependencies.pages,
      wait: (job) => this.waitForJob(run, remote, job, signal),
      settle: (result, attemptId) =>
        this.settlement.settle(run, remote, result, attemptId),
    });
  }

  /** Rechecks remote resource access before disclosing historical output, without requiring online status. */
  public async requireRead(
    userId: string,
    resources: AgentPlanRunResources,
  ): Promise<void> {
    await requireRemoteRunResources(
      this.dependencies.targets,
      userId,
      resources,
    );
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

  /** Queue pause is replayable and cannot kill a job that has already acquired its launch claim. */
  public async pause(run: AgentPlanRun): Promise<void> {
    await this.setPaused(run, true);
  }

  /** Resumes the original remote workers; neither their claims nor session IDs change. */
  public async resume(run: AgentPlanRun): Promise<void> {
    await this.setPaused(run, false);
  }

  /** Adds current transport health to confirmed job facts without mutating the stored execution state. */
  public async withProgress(run: AgentPlanRun): Promise<AgentPlanRun> {
    return withRemoteProgress(run, this.dependencies.runners);
  }

  private async setPaused(run: AgentPlanRun, isPaused: boolean): Promise<void> {
    await Promise.all(
      allPlanRunResults(run).map(async (step) => {
        const execution = step.execution;
        if (execution?.target.kind !== "remote") return;
        const job = await this.dependencies.runners.progress(
          execution.target.connectionId,
          run.id,
          execution.attemptId,
        );
        if (isOriginalRemoteJob(run, step, job)) {
          if (!this.dependencies.runners.pauseExecution)
            throw new AgentError("plan_runner_control_update_required");
          await this.dependencies.runners.pauseExecution(
            execution.target.connectionId,
            job.jobId,
            isPaused,
          );
        }
      }),
    );
  }

  /** Lets the agent of a gated CLI step report through the tool, under the scope of its Pages credential. */
  private async openStepReport(
    run: AgentPlanRun,
    remote: RemotePlanStep,
    attemptId: string,
  ): Promise<void> {
    const { stepReports, access } = this.dependencies;
    if (
      !stepReports ||
      remote.command.pagesAccess !== 1 ||
      !requiresRemoteAcceptance(remote)
    )
      return;
    const terms = remoteAssessmentTerms(remote);
    if (!terms) return;
    await stepReports.open({
      runId: run.id,
      sessionScopeId: remote.step.id,
      stepId: remote.step.id,
      attemptId,
      terms: {
        ...terms,
        projectId: (await access.require(run.userId, run.planId)).projectId,
      },
    });
  }

  /** A runner receives files at all with asset contract v2, and files above 10 MiB with v3. */
  private canReceiveFiles(
    target: AgentPlanRemoteTarget,
    parameters: RemotePlanParameters,
  ): boolean {
    const { runners } = this.dependencies;
    if (!runners.supportsAssetFiles(target.connectionId)) return false;
    return (
      runners.supportsLargeAssetFiles(target.connectionId) ||
      parameters.assets.every(
        (asset) => asset.file.modelContent !== STREAMED_ASSET_REASON,
      )
    );
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
      if (current?.status === "pausing")
        await this.pause(current).catch((error: unknown) =>
          logCaughtError("AgentPlanRemoteExecution", error),
        );
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

  /** The frozen command of this attempt, with the live runner's result and continuation contracts applied. */
  private async dispatchCommand(
    run: AgentPlanRun,
    remote: RemotePlanStep,
    retry: RemoteRetryTerms | undefined,
  ): Promise<RunnerExecution> {
    const { connectionId } = remote.target;
    const command = remoteRetryCommand(
      remoteContinuationCommand(await resolvedRemoteCommand(run, remote), {
        isSupported:
          this.dependencies.runners.supportsContinuation(connectionId),
        resumeSessionId: retry?.resumeSessionId ?? null,
      }),
      retry,
    );
    requireRemoteResultPayload(command, () =>
      this.dependencies.runners.supportsExactResultPayload(connectionId),
    );
    return command;
  }
}

/** Captures only the acceptance contract that must be checked before remote OpenCode succeeds. */
function remoteAcceptanceContract(
  step: AgentPlanStep,
  command: RunnerExecution,
  tickets: readonly AgentPlanTicketChecklist[],
): AgentPlanContract | undefined {
  return command.program.kind === "cli"
    ? remotePlanContract(step, tickets)
    : undefined;
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
