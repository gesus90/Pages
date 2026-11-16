import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";

import type { AuthorizationSnapshot } from "@/backend/database/repositories/AuthorizationRepository";
import type { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import type { UserRole } from "@/definition/Authorization";

/** Resolves a role the snapshot contains, or refuses the change as an invalid input. */
export function requireRole(
  snapshot: AuthorizationSnapshot,
  roleId: string,
): UserRole {
  const role = snapshot.roles.find((candidate) => candidate.id === roleId);
  if (!role) throw new AgentEmployeeError("invalidInput");
  return role;
}

/** Refuses departments the snapshot does not contain. */
export function requireDepartments(
  snapshot: AuthorizationSnapshot,
  ids: readonly string[],
): void {
  if (
    ids.some(
      (id) => !snapshot.departments.some((department) => department.id === id),
    )
  )
    throw new AgentEmployeeError("invalidInput");
}

/** Compares two department lists regardless of their order. */
export function sameDepartments(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length && left.every((id) => right.includes(id));
}

/** Refuses a change of an agent that works in a plan or a session right now. */
export async function requireIdle(
  store: EmployeeStore,
  agentId: string,
): Promise<void> {
  if (await store.removals().isRunning(agentId))
    throw new AgentEmployeeError("busy");
}
