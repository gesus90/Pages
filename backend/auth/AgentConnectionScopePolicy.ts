import type { AgentViewer } from "@/backend/auth/AgentProfilePolicy";
import type {
  AgentConnectionScope,
  AgentConnectionScopeTarget,
} from "@/definition/AgentConnectionScope";

function matchesScopeTarget(
  target: AgentConnectionScopeTarget,
  viewer: AgentViewer,
): boolean {
  switch (target.kind) {
    case "person":
      return target.targetId === viewer.actor.userId;
    case "group":
      return viewer.groupIds.includes(target.targetId);
    case "department":
      // Membership only: managing a department never grants its connections.
      return viewer.actor.departments.includes(target.targetId);
  }
}

/**
 * Decides whether a person may use the models of a connection with this scope.
 *
 * @param scope - The stored scope of the connection.
 * @param viewer - Current account facts and group memberships of the person.
 * @returns Whether the person passes; an inactive account never does.
 *
 * @remarks
 * A restricted scope is a union: one matching target is enough. Administrators
 * get no exception, because managing a connection is not using it.
 */
export function isInAgentConnectionScope(
  scope: AgentConnectionScope,
  viewer: AgentViewer,
): boolean {
  if (!viewer.actor.isActive) return false;
  if (scope.mode === "global") return true;
  return scope.targets.some((target) => matchesScopeTarget(target, viewer));
}
