import { AgentError } from "@/backend/error/AgentErrors";
import { matchesAgentTarget } from "@/backend/auth/AgentProfilePolicy";

import { planDepartments, soleDepartment } from "./AgentPlanOwnership";

import type { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import type { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import type { AgentViewer } from "@/backend/auth/AgentProfilePolicy";
import type { AgentPlan, AgentPlanInput } from "@/definition/AgentPlan";
import type { AgentProfileDirectory } from "@/definition/AgentProfile";

/** What decides who reads and changes a plan, so lists need not load its graph. */
export type AgentPlanRights = Pick<
  AgentPlan,
  "ownerId" | "departmentId" | "usage" | "sharing"
>;

/**
 * Who may read and change a plan besides its owner.
 *
 * @remarks
 * Two grants exist and stay apart. The team grant gives the members and the
 * leaders of the department a plan was created for the right to read, change
 * and run it; it
 * never replaces the check of the project, which the caller does first. The
 * usage share of the plan only lets others read it. Neither delegates
 * credentials, model access or the rights to private agents, wiki pages or
 * tickets: every operation checks those for the person who performs it.
 */
export class AgentPlanSharing {
  private readonly authorization: AuthorizationRepository;
  private readonly groups: UserGroupRepository;

  public constructor(
    authorization: AuthorizationRepository,
    groups: UserGroupRepository,
  ) {
    this.authorization = authorization;
    this.groups = groups;
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
   * Whether the person belongs to the team of the plan.
   *
   * @remarks
   * Only being a member or the leader of that department counts, never the
   * administrator role or the right to see all departments. The department
   * was fixed when the plan was created, so a team never follows the person
   * who saves it.
   */
  public isTeamMember(
    plan: Pick<AgentPlan, "departmentId">,
    viewer: AgentViewer,
  ): boolean {
    return (
      plan.departmentId !== undefined &&
      plan.departmentId !== null &&
      viewer.actor.departments.includes(plan.departmentId)
    );
  }

  /** Whether the person changes and runs the plan: its owner, or a member or leader of its team. */
  public canEdit(plan: AgentPlanRights, viewer: AgentViewer): boolean {
    return (
      plan.ownerId === viewer.actor.userId || this.isTeamMember(plan, viewer)
    );
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

  /** Preserves legacy workspace shares and applies explicit OR/AND group and department grants. */
  public canRead(plan: AgentPlanRights, viewer: AgentViewer): boolean {
    if (this.canEdit(plan, viewer)) return true;
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

  /** Exposes the same sharing directory names as user-owned agents, without account details. */
  public async directory(): Promise<AgentProfileDirectory> {
    const [snapshot, groups] = await Promise.all([
      this.authorization.snapshot(),
      this.groups.findAll(),
    ]);
    return {
      persons: [],
      departments: snapshot.departments,
      groups: groups.map((group) => ({ id: group.id, name: group.name })),
    };
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
}
