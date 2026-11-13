import { UserPolicyService } from "@/backend/auth/UserPolicyService";
import { AgentOperationError } from "@/backend/error/AgentOperationError";

import type { AccountAccess } from "@/definition/Authorization";

/** Prevents indirect changes of administrator accounts and of the actor's own rights through memberships. */
export function requireManagementMembershipChange(
  actor: AccountAccess,
  target: AccountAccess,
): void {
  const policy = new UserPolicyService();
  if (!policy.isManagement(actor) || policy.isAdministrator(actor)) return;
  if (target.isAdmin)
    throw new AgentOperationError("FORBIDDEN", { reason: "admin_target" });
  if (actor.userId === target.userId)
    throw new AgentOperationError("FORBIDDEN", { reason: "self_escalation" });
}
