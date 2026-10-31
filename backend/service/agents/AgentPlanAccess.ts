import { AgentError } from "@/backend/error/AgentErrors";

import type { AgentViewer } from "@/backend/auth/AgentProfilePolicy";
import type { AgentPlanRepository } from "@/backend/database/repositories/agent/AgentPlanRepository";
import type {
  AgentPlan,
  AgentPlanSummary,
  AgentPlanView,
} from "@/definition/AgentPlan";
import type { AgentWorkspaceChoice } from "@/definition/AgentWorkspace";
import type { AgentWorkspaceService } from "./AgentWorkspaceService";
import type { AgentPlanRights, AgentPlanSharing } from "./AgentPlanSharing";
import type { AgentProfileDirectory } from "@/definition/AgentProfile";
import type {
  AgentPlanWorkspaces,
  PlanWorkspaceProject,
} from "./AgentPlanWorkspaces";

/** The project and the departments that decide which shared objects a person works with. */
export interface AgentPlanTeam {
  /** The project of the workspace the person works in; `null` without one. */
  readonly projectId: string | null;
  /** The departments the person is a member or leader of now, each once. */
  readonly departmentIds: readonly string[];
  /** The department an object the person creates belongs to; `null` for none or several. */
  readonly departmentId: string | null;
}

/** What a plan needs to be placed in a project: the rights to it and the workspace it names. */
type PlanPlacement = AgentPlanRights &
  Pick<AgentPlan, "workspaceId" | "projectId">;

/** The project facts of the plans whose workspace registration is gone. */
interface OrphanContext {
  readonly registered: ReadonlySet<string> | undefined;
  readonly projects: ReadonlyMap<string, PlanWorkspaceProject> | undefined;
}

/** The person and the workspaces every plan of one call is judged against. */
interface AccessContext {
  readonly workspaces: readonly AgentWorkspaceChoice[];
  readonly viewer: AgentViewer;
  /** Read at most once, and only when a plan without its workspace turns up. */
  readonly orphans: () => Promise<OrphanContext>;
}

/** Where a readable plan belongs and what the person may do with it. */
interface PlanPlace {
  readonly canEdit: boolean;
  readonly project: Pick<AgentWorkspaceChoice, "projectName" | "github">;
  readonly isWorkspaceMissing: boolean;
}

/**
 * Decides who sees and changes a plan, on every call.
 *
 * @remarks
 * Live project access to the workspace controls every read or run. The owner
 * and the members and leaders of the plan's department, who also have that
 * project access, edit and run it; everybody else the plan is shared with only reads it.
 */
export class AgentPlanAccess {
  private readonly plans: AgentPlanRepository;
  private readonly workspaces: AgentWorkspaceService;
  private readonly sharing: AgentPlanSharing;
  private readonly catalog: AgentPlanWorkspaces | undefined;

  public constructor(
    plans: AgentPlanRepository,
    workspaces: AgentWorkspaceService,
    sharing: AgentPlanSharing,
    catalog?: AgentPlanWorkspaces,
  ) {
    this.plans = plans;
    this.workspaces = workspaces;
    this.sharing = sharing;
    this.catalog = catalog;
  }

  /** Keeps orphaned plans repairable under their existing project and sharing rights. */
  public async list(userId: string): Promise<readonly AgentPlanView[]> {
    const [plans, context] = await Promise.all([
      this.plans.list(),
      this.context(userId),
    ]);
    const views: AgentPlanView[] = [];
    for (const plan of plans) {
      const place = await this.place(plan, context);
      if (place) views.push(this.view(plan, place));
    }
    return views;
  }

  /**
   * Lists the plans the person reads as summaries, in the order of {@link list}.
   *
   * @remarks
   * The same decisions as {@link list} without loading any graph, for pages
   * that only need to name, group and offer plans.
   */
  public async summaries(userId: string): Promise<readonly AgentPlanSummary[]> {
    const [listings, context] = await Promise.all([
      this.plans.listings(),
      this.context(userId),
    ]);
    const summaries: AgentPlanSummary[] = [];
    for (const listing of listings) {
      const place = await this.place(listing, context);
      if (!place) continue;
      summaries.push({
        id: listing.id,
        name: listing.name,
        ownerId: listing.ownerId,
        projectId: listing.projectId,
        projectName: place.project.projectName,
        workspaceId: listing.workspaceId,
        departmentId: listing.departmentId,
        usage: listing.usage,
        revision: listing.revision,
        canEdit: place.canEdit,
        ...(place.isWorkspaceMissing ? { isWorkspaceMissing: true } : {}),
      });
    }
    return summaries;
  }

