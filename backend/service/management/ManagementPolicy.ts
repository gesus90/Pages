import { UserPolicyService } from "@/backend/auth/UserPolicyService";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { ADMINISTRATION_ROLE_ID } from "@/definition/Authorization";

import type { AccountAccess } from "@/definition/Authorization";

/** Checks protected targets and role changes independently of directory visibility. */
export function requireManagementTarget(
  actor: AccountAccess,
  target: AccountAccess,
  role?: string,
): void {
  const policy = new UserPolicyService();
  if (policy.isAdministrator(actor)) return;
  if (policy.isManagement(actor)) {
    if (target.isAdmin)
      throw new AgentOperationError("FORBIDDEN", { reason: "admin_target" });
    if (target.userId === actor.userId)
      throw new AgentOperationError("FORBIDDEN", { reason: "self_escalation" });
  }
  if (
    role !== undefined &&
    role !== target.role?.id &&
    (role === ADMINISTRATION_ROLE_ID ||
      target.role?.id === ADMINISTRATION_ROLE_ID ||
      role === "admin")
  )
    throw new AgentOperationError("FORBIDDEN", { reason: "role_grant" });
}
/** Protected roles cannot be granted through ordinary delegation, including by legacy roles. */
export function requireManagementRole(
  actor: AccountAccess,
  role: string,
): void {
  if (
    (role === ADMINISTRATION_ROLE_ID || role === "admin") &&
    !new UserPolicyService().isAdministrator(actor)
  )
    throw new AgentOperationError("FORBIDDEN", { reason: "role_grant" });
}
