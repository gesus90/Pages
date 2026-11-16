import { UserPolicyService } from "@/backend/auth/UserPolicyService";
import { withInheritedPlanTarget } from "@/definition/AgentPlanTarget";
import { allPlanSteps } from "@/definition/AgentPlanGroup";
import { AGENT_PLAN_TEAM_LIMIT } from "@/definition/AgentPlanTeam";
import { AgentError } from "@/backend/error/AgentErrors";
import { AgentPlanReadDenied } from "@/backend/error/AgentPlanReadDenied";
import { logEvent } from "@/backend/logging/Logger";

import type { ActorChannel } from "@/backend/auth/McpActorContext";
import type { AgentViewer } from "@/backend/auth/AgentProfilePolicy";
import type { AgentPlanRepository } from "@/backend/database/repositories/agent/AgentPlanRepository";
import type {
  AgentPlan,
  AgentPlanInput,
  AgentPlanSummary,
  AgentPlanView,
} from "@/definition/AgentPlan";
import type { AgentWorkspaceChoice } from "@/definition/AgentWorkspace";
import type { AgentWorkspaceService } from "./AgentWorkspaceService";
import type {
  AgentPlanRights,
  AgentPlanSharedRights,
  AgentPlanSharing,
} from "./AgentPlanSharing";
import type { AgentPlanRightsView } from "@/definition/AgentPlanTeam";
import type { AgentProfileDirectory } from "@/definition/AgentProfile";
import type {
  AgentPlanWorkspaces,
  PlanWorkspaceProject,
} from "./AgentPlanWorkspaces";

