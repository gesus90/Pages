import { AgentError } from "@/backend/error/AgentErrors";
import { matchesAgentTarget } from "@/backend/auth/AgentProfilePolicy";
import { UserPolicyService } from "@/backend/auth/UserPolicyService";
import { planTeamsOf } from "@/definition/AgentPlanTeam";

import { planDepartments, soleDepartment } from "./AgentPlanOwnership";

import type { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import type { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import type { AgentViewer } from "@/backend/auth/AgentProfilePolicy";
import type { ActorChannel } from "@/backend/auth/McpActorContext";
import type { AgentPlan, AgentPlanInput } from "@/definition/AgentPlan";
import type { AgentProfileDirectory } from "@/definition/AgentProfile";
import type {
  AgentPlanRightsView,
  AgentPlanTeam,
} from "@/definition/AgentPlanTeam";

/** What decides who reads and changes a plan, so lists need not load its graph. */
export type AgentPlanRights = Pick<
  AgentPlan,
  "ownerId" | "departmentId" | "usage" | "sharing" | "teams"
>;

/** The rights of a plan that the sharing alone decides; project management is checked by the caller. */
export type AgentPlanSharedRights = Omit<AgentPlanRightsView, "canManageTeams">;

const NO_TEAM_RIGHTS = { canRead: false, canEdit: false, canRun: false };

/**
 * Who may read and change a plan besides its owner.
 *
 * @remarks
 * Two grants exist and stay apart. The team grant gives the members and the
 * leaders of each group or department of the plan the rights of that team
 * entry: read, change and run (PAGE-329); it never replaces the check of the
 * project, which the caller does first. The usage share of the plan only lets
 * others read it. Active human administrators have every right on every plan. Neither delegates
 * credentials, model access or the rights to private agents, wiki pages or
 * tickets: every operation checks those for the person who performs it.
 */
export class AgentPlanSharing {
  private readonly authorization: AuthorizationRepository;
  private readonly groups: UserGroupRepository;
  private readonly policy: UserPolicyService;
  private readonly channel: ActorChannel;

  public constructor(
    authorization: AuthorizationRepository,
    groups: UserGroupRepository,
    channel: ActorChannel = "ui",
  ) {
    this.authorization = authorization;
    this.groups = groups;
    this.channel = channel;
    this.policy = new UserPolicyService(channel);
  }

  /**
   * The same sharing for another surface (PAGE-329).
   *
   * @param channel - The surface whose administrator reading decides the administrator rights.
   */
  public forChannel(channel: ActorChannel): AgentPlanSharing {
    return channel === this.channel
      ? this
      : new AgentPlanSharing(this.authorization, this.groups, channel);
  }

  /**
   * Whether the person is an active human administrator on this surface.
   *
   * @remarks
   * An agent account is never one, whatever is stored; the interface asks for
   * the active administrator mode like every other administrator right.
   */
  public isAdministrator(viewer: AgentViewer): boolean {
    return this.policy.isAdministrator(viewer.actor);
  }

  /**
   * Resolves the person for every plan decision.
   *
   * @remarks
   * Leading a department counts like being a member of it, so the departments
   * of the returned actor are the union of both, each once; the administrator
   * role and the right to see all departments add nothing. The usage share of a
   * plan reads the same departments, so a leader matches a department target
   * without the `manage_users` capability that agent sharing asks for.
   */
  public async viewer(userId: string): Promise<AgentViewer> {
    const [snapshot, groupIds] = await Promise.all([
      this.authorization.snapshot(),
      this.groups.findIdsByMember(userId),
    ]);
    const actor = snapshot.accounts.find(
      (account) => account.userId === userId,
    );
    if (!actor?.isActive) throw new AgentError("plan_access_denied");
    return {
      actor: {
        ...actor,
        departments: planDepartments(actor),
        managedDepartments: [],
      },
      groupIds,
    };
  }

  /**
   * Whether the person belongs to one of the teams of the plan.
   *
   * @remarks
   * Only being a member or the leader of the group or department counts,
   * never the administrator role or the right to see all departments. The
   * teams change only by an explicit access change, never by a save.
   */
  public isTeamMember(
    plan: Pick<AgentPlan, "departmentId" | "teams">,
    viewer: AgentViewer,
  ): boolean {
    return planTeamsOf(plan).some((team) => isMemberOf(team, viewer));
  }

  /**
   * The rights the teams of the plan give the person: the union of every team
   * the person is a member or leader of.
   */
  public teamRights(
    plan: Pick<AgentPlan, "departmentId" | "teams">,
    viewer: AgentViewer,
  ): Pick<AgentPlanRightsView, "canRead" | "canEdit" | "canRun"> {
    return planTeamsOf(plan)
      .filter((team) => isMemberOf(team, viewer))
      .reduce(
        (rights, team) => ({
          canRead: rights.canRead || team.canRead,
          canEdit: rights.canEdit || team.canEdit,
          canRun: rights.canRun || team.canRun,
        }),
        NO_TEAM_RIGHTS,
      );
  }

  /**
   * Every right of the person on the plan, except the management of its teams by a project manager.
   *
   * @remarks
   * The owner and an active human administrator have every right; an
   * administrator who does not own the plan has them as admin access, which
   * the history records (PAGE-329, part E). Everybody else has the rights of
   * the teams they belong to and reads a plan that is shared with them.
   */
  public rights(
    plan: AgentPlanRights,
    viewer: AgentViewer,
  ): AgentPlanSharedRights {
    const isOwner = plan.ownerId === viewer.actor.userId;
    const isAdministrator = this.isAdministrator(viewer);
    if (isOwner || isAdministrator)
      return {
        canRead: true,
        canEdit: true,
        canRun: true,
        canChangeOwner: isAdministrator,
        canDelete: true,
        isAdministrator,
        isAdminAccess: !isOwner,
      };
    const team = this.teamRights(plan, viewer);
    return {
      ...team,
      canRead: team.canRead || this.isSharedWith(plan, viewer),
      canChangeOwner: false,
      canDelete: false,
      isAdministrator: false,
      isAdminAccess: false,
    };
  }

  /** Whether the person changes the plan: its owner, an administrator or a team member with the right to change. */
  public canEdit(plan: AgentPlanRights, viewer: AgentViewer): boolean {
    return this.rights(plan, viewer).canEdit;
  }

  /**
   * The department a plan or template created by the person belongs to.
   *
   * @returns The department of a person who is a member or leader of exactly one,
   * `null` for a person with none or several: nothing is shared then, and no
   * department is chosen for them.
   */
  public teamDepartment(viewer: AgentViewer): string | null {
    return soleDepartment(viewer.actor.departments);
  }

  /** Whether the person reads the plan: by every right of {@link rights}, or by its share. */
  public canRead(plan: AgentPlanRights, viewer: AgentViewer): boolean {
    return this.rights(plan, viewer).canRead;
  }

  /**
   * Exposes the same sharing directory names as user-owned agents, without account details.
   *
   * @param includePersons - Whether to name the active accounts too, the
   * owner choices of an administrator (PAGE-329).
   */
  public async directory(
    includePersons = false,
  ): Promise<AgentProfileDirectory> {
    const [snapshot, groups] = await Promise.all([
      this.authorization.snapshot(),
      this.groups.findAll(),
    ]);
    return {
      persons: includePersons
        ? snapshot.accounts
            .filter((account) => account.isActive)
            .map((account) => ({
              id: account.userId,
              name:
                `${account.firstName} ${account.lastName}`.trim() ||
                account.userId,
            }))
        : [],
      departments: snapshot.departments,
      groups: groups.map((group) => ({ id: group.id, name: group.name })),
    };
  }

  /**
   * Rejects teams whose group or department does not exist.
   *
   * @throws {AgentError} `profile_target_invalid` for an unknown target.
   */
  public async validateTeams(teams: readonly AgentPlanTeam[]): Promise<void> {
    if (teams.length === 0) return;
    const directory = await this.directory();
    for (const team of teams) {
      const entries =
        team.kind === "group" ? directory.groups : directory.departments;
      if (!entries.some((entry) => entry.id === team.targetId))
        throw new AgentError("profile_target_invalid");
    }
  }

  /** Rejects unknown sharing targets, even if the caller manipulates the form payload. */
  public async validate(plan: AgentPlanInput): Promise<void> {
    if (!plan.sharing) return;
    const directory = await this.directory();
    for (const target of plan.sharing.targets) {
      const entries =
        target.kind === "group" ? directory.groups : directory.departments;
      if (!entries.some((entry) => entry.id === target.targetId))
        throw new AgentError("profile_target_invalid");
    }
  }

  /** Preserves legacy workspace shares and applies explicit OR/AND group and department grants. */
  private isSharedWith(plan: AgentPlanRights, viewer: AgentViewer): boolean {
    if (plan.usage === "private") return false;
    if (!plan.sharing || plan.sharing.isGlobal) return true;
    const matches = plan.sharing.targets.map((target) =>
      matchesAgentTarget(target, viewer),
    );
    if (matches.length === 0) return false;
    return plan.sharing.operator === "and"
      ? matches.every(Boolean)
      : matches.some(Boolean);
  }
}

/** Whether the person is a member or leader of the group or department of the team. */
function isMemberOf(team: AgentPlanTeam, viewer: AgentViewer): boolean {
  return team.kind === "group"
    ? viewer.groupIds.includes(team.targetId)
    : viewer.actor.departments.includes(team.targetId);
}
