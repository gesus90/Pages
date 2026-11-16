import { AgentError } from "@/backend/error/AgentErrors";
import { planContentDigest } from "@/backend/agents/AgentPlanContentDigest";
import { hasPlanGroupAliases } from "@/definition/AgentPlanGroup";

import { bindGroupStep } from "./AgentPlanGroupParameters";
import {
  remoteSessionSnapshot,
  remoteGroupParameters,
  remoteSessionInput,
} from "./AgentPlanRemoteSession";

import type {
  AgentPlanRun,
  AgentPlan,
  AgentPlanStep,
} from "@/definition/AgentPlan";
import type { AgentPlanRemoteTarget } from "@/definition/AgentPlanExecution";
import type { AgentPlanRemoteExecution } from "./AgentPlanRemoteExecution";
import type { AgentPlanAccess } from "./AgentPlanAccess";
import type { AgentPlanRemoteParameters } from "./AgentPlanRemoteParameters";
import type { AgentPlanScriptSnapshot } from "./AgentPlanScriptPreparation";
import type {
  AgentPlanSnapshot,
  AgentPlanStepSnapshot,
} from "./AgentPlanSnapshot";
import type { PreparedPlanStep } from "./AgentPlanStepStart";
import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";
import type { AgentPlanTaskSnapshot } from "./AgentPlanBindings";
import type { AgentPlanTasks } from "./AgentPlanTasks";

interface RemotePreparationDependencies {
  readonly access: Pick<AgentPlanAccess, "require">;
  readonly tasks?: Pick<AgentPlanTasks, "snapshot">;
  readonly parameters?: AgentPlanRemoteParameters;
  readonly prepare: AgentPlanRemoteExecution["prepare"];
  readonly validateModel: AgentPlanRemoteExecution["validateModel"];
  readonly target: (
    userId: string,
    plan: Pick<AgentPlan, "projectId">,
    step: AgentPlanStep | AgentPlanScriptSnapshot["step"],
  ) => Promise<AgentPlanRemoteTarget>;
}

/** Prepares engine-managed remote groups and nodes while legacy execution remains a drain facade. */
export class AgentPlanRunnerRemotePreparation {
  private readonly dependencies: RemotePreparationDependencies;

  public constructor(dependencies: RemotePreparationDependencies) {
    this.dependencies = dependencies;
  }

  /** Rechecks a script's exact remote workspace immediately before runner dispatch. */
  public async authorizeScript(
    run: AgentPlanRun,
    snapshot: AgentPlanSnapshot,
    source: AgentPlanScriptSnapshot,
  ): Promise<void> {
    await this.dependencies.access.require(run.userId, run.planId);
    const remote = snapshot.remoteSteps?.find(
      (entry) => entry.step.id === source.step.id,
    );
    if (
      !remote ||
      planContentDigest(
        await this.dependencies.target(run.userId, snapshot.plan, source.step),
      ) !== planContentDigest(remote.target)
    )
      throw new AgentError("plan_context_changed");
  }

  /** Resolves legacy group aliases once while retaining the frozen remote target. */
  public async prepareGroupSession(
    run: AgentPlanRun,
    snapshot: AgentPlanSnapshot,
    groupId: string,
  ): Promise<AgentPlanSnapshot> {
    const group = snapshot.groups?.find((entry) => entry.id === groupId);
    const first = snapshot.steps.find((entry) => entry.groupId === groupId);
    if (!group || !first?.step.configuration)
      throw new AgentError("plan_context_changed");
    if (!hasPlanGroupAliases(group)) return snapshot;
    const prepared = await this.dependencies.prepare(
      run.userId,
      snapshot.plan,
      {
        ...first.step,
        bindings: group.bindings,
        configuration: {
          ...first.step.configuration,
          template: {
            ...first.template,
            parameters: group.parameters,
            markdown: "",
          },
        },
      },
      await this.groupTasks(run, snapshot, group),
    );
    const shared = remoteSessionSnapshot(prepared, snapshot.plan, {}).prepared;
    if (!prepared.parameters) throw new AgentError("plan_context_changed");
    const parameters = prepared.parameters;
    const memberIds = new Set(
      snapshot.steps
        .filter((entry) => entry.groupId === groupId)
        .map((entry) => entry.step.id),
    );
    return {
      ...snapshot,
      steps: await Promise.all(
        snapshot.steps.map((entry) =>
          entry.groupId === groupId
            ? bindGroupStep(group, entry, shared)
            : Promise.resolve(entry),
        ),
      ),
      remoteSteps: snapshot.remoteSteps?.map((entry) =>
        memberIds.has(entry.step.id)
          ? {
              ...entry,
              parameters: remoteGroupParameters(group, entry, parameters),
            }
          : entry,
      ),
    };
  }

  /** Reauthorizes remote session inputs without changing their frozen selection. */
  public async prepareSession(
    run: AgentPlanRun,
    snapshot: AgentPlanSnapshot,
    source: AgentPlanStepSnapshot,
  ): Promise<PreparedPlanStep> {
    const remote = snapshot.remoteSteps?.find(
      (entry) => entry.step.id === source.step.id,
    );
    const step = remote?.step;
    if (!remote || step?.type !== "agent")
      throw new AgentError("plan_context_changed");
    const authorize = async (): Promise<void> => {
      await this.dependencies.access.require(run.userId, run.planId);
      if (
        planContentDigest(
          await this.dependencies.target(run.userId, snapshot.plan, step),
        ) !== planContentDigest(remote.target)
      )
        throw new AgentError("plan_context_changed");
      await this.dependencies.validateModel(run.userId, snapshot.plan, step);
      if (remote.parameters)
        await this.dependencies.parameters?.authorize(
          run.userId,
          remote.parameters,
          { projectId: snapshot.plan.projectId, target: remote.target },
        );
    };
    await authorize();
    const prepared = await remoteSessionInput(run, source, remote);
    return {
      ...prepared,
      input: { ...prepared.input, beforeStart: authorize },
    };
  }

  private async groupTasks(
    run: AgentPlanRun,
    snapshot: AgentPlanSnapshot,
    group: AgentPlanGroup,
  ): Promise<readonly AgentPlanTaskSnapshot[]> {
    const ids = new Set(
      Object.values(group.bindings).flatMap((binding) =>
        binding.kind === "source" ? [binding.nodeId] : [],
      ),
    );
    const tasks: AgentPlanTaskSnapshot[] = [];
    for (const node of snapshot.plan.nodes) {
      if (node.type !== "task" || !ids.has(node.id)) continue;
      if (!this.dependencies.tasks)
        throw new AgentError("plan_context_changed");
      tasks.push(
        await this.dependencies.tasks.snapshot(
          run.userId,
          snapshot.plan.projectId,
          node.taskId,
        ),
      );
    }
    return tasks;
  }
}
