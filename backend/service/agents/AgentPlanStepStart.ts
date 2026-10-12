import { AgentError } from "@/backend/error/AgentErrors";

import { bindAgentParameters } from "./AgentParameterBinding";

import type { TextExecutionInput } from "@/backend/agents/TextExecution";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type {
  AgentPlanStepSnapshot,
  AgentPlanSnapshot,
} from "./AgentPlanSnapshot";
import type { AgentProfileService } from "./AgentProfileService";
import type { AgentParameterService } from "./AgentParameterService";
import type { AgentPlanAccess } from "./AgentPlanAccess";
import type { AgentPlanTasks } from "./AgentPlanTasks";

/** A working directory is a separate process contract, never a prompt convention. */
export interface AgentPlanExecutionInput extends TextExecutionInput {
  readonly directory: string | null;
  /** Rechecks live access immediately before the adapter's provider request or spawn. */
  readonly beforeStart?: () => Promise<void>;
}

interface StartDependencies {
  readonly profiles: AgentProfileService;
  readonly parameters: AgentParameterService;
  readonly access: AgentPlanAccess;
  readonly tasks: AgentPlanTasks;
}

interface StartContext {
  readonly connectionId: string;
  readonly values: Readonly<Record<string, unknown>>;
}

/** Reauthorizes the executor just before each step, without replacing its frozen template or input. */
export class AgentPlanStepStart {
  private readonly dependencies: StartDependencies;

  public constructor(dependencies: StartDependencies) {
    this.dependencies = dependencies;
  }

  /** Resolves credentials for the current executor and rejects a redirected model or working copy. */
  public async prepare(
    run: AgentPlanRun,
    snapshot: AgentPlanSnapshot,
    step: AgentPlanStepSnapshot,
  ): Promise<AgentPlanExecutionInput> {
    await this.dependencies.access.require(run.userId, snapshot.plan.id);
    const selection = {
      agentId: step.step.agentId,
      personalAgentId: step.step.personalAgentId,
      projectId: snapshot.plan.projectId,
    };
    const resolved = await this.dependencies.profiles.resolveDefinition(
      run.userId,
      selection,
    );
    if (
      resolved.assignment.connection.provider !== step.provider ||
      resolved.assignment.model !== step.model ||
      resolved.assignment.reasoningEffort !== step.reasoningEffort
    )
      throw new AgentError("plan_context_changed");
    for (const taskId of step.taskIds)
      await this.dependencies.tasks.snapshot(
        run.userId,
        snapshot.plan.projectId,
        taskId,
      );
    const values = resultValues(step, run);
    const live = await this.dependencies.parameters.prepare(
      run.userId,
      {
        agentId: selection.agentId,
        personalAgentId: selection.personalAgentId,
        workspaceId: snapshot.plan.workspaceId,
      },
      values,
      step.template,
    );
    validateContext(step, live);
    const parameters = await bindAgentParameters(step.template, values, {
      workspace: async (id) => {
        const reference = step.prepared.references.find(
          (entry) => entry.id === id,
        );
        if (!reference) throw new AgentError("plan_context_changed");
        return reference;
      },
      wiki: async (id) => {
        const page = step.prepared.wiki[id];
        if (!page) throw new AgentError("plan_binding_invalid");
        return page;
      },
    });
    return {
      agent: resolved.assignment,
      userId: run.userId,
      directory: step.prepared.directory?.path ?? null,
      prompt: `${parameters.markdown}\n\n${step.step.instruction}`,
      beforeStart: () =>
        this.reauthorize(run, snapshot, step, {
          values,
          connectionId: resolved.assignment.connection.id,
        }),
    };
  }

  private async reauthorize(
    run: AgentPlanRun,
    snapshot: AgentPlanSnapshot,
    step: AgentPlanStepSnapshot,
    context: StartContext,
  ): Promise<void> {
    await this.dependencies.access.require(run.userId, snapshot.plan.id);
    const current = await this.dependencies.profiles.resolveDefinition(
      run.userId,
      {
        agentId: step.step.agentId,
        personalAgentId: step.step.personalAgentId,
        projectId: snapshot.plan.projectId,
      },
    );
    if (
      current.assignment.connection.id !== context.connectionId ||
      current.assignment.model !== step.model ||
      current.assignment.reasoningEffort !== step.reasoningEffort ||
      current.assignment.connection.provider !== step.provider
    )
      throw new AgentError("plan_context_changed");
    const authorized = await this.dependencies.parameters.prepare(
      run.userId,
      {
        agentId: step.step.agentId,
        personalAgentId: step.step.personalAgentId,
        workspaceId: snapshot.plan.workspaceId,
      },
      context.values,
      step.template,
    );
    validateContext(step, authorized);
    for (const taskId of step.taskIds)
      await this.dependencies.tasks.snapshot(
        run.userId,
        snapshot.plan.projectId,
        taskId,
      );
  }
}

function resultValues(
  step: AgentPlanStepSnapshot,
  run: AgentPlanRun,
): Readonly<Record<string, unknown>> {
  const values: Record<string, unknown> = {
    ...step.prepared.parameters.values,
  };
  for (const [name, binding] of Object.entries(step.step.bindings)) {
    if (binding.kind !== "result") continue;
    const result = run.steps.find((entry) => entry.id === binding.stepId);
    if (result?.status !== "succeeded" || result.output === null)
      throw new AgentError("plan_binding_invalid");
    values[name] = { type: "text", text: result.output };
  }
  return values;
}

function validateContext(
  step: AgentPlanStepSnapshot,
  live: Awaited<ReturnType<AgentParameterService["prepare"]>>,
): void {
  for (const previous of [
    step.prepared.workspace,
    ...step.prepared.references,
  ]) {
    const current = [live.workspace, ...live.references].find(
      (entry) => entry.id === previous.id,
    );
    if (
      !current ||
      current.projectId !== previous.projectId ||
      current.path !== previous.path ||
      current.directoryIdentity !== previous.directoryIdentity ||
      JSON.stringify(current.github) !== JSON.stringify(previous.github)
    )
      throw new AgentError("plan_context_changed");
  }
}
