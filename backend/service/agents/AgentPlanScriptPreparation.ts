import { UserPolicyService } from "@/backend/auth/UserPolicyService";
import { readSpawnScope } from "@/backend/agents/cli/CliProcessScan";
import { AgentError } from "@/backend/error/AgentErrors";
import {
  planScriptIssues,
  planScriptParameters,
} from "@/definition/AgentPlanScript";
import { planBindings } from "./AgentPlanBindings";
import type { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import type { AgentPlan } from "@/definition/AgentPlan";
import type { AgentPlanScript } from "@/definition/AgentPlanScript";
import type { InterpreterProfile } from "@/definition/InterpreterProfile";
import type { ResolvedAgentWorkspace } from "@/definition/AgentWorkspace";
import type { AgentPlanTaskSnapshot } from "./AgentPlanBindings";
import type { AgentPlanScripts } from "./AgentPlanScripts";
import type { AgentPlanAccess } from "./AgentPlanAccess";
import type { AgentPlanTasks } from "./AgentPlanTasks";
import type { AgentWorkspaceService } from "./AgentWorkspaceService";

/** Frozen source text and execution context, kept in the server-only run snapshot. */
export interface AgentPlanScriptSnapshot {
  readonly step: AgentPlanScript;
  readonly interpreter: InterpreterProfile;
  readonly workspace: ResolvedAgentWorkspace;
  readonly inputs: Readonly<Record<string, string>>;
  readonly taskIds: readonly string[];
}

interface ScriptPreparationDependencies {
  readonly scripts: Pick<AgentPlanScripts, "executable">;
  readonly workspaces: Pick<AgentWorkspaceService, "resolve">;
  readonly access: Pick<AgentPlanAccess, "require">;
  readonly authorization: Pick<AuthorizationRepository, "snapshot">;
  readonly tasks: Pick<AgentPlanTasks, "snapshot">;
}

/** Resolves direct process execution through live account, plan and workspace rights. */
export class AgentPlanScriptPreparation {
  private readonly dependencies: ScriptPreparationDependencies;

  public constructor(dependencies: ScriptPreparationDependencies) {
    this.dependencies = dependencies;
  }

  /** Checks executable configurations for Play/control availability; never runs script content. */
  public async validate(userId: string, plan: AgentPlan): Promise<void> {
    const scripts = plan.nodes.filter(
      (node): node is AgentPlanScript =>
        node.type === "script" && node.executionTarget?.kind !== "remote",
    );
    if (scripts.length === 0) return;
    await this.authorize(userId, plan);
    for (const script of scripts) {
      if (planScriptIssues(script).length > 0)
        throw new AgentError("plan_script_invalid");
      await this.dependencies.scripts.executable(script.interpreterProfileId);
    }
  }

  /** Freezes declared source bindings and exact interpreter paths before reserving the workspace. */
  public async prepare(
    userId: string,
    plan: AgentPlan,
    tasks: readonly AgentPlanTaskSnapshot[],
  ): Promise<readonly AgentPlanScriptSnapshot[]> {
    const scripts = plan.nodes.filter(
      (node): node is AgentPlanScript =>
        node.type === "script" && node.executionTarget?.kind !== "remote",
    );
    if (scripts.length === 0) return [];
    const workspace = await this.authorize(userId, plan);
    const snapshots: AgentPlanScriptSnapshot[] = [];
    for (const step of scripts) {
      if (planScriptIssues(step).length > 0)
        throw new AgentError("plan_script_invalid");
      const bindings = planBindings(
        plan,
        step,
        tasks,
        planScriptParameters(step),
      );
      snapshots.push({
        step,
        interpreter: await this.dependencies.scripts.executable(
          step.interpreterProfileId,
        ),
        workspace,
        inputs: sourceInputs(step, bindings),
        taskIds: Object.values(step.bindings).flatMap((binding) => {
          if (binding.kind !== "source") return [];
          const node = plan.nodes.find((entry) => entry.id === binding.nodeId);
          return node?.type === "task" ? [node.taskId] : [];
        }),
      });
    }
    return snapshots;
  }

  /** Reauthorizes the actual executor and rejects changed directories or interpreter paths at dispatch. */
  public async reauthorize(
    userId: string,
    plan: AgentPlan,
    script: AgentPlanScriptSnapshot,
  ): Promise<void> {
    if (script.step.executionTarget?.kind === "remote")
      throw new AgentError("plan_remote_unavailable");
    const workspace = await this.authorize(userId, plan);
    const interpreter = await this.dependencies.scripts.executable(
      script.interpreter.id,
    );
    if (
      workspace.path !== script.workspace.path ||
      workspace.directoryIdentity !== script.workspace.directoryIdentity ||
      workspace.revision !== script.workspace.revision ||
      interpreter.path !== script.interpreter.path
    )
      throw new AgentError("plan_context_changed");
    for (const taskId of script.taskIds)
      await this.dependencies.tasks.snapshot(userId, plan.projectId, taskId);
  }

  private async authorize(
    userId: string,
    plan: AgentPlan,
  ): Promise<ResolvedAgentWorkspace> {
    const actor = (
      await this.dependencies.authorization.snapshot()
    ).accounts.find((account) => account.userId === userId);
    if (!actor || !new UserPolicyService().isAdministrator(actor))
      throw new AgentError("plan_script_permission_denied");
    const current = await this.dependencies.access.require(userId, plan.id);
    if (!current.canEdit) throw new AgentError("plan_access_denied");
    if (
      current.projectId !== plan.projectId ||
      current.workspaceId !== plan.workspaceId
    )
      throw new AgentError("plan_context_changed");
    if (process.platform !== "linux" || !process.getuid || !process.getgid)
      throw new AgentError("plan_script_platform_unsupported");
    try {
      await readSpawnScope();
    } catch {
      throw new AgentError("plan_script_platform_unsupported");
    }
    return this.dependencies.workspaces.resolve(
      userId,
      plan.workspaceId,
      plan.projectId,
    );
  }
}

function sourceInputs(
  step: AgentPlanScript,
  bindings: ReturnType<typeof planBindings>,
): Readonly<Record<string, string>> {
  const entries: [string, string][] = [];
  for (const input of step.inputs) {
    if (step.bindings[input.name]?.kind === "result") continue;
    const bound = Object.hasOwn(bindings, input.name)
      ? bindings[input.name]
      : null;
    if (bound === null || bound === undefined) {
      if (input.isRequired) throw new AgentError("plan_script_input_required");
      continue;
    }
    if (bound.type !== "text") throw new AgentError("plan_binding_invalid");
    if (input.isRequired && bound.text.trim() === "")
      throw new AgentError("plan_script_input_required");
    entries.push([input.name, bound.text]);
  }
  return Object.fromEntries(entries);
}
