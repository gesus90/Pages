import { AgentError } from "@/backend/error/AgentErrors";
import { matchesAgentTarget } from "@/backend/auth/AgentProfilePolicy";

import type { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import type { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import type { AgentViewer } from "@/backend/auth/AgentProfilePolicy";
import type { AgentPlan, AgentPlanInput } from "@/definition/AgentPlan";
import type { AgentProfileDirectory } from "@/definition/AgentProfile";

/** Plan sharing grants usage only; project access and model credentials remain separate checks. */
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

  /** Uses membership, not managed departments or administrator status, for shared usage. */
  public async viewer(userId: string): Promise<AgentViewer> {
    const [snapshot, groupIds] = await Promise.all([
      this.authorization.snapshot(),
      this.groups.findIdsByMember(userId),
    ]);
    const actor = snapshot.accounts.find(
      (account) => account.userId === userId,
    );
    if (!actor?.isActive) throw new AgentError("plan_access_denied");
    return { actor: { ...actor, managedDepartments: [] }, groupIds };
  }

  /** Preserves legacy workspace shares and applies explicit OR/AND group and department grants. */
  public canRead(plan: AgentPlan, viewer: AgentViewer): boolean {
    if (plan.ownerId === viewer.actor.userId) return true;
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
