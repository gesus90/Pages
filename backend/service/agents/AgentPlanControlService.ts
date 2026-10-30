import type { AgentWorkspaceCleanupRepository } from "@/backend/database/repositories/agent/AgentWorkspaceCleanupRepository";
import { planExecutionIssues } from "@/definition/AgentPlanGraph";
import { AgentError } from "@/backend/error/AgentErrors";
import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";
import { AgentPlanValidationError } from "@/backend/error/AgentPlanValidationError";
import { AgentPlanWorkspaceConflictError } from "@/backend/error/AgentPlanWorkspaceConflictError";
import { isSamePlanTarget } from "@/definition/AgentPlanTarget";
import { planControl } from "./AgentPlanControl";
import { visibleStartRejection } from "./AgentPlanStartRejectionVisibility";
import type { AgentPlanIssue } from "@/definition/AgentPlanGraph";
import type { AgentPlanControl } from "@/definition/AgentPlanControl";
import type { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import type { AgentPlanAccess } from "./AgentPlanAccess";
import type { AgentProfileService } from "./AgentProfileService";
import type { AgentPlanPreparation } from "./AgentPlanPreparation";
import type {
  AgentPlan,
  AgentPlanRun,
  AgentPlanView,
} from "@/definition/AgentPlan";
import type { AgentPlanWorkspaceConflict } from "@/definition/AgentPlanWorkspaceConflict";
import type {
  AgentPlanStartRejection,
  AgentPlanStartRejectionPage,
} from "@/definition/AgentPlanStartRejection";
import type { AgentPlanStartRejectionRepository } from "@/backend/database/repositories/agent/AgentPlanStartRejectionRepository";
import type { AgentPlanWorkspaces } from "./AgentPlanWorkspaces";
import type { AgentWorkspaceService } from "./AgentWorkspaceService";

interface ControlDependencies {
  readonly workspaceCleanup?: AgentWorkspaceCleanupRepository;
  readonly access: Pick<AgentPlanAccess, "require">;
  readonly profiles: Pick<AgentProfileService, "catalog">;
  readonly preparation?: Pick<AgentPlanPreparation, "prepare">;
  readonly startRejections?: Pick<AgentPlanStartRejectionRepository, "latest"> &
    Partial<Pick<AgentPlanStartRejectionRepository, "page">>;
  readonly workspaceCatalog?: Pick<AgentPlanWorkspaces, "requireAccess">;
  readonly workspaces?: Pick<AgentWorkspaceService, "requireAccess">;
  readonly runs: Pick<
    AgentPlanRunRepository,
    "latest" | "hasReservation" | "findWorkspaceReservation" | "resources"
  >;
}

interface ExecutionIssue {
  readonly code: string | null;
  readonly conflict?: AgentPlanWorkspaceConflict;
}

function withExecutionIssue(
  control: AgentPlanControl,
  issues: readonly AgentPlanIssue[],
  issue: string | null,
  conflict: AgentPlanWorkspaceConflict | undefined,
): AgentPlanControl {
  if (issues.length === 0 && issue === control.issue && !conflict)
    return control;
  return {
    ...control,
    issues,
    issue: issue ?? "plan_invalid",
    canPlay: control.canRestart === true,
    canResume: false,
    ...(conflict ? { workspaceConflict: conflict } : {}),
  };
}

function withStartRejection(
  control: AgentPlanControl,
  rejection: AgentPlanStartRejection | null,
): AgentPlanControl {
  return rejection ? { ...control, lastStartRejection: rejection } : control;
}
/** Server-side action availability, including current graph and execution-context refusals. */
export class AgentPlanControlService {
  private readonly dependencies: ControlDependencies;
  public constructor(dependencies: ControlDependencies) {
    this.dependencies = dependencies;
  }
  /** Shared readers see state without prompts, results or session capabilities. */
  public async read(userId: string, planId: string): Promise<AgentPlanControl> {
    const plan = await this.dependencies.access.require(userId, planId);
    const run = await this.dependencies.runs.latest(planId);
    const base = planControl(plan, run, {
      userId,
      hasReservation: run
        ? await this.dependencies.runs.hasReservation(run.id)
        : false,
    });
    const control = await this.withCleanup(base, userId, plan);
    const rejection = plan.canEdit
      ? await this.visibleStartRejection(userId, plan)
      : null;
    if (plan.isWorkspaceMissing)
      return withStartRejection(
        {
          ...control,
          canPlay: control.canRestart === true,
          canResume: false,
          issue: "workspace_not_found",
        },
        rejection,
      );
    if (!plan.canEdit) return control;
    if (
      run &&
      (run.status === "running" ||
        run.status === "pausing" ||
        run.status === "stopping")
    )
      return withStartRejection(control, rejection);
    const issues = [
      ...planExecutionIssues(
        plan,
        await this.dependencies.profiles.catalog(userId, plan.projectId),
      ),
    ];
    const execution = await this.executionIssue(userId, plan, issues);
    let issue = execution.code ?? control.issue;
    if (run?.status === "paused" && (await this.hasChangedContext(run, plan)))
      issue = "plan_context_changed";
    return withStartRejection(
      withExecutionIssue(
        control,
        issues,
        issue,
        issue === execution.code ? execution.conflict : undefined,
      ),
      rejection,
    );
  }

  /** Reads one historical refusal after rechecking current editor and target rights. */
  public async rejectionHistory(
    userId: string,
    planId: string,
    before: string | null,
  ): Promise<AgentPlanStartRejectionPage> {
    const plan = await this.dependencies.access.require(userId, planId);
    if (!plan.canEdit) throw new AgentError("plan_access_denied");
    const page = await this.dependencies.startRejections?.page?.(
      userId,
      planId,
      before,
    );
    if (!page) throw new AgentError("plan_run_unavailable");
    return {
      ...page,
      entry: await visibleStartRejection(
        this.dependencies.workspaceCatalog ?? this.dependencies.workspaces,
        userId,
        plan,
        page.entry,
      ),
    };
  }

  private async withCleanup(
    base: AgentPlanControl,
    userId: string,
    plan: AgentPlanView,
  ): Promise<AgentPlanControl> {
    return {
      ...base,
      cleanup: plan.canEdit
        ? await this.dependencies.workspaceCleanup?.forPlan(userId, plan.id)
        : undefined,
    };
  }

  private async visibleStartRejection(
    userId: string,
    plan: AgentPlan,
  ): Promise<AgentPlanStartRejection | null> {
    const rejection = await this.dependencies.startRejections?.latest(
      userId,
      plan.id,
    );
    return visibleStartRejection(
      this.dependencies.workspaceCatalog ?? this.dependencies.workspaces,
      userId,
      plan,
      rejection ?? null,
    );
  }

  /** A paused run keeps its project, workspace and plan target; another one in the plan blocks its continuation. */
  private async hasChangedContext(
    run: AgentPlanRun,
    plan: AgentPlan,
  ): Promise<boolean> {
    const resources = await this.dependencies.runs.resources(run.id);
    return (
      resources.projectId !== plan.projectId ||
      resources.workspaceIds[0] !== plan.workspaceId ||
      !isSamePlanTarget(resources.executionTarget, plan.executionTarget)
    );
  }

  private async executionIssue(
    userId: string,
    plan: AgentPlan,
    issues: AgentPlanIssue[],
  ): Promise<ExecutionIssue> {
    try {
      const snapshot = await this.dependencies.preparation?.prepare(
        userId,
        plan,
      );
      if (!snapshot) return { code: null };
      return { code: null };
    } catch (error: unknown) {
      if (error instanceof AgentPlanWorkspaceConflictError)
        return { code: error.code, conflict: error.conflict };
      if (error instanceof AgentPlanValidationError)
        issues.push(...error.issues);
      if (error instanceof AgentExecutionError) return { code: error.code };
      if (!(error instanceof AgentError)) throw error;
      return { code: error.code };
    }
  }
}
