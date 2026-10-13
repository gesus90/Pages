import type { AccountAccess } from "@/definition/Authorization";
import type {
  AgentProfile,
  AgentProfilePurpose,
  AgentProfileTarget,
} from "@/definition/AgentProfile";

/** Authorization facts resolved from current account and group membership. */
export interface AgentViewer {
  readonly actor: AccountAccess;
  readonly groupIds: readonly string[];
}

/** Checks an access grant; usage shares never grant managed-department access. */
export function matchesAgentTarget(
  target: AgentProfileTarget,
  viewer: AgentViewer,
): boolean {
  const { actor, groupIds } = viewer;
  switch (target.kind) {
    case "person":
      return target.targetId === actor.userId;
    case "group":
      return groupIds.includes(target.targetId);
    case "department":
      return (
        actor.departments.includes(target.targetId) ||
        (actor.role?.permissions.includes("manage_users") === true &&
          actor.managedDepartments.includes(target.targetId))
      );
    case "system":
      return true;
  }
}

/** Returns organizational priority without considering availability or falling back. */
export function agentProfilePriority(
  profile: AgentProfile,
  viewer: AgentViewer,
  purpose: AgentProfilePurpose,
): number {
  const priority = { person: 4, group: 3, department: 2, system: 1 };
  return Math.max(
    0,
    ...profile.targets
      .filter(
        (target) =>
          (target.kind !== "system" || target.targetId === purpose) &&
          matchesAgentTarget(target, viewer),
      )
      .map((target) => priority[target.kind]),
  );
}

/** Sharing controls visibility and usage independently of connection assignments. */
export function hasAgentUsage(
  profile: AgentProfile,
  viewer: AgentViewer,
): boolean {
  const sharing = profile.configuration?.sharing;
  if (profile.ownerId === viewer.actor.userId) return true;
  if (!sharing) return agentProfilePriority(profile, viewer, "agent") > 0;
  if (profile.ownerId) {
    const matches = sharing.targets.map((target) =>
      matchesAgentTarget(target, {
        ...viewer,
        actor: { ...viewer.actor, managedDepartments: [] },
      }),
    );
    return (
      sharing.isGlobal ||
      (matches.length > 0 &&
        (sharing.operator === "and"
          ? matches.every(Boolean)
          : matches.some(Boolean)))
    );
  }
  return (
    sharing.isGlobal ||
    sharing.targets.some((target) =>
      matchesAgentTarget(target, {
        ...viewer,
        actor: { ...viewer.actor, managedDepartments: [] },
      }),
    )
  );
}
