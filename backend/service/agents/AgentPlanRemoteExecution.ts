import { allPlanSteps } from "@/definition/AgentPlanGroup";
import { withInheritedPlanTarget } from "@/definition/AgentPlanTarget";
import { AgentError } from "@/backend/error/AgentErrors";
import { planContentDigest } from "@/backend/agents/AgentPlanContentDigest";
import { runnerExecutionSchema } from "@/definition/RunnerExecution";
import {
  remoteTextInputs,
  remoteScriptCommand,
  remoteModelCommand,
} from "./AgentPlanRemoteCommand";
import { bindAgentParameters } from "./AgentParameterBinding";
import {
  remoteCliModels,
  remoteOpenRouterModels,
} from "./AgentPlanRemoteCatalog";
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
import type { AgentPlanRemoteTargets } from "./AgentPlanRemoteTargets";
import type { AgentPlanAccess } from "./AgentPlanAccess";
import type { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import type { RunnerService } from "@/backend/service/runner/RunnerService";
import type { RunnerOpenRouterService } from "@/backend/service/runner/RunnerOpenRouterService";

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
}

interface RemoteExecutionDependencies {
  readonly targets: AgentPlanRemoteTargets;
  readonly access: AgentPlanAccess;
  readonly runners: RunnerService;
  readonly provider: RunnerOpenRouterService;
  readonly runs: AgentPlanRunRepository;
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
  ): Promise<{
    readonly models: readonly PageAgentModel[];
    readonly interpreters: readonly AgentPlanInterpreter[];
    readonly statuses: readonly AgentPlanRemoteStatus[];
  }> {
    const targets = await this.dependencies.targets.list(userId, projectId);
    const choices = await this.dependencies.targets.choices(userId);
    const models: PageAgentModel[] = [];
    const interpreters: AgentPlanInterpreter[] = [];
    const statuses: AgentPlanRemoteStatus[] = [];
    for (const target of targets) {
      const runnerProblem = await this.dependencies.runners.availability(
        target.connectionId,
      );
      const isWorkspaceUsable = choices.find(
        (entry) => entry.workspaceId === target.workspaceId,
      )?.isUsable;
      const problem =
        runnerProblem ?? (isWorkspaceUsable ? null : "remoteWorkspace");
      const status: AgentPlanRemoteStatus = {
        workspaceId: target.workspaceId,
        problem,
        tools: [],
        hasModelCatalog: false,
      };
      statuses.push(status);
      if (problem) continue;
      try {
        const programs = await this.dependencies.runners.ready(
          userId,
          target.connectionId,
        );
        for (const program of programs)
          interpreters.push({
            id: `${target.workspaceId}-${program.id}`,
            name: `${target.connectionName} / ${target.workspaceName} / ${program.name}`,
            runnerWorkspaceId: target.workspaceId,
            status: "ok",
            version: program.version,
            error: null,
          });
        const tools = await this.dependencies.runners.cliInventory(
          userId,
          target.connectionId,
        );
        models.push(...remoteCliModels(target, tools));
        const readyStatus = {
          ...status,
          tools,
          interpreterIds: programs.map(
            (program) => `${target.workspaceId}-${program.id}`,
          ),
        };
        statuses[statuses.length - 1] = readyStatus;
        const catalog = await this.dependencies.provider.catalog(
          userId,
          target.connectionId,
        );
        if (catalog.operation !== "catalog") continue;
        statuses[statuses.length - 1] = {
          ...readyStatus,
          hasModelCatalog: catalog.freeModels.length > 0,
          modelIds: catalog.freeModels.map((model) => model.id),
          catalogRevision: catalog.syncedAt,
        };
        models.push(...remoteOpenRouterModels(target, catalog));
      } catch {
        // Unavailable targets stay editable, but offer no executable model route.
        continue;
      }
    }
    return { models, interpreters, statuses };
  }

  /** Verifies exact catalog selection and current workspace access before saving a model copy. */
  public async validateModel(
    userId: string,
    plan: Pick<AgentPlan, "projectId">,
    step: AgentPlanStep,
  ): Promise<void> {
    const route = step.configuration?.runnerRoute;
    if (
      !route ||
      step.configuration?.connectionId !== undefined ||
      step.configuration?.provider !==
        (route.tool
          ? ({ codex: "codex_cli", claude: "claude_code" } as const)[route.tool]
          : "openrouter") ||
      (!route.tool && step.configuration?.reasoningEffort !== null) ||
      step.executionTarget?.kind !== "remote" ||
      step.executionTarget.workspaceId !== route.workspaceId
    )
      throw new AgentError("plan_context_changed");
    const { models } = await this.sources(userId, plan.projectId);
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
    const inputs = remoteTextInputs(plan, step, tasks);
    const basis = {
      version: 1 as const,
      revision: plan.revision,
      workspace: target.path,
      outputBytes: 65536,
      input: JSON.stringify(inputs),
    };
    if (step.type === "script")
      command = remoteScriptCommand(step, target, interpreters, basis);
    else {
      await this.validateModel(userId, plan, step);
      command = remoteModelCommand(step, basis);
    }
    return {
      step,
      target,
      command: runnerExecutionSchema.parse(command),
      inputs,
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
    const command = await resolvedCommand(run, remote);
    const job = await this.claim({
      run,
      remote,
      command,
      attemptId: execution.attemptId,
      signal,
    });
    if (!job) return CANCELLED_BEFORE_DISPATCH;
    for (;;) {
      if (signal.aborted)
        this.dependencies.runners.cancel(target.connectionId, job.jobId);
      const current = await this.dependencies.runs.find(run.id);
      const step = current?.steps.find((entry) => entry.id === remote.step.id);
      if (!step) throw new AgentError("plan_context_changed");
      if (step.remote && step.status !== "running" && step.status !== "waiting")
        return step;
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
    }
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

async function resolvedCommand(
  run: AgentPlanRun,
  remote: RemotePlanStep,
): Promise<RunnerExecution> {
  const inputs = { ...remote.inputs };
  for (const [name, binding] of Object.entries(remote.step.bindings)) {
    if (binding.kind !== "result") continue;
    const result = run.steps.find((entry) => entry.id === binding.stepId);
    if (result?.status !== "succeeded" || result.output === null)
      throw new AgentError("plan_binding_invalid");
    inputs[name] = result.output;
  }
  const command = remote.command;
  if (command.program.kind === "script")
    return {
      ...command,
      revision: run.planRevision,
      sourceRevision: command.revision,
      input: JSON.stringify(inputs),
    };
  const configuration =
    remote.step.type === "agent" ? remote.step.configuration : null;
  if (!configuration) throw new AgentError("configuration_invalid");
  const bound = await bindAgentParameters(
    { ...configuration.template, markdown: command.program.prompt },
    Object.fromEntries(
      Object.entries(inputs).map(([name, text]) => [
        name,
        { type: "text", text },
      ]),
    ),
    {
      ticket: () => Promise.reject(new AgentError("plan_binding_invalid")),
      workspace: () => Promise.reject(new AgentError("plan_binding_invalid")),
      wiki: () => Promise.reject(new AgentError("plan_binding_invalid")),
    },
  );
  return {
    ...command,
    revision: run.planRevision,
    sourceRevision: command.revision,
    program: { ...command.program, prompt: bound.markdown },
  };
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
