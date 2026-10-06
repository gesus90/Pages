import { UserPolicyService } from "@/backend/auth/UserPolicyService";
import { CAPABILITY } from "@/definition/Authorization";

import type { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import type { AccountAccess } from "@/definition/Authorization";
import type { Role } from "@/definition/Role";

/** Keeps the existing A3 directory projection consistent with current A2 permissions. */
export function projectProjection(account: AccountAccess): Role {
  if (new UserPolicyService().isAdministrator(account)) return "admin";
  return account.role?.permissions.includes(CAPABILITY.MANAGE_PROJECTS)
    ? "manager"
    : "employee";
}

/** Updates the legacy assignee projection within the same authorization transaction. */
export async function updateProjectProjection(
  repository: AuthorizationRepository,
): Promise<void> {
  for (const account of (await repository.snapshot()).accounts) {
    await repository
      .users()
      .updateRole(account.userId, projectProjection(account));
  }
}