  /**
   * Does not grant an administrator access to another user's private plan.
   *
   * @remarks
   * Reads only the one plan: whoever asks for a plan, for a run's plan or for
   * its control state does not wait for every other plan to be loaded.
   */
  public async require(userId: string, id: string): Promise<AgentPlanView> {
    const [plan, context] = await Promise.all([
      this.plans.find(id),
      this.context(userId),
    ]);
    const place = plan ? await this.place(plan, context) : null;
    if (!plan || !place) throw new AgentError("plan_access_denied");
    return this.view(plan, place);
  }

  /**
   * Resolves the department an object of the person belongs to and the project they work in.
   *
   * @param userId - The signed-in person; an inactive account is refused.
   * @param workspaceId - The workspace being worked in, or `null` without one.
   * @throws {AgentError} `plan_access_denied` for a workspace outside the
   * projects the person can open.
   */
  public async team(
    userId: string,
    workspaceId: string | null,
  ): Promise<AgentPlanTeam> {
    const viewer = await this.sharing.viewer(userId);
    const workspace =
      workspaceId === null
        ? null
        : (
            await (this.catalog?.choices(userId) ??
              this.workspaces.choices(userId))
          ).find((entry) => entry.id === workspaceId);
    if (workspace === undefined) throw new AgentError("plan_access_denied");
    return {
      projectId: workspace?.projectId ?? null,
      departmentIds: viewer.actor.departments,
      departmentId: this.sharing.teamDepartment(viewer),
    };
  }

  /** Supplies sharing choices only to active accounts. */
  public async directory(userId: string): Promise<AgentProfileDirectory> {
    await this.sharing.viewer(userId);
    return this.sharing.directory();
  }

  /** Validates sharing identifiers before persisting a plan. */
  public async validateSharing(plan: AgentPlan): Promise<void> {
    await this.sharing.validate(plan);
  }

  private async context(userId: string): Promise<AccessContext> {
    const [workspaces, viewer] = await Promise.all([
      this.catalog?.choices(userId) ?? this.workspaces.choices(userId),
      this.sharing.viewer(userId),
    ]);
    let orphans: Promise<OrphanContext> | undefined;
    return {
      workspaces,
      viewer,
      orphans: () => (orphans ??= this.readOrphans(viewer)),
    };
  }

  private async readOrphans(viewer: AgentViewer): Promise<OrphanContext> {
    const [registered, projects] = await Promise.all([
      this.catalog?.registeredIds(),
      this.catalog?.projects(viewer.actor),
    ]);
    return { registered, projects };
  }

  /** The plan's project and the person's rights to it, or `null` when the person does not read it. */
  private async place(
    plan: PlanPlacement,
    context: AccessContext,
  ): Promise<PlanPlace | null> {
    if (!this.sharing.canRead(plan, context.viewer)) return null;
    const canEdit = this.sharing.canEdit(plan, context.viewer);
    const workspace = context.workspaces.find(
      (entry) =>
        entry.id === plan.workspaceId && entry.projectId === plan.projectId,
    );
    if (workspace)
      return { canEdit, project: workspace, isWorkspaceMissing: false };
    const { registered, projects } = await context.orphans();
    const project = projects?.get(plan.projectId);
    if (!project || !registered || registered.has(plan.workspaceId))
      return null;
    return { canEdit, project, isWorkspaceMissing: true };
  }

  private view(plan: AgentPlan, place: PlanPlace): AgentPlanView {
    return {
      ...plan,
      canEdit: place.canEdit,
      projectName: place.project.projectName,
      github: place.project.github,
      ...(place.isWorkspaceMissing ? { isWorkspaceMissing: true } : {}),
    };
  }
}