/** The project and the departments that decide which shared objects a person works with. */
export interface AgentPlanTeam {
  readonly isManagement?: boolean;
  readonly isAdministrator?: boolean;
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

/** Answers whether a person manages a project, for the team management of its plans. */
export type ProjectManagerCheck = (
  projectId: string,
  userId: string,
) => Promise<boolean>;

/** Where a readable plan belongs and what the person may do with it. */
interface PlanPlace {
  readonly rights: AgentPlanSharedRights;
  readonly isTeamMember: boolean;
  readonly isOwner: boolean;
  readonly project: Pick<AgentWorkspaceChoice, "projectName" | "github">;
  readonly isWorkspaceMissing: boolean;
}

/**
 * Decides who sees and changes a plan, on every call.
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
  private readonly isProjectManager: ProjectManagerCheck | undefined;
  private readonly channel: ActorChannel;

  public constructor(
    plans: AgentPlanRepository,
    workspaces: AgentWorkspaceService,
    sharing: AgentPlanSharing,
    options: {
      readonly catalog?: AgentPlanWorkspaces;
      readonly isProjectManager?: ProjectManagerCheck;
      readonly channel?: ActorChannel;
    } = {},
  ) {
    this.plans = plans;
    this.workspaces = workspaces;
    this.sharing = sharing;
    this.catalog = options.catalog;
    this.isProjectManager = options.isProjectManager;
    this.channel = options.channel ?? "ui";
  }

  /**
   * Returns the access rules for another surface, with the same plans and shares.
   * @param channel - The surface whose administrator reading decides workspace access.
   */
  public forChannel(channel: ActorChannel): AgentPlanAccess {
    return new AgentPlanAccess(
      this.plans,
      this.workspaces.forChannel(channel),
      this.sharing.forChannel(channel),
      {
        catalog: this.catalog?.forChannel(channel),
        isProjectManager: this.isProjectManager,
        channel,
      },
    );
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
      if (place) views.push(this.view(plan, place, false));
    }
    return views;
  }

  /**
   * Lists the plans the person reads as summaries, in the order of {@link list}.
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
        teams: listing.teams ?? [],
        usage: listing.usage,
        revision: listing.revision,
        ...(listing.oneShot ? { oneShot: true } : {}),
        ...(listing.scheduledDeletionAt
          ? { scheduledDeletionAt: listing.scheduledDeletionAt }
          : {}),
        canEdit: place.rights.canEdit,
        canRun: place.rights.canRun,
        ...(place.rights.isAdminAccess ? { isAdminAccess: true } : {}),
        ...(place.isTeamMember ? { isTeamMember: true } : {}),
        ...(place.isWorkspaceMissing ? { isWorkspaceMissing: true } : {}),
      });
    }
    return summaries;
  }

  /**
   * Requires the current workspace/project and sharing rights for this surface.
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
    if (!plan || !place) {
      const denied = new AgentPlanReadDenied(
        "plan_access",
        this.denialReason(plan, context.viewer),
      );
      logEvent({
        level: "warn",
        event: "agent_plan.access.denied",
        component: "AgentPlanAccess",
        message: "Plan access was refused under the current account rules",
        metadata: {
          userId,
          source: denied.source,
          reason: denied.reason,
          kind: this.channel,
          state: context.viewer.actor.mode,
          role: context.viewer.actor.role?.id ?? null,
          operation: this.sharing.isAdministrator(context.viewer)
            ? "administrator_read"
            : "role_read",
        },
      });
      throw denied;
    }
    const isManager =
      place.rights.canRead &&
      plan.ownerId !== userId &&
      !place.rights.isAdministrator &&
      (await this.isProjectManager?.(plan.projectId, userId)) === true;
    return this.view(plan, place, isManager);
  }

  /**
   * Validates the groups and departments of new teams.
   * @throws {AgentError} `profile_target_invalid` for an unknown target.
   */
  public async validateTeams(
    teams: Parameters<AgentPlanSharing["validateTeams"]>[0],
    projectId?: string,
  ): Promise<void> {
    if (teams.length > AGENT_PLAN_TEAM_LIMIT)
      throw new AgentError("clone_request_invalid");
    await this.sharing.validateTeams(teams);
    for (const team of teams) {
      if (team.kind !== "user") continue;
      if (!projectId) throw new AgentError("profile_target_invalid");
      try {
        await this.workspaces.requireProjectAccess(team.targetId, projectId);
      } catch (error: unknown) {
        if (error instanceof AgentError)
          throw new AgentError("profile_target_invalid");
        throw error;
      }
    }
  }

  /**
   * Resolves the department an object of the person belongs to and the project they work in.
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
      ...(new UserPolicyService().isManagement(viewer.actor) &&
      !this.sharing.isAdministrator(viewer)
        ? { isManagement: true }
        : {}),
      isAdministrator: this.sharing.isAdministrator(viewer),
      projectId: workspace?.projectId ?? null,
      departmentIds: viewer.actor.departments,
      departmentId: this.sharing.teamDepartment(viewer),
    };
  }

  /** Rejects full host access unless the caller is an active human administrator. */
  public async requireFullEnvironment(
    userId: string,
    plan: AgentPlanInput,
  ): Promise<void> {
    if (
      !allPlanSteps(plan).some(
        (step) =>
          step.configuration?.template.run?.access === "full_environment",
      )
    )
      return;
    if (!this.sharing.isAdministrator(await this.sharing.viewer(userId)))
      throw new AgentError("plan_full_environment_forbidden");
    if (
      allPlanSteps(withInheritedPlanTarget(plan)).some(
        (step) =>
          step.configuration?.template.run?.access === "full_environment" &&
          step.executionTarget?.kind === "remote",
      )
    )
      throw new AgentError("plan_full_environment_local_only");
  }

  /** Resolves the explicitly bound host owner without using another plan owner's authority. */
  public async fullEnvironmentOwner(
    userId: string,
    ownerId: string,
  ): Promise<{ readonly ownerId: string; readonly ownerName: string }> {
    if (!this.sharing.isAdministrator(await this.sharing.viewer(userId)))
      throw new AgentError("plan_full_environment_forbidden");
    const owner = await this.sharing.viewer(ownerId);
    if (
      !owner.actor.isAdmin ||
      owner.actor.isAgent ||
      ownerId !== process.env.PAGES_FULL_ENVIRONMENT_OWNER_ID
    )
      throw new AgentError("plan_full_environment_owner_unavailable");
    return {
      ownerId,
      ownerName:
        `${owner.actor.firstName} ${owner.actor.lastName}`.trim() || ownerId,
    };
  }

  /** Supplies team targets, including persons; the administrator-only owner field uses the same names. */
  public async directory(userId: string): Promise<AgentProfileDirectory> {
    await this.sharing.viewer(userId);
    return this.sharing.directory(true);
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

  private denialReason(plan: AgentPlan | null, viewer: AgentViewer): string {
    if (!plan) return "plan_missing";
    return this.sharing.canRead(plan, viewer)
      ? "workspace_or_project_denied"
      : "sharing_denied";
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
    const rights = this.sharing.rights(plan, context.viewer);
    if (!rights.canRead) return null;
    const isTeamMember = this.sharing.isTeamMember(plan, context.viewer);
    const isOwner = plan.ownerId === context.viewer.actor.userId;
    const workspace = context.workspaces.find(
      (entry) =>
        entry.id === plan.workspaceId && entry.projectId === plan.projectId,
    );
    if (workspace)
      return {
        rights,
        isTeamMember,
        isOwner,
        project: workspace,
        isWorkspaceMissing: false,
      };
    const { registered, projects } = await context.orphans();
    const project = projects?.get(plan.projectId);
    if (!project || !registered) return null;
    return {
      rights,
      isTeamMember,
      isOwner,
      project,
      isWorkspaceMissing: true,
    };
  }

  private view(
    plan: AgentPlan,
    place: PlanPlace,
    isProjectManager: boolean,
  ): AgentPlanView {
    const rights: AgentPlanRightsView = {
      ...place.rights,
      canManageTeams:
        place.isOwner || place.rights.isAdministrator || isProjectManager,
    };
    return {
      ...plan,
      teams: plan.teams ?? [],
      canEdit: rights.canEdit,
      rights,
      projectName: place.project.projectName,
      github: place.project.github,
      ...(place.isWorkspaceMissing ? { isWorkspaceMissing: true } : {}),
    };
  }
}
