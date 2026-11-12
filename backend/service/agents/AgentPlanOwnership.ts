import { AgentError } from "@/backend/error/AgentErrors";
import { fullPlanTeam, isPlanAdministrator } from "@/definition/AgentPlanTeam";

import type { AgentPlanView } from "@/definition/AgentPlan";
import type { AccountAccess } from "@/definition/Authorization";
import type { AgentPlanAccess } from "./AgentPlanAccess";

/**
 * Keeps a plan in its project unless its owner moves it.
 *
 * @remarks
 * Project and department form the shared area and the name space of a plan, so
 * a move to another project would shift who sees it and which names it
 * collides with. Every team member may change the workspace within the
 * project, the usage and the share, like the owner; only the owner moves the
 * plan to a workspace of another project.
 *
 * @param userId - The person who saves.
 * @param previous - The stored plan.
 * @param projectId - The project of the workspace the save names.
 * @throws {AgentError} `plan_project_owner_only` for a move to another
 * project by someone who neither owns the plan nor is an administrator.
 */
export function requireOwnerForProjectChange(
  userId: string,
  previous: AgentPlanView,
  projectId: string,
): void {
  if (
    previous.ownerId !== userId &&
    !isPlanAdministrator(previous) &&
    projectId !== previous.projectId
  )
    throw new AgentError("plan_project_owner_only");
}

/**
 * The departments a person belongs to in the agent plan area.
 *
 * @remarks
 * Leading a department counts like being a member of it: the union of both
 * relations, each department once. Nothing else counts, in particular not the
 * administrator role or the right to see all departments.
 *
 * @param account - The person's current account facts.
 */
export function planDepartments(
  account: Pick<AccountAccess, "departments" | "managedDepartments">,
): readonly string[] {
  return [...new Set([...account.departments, ...account.managedDepartments])];
}

/**
 * The department a plan or template created by a person belongs to.
 *
 * @param departments - The departments the person belongs to now, see {@link planDepartments}.
 * @returns The department of a person who belongs to exactly one, `null` for a
 * person with none or several distinct ones: no department is guessed for them.
 */
export function soleDepartment(departments: readonly string[]): string | null {
  const [only, ...others] = departments;
  return only !== undefined && others.length === 0 ? only : null;
}

/**
 * The owner, the department and the teams a plan is stored with.
 *
 * @param access - Resolves the department of a person.
 * @param userId - The person who saves.
 * @param previous - The stored plan, or `null` for a new one.
 * @returns A new plan belongs to its creator and to the creator's only
 * department, if there is exactly one, which is also its first team. A stored
 * plan keeps all of them, whoever saves it; they are never derived from the
 * person who saves again and change only by an explicit access change.
 */
export async function planOwnership(
  access: Pick<AgentPlanAccess, "team">,
  userId: string,
  previous: AgentPlanView | null,
): Promise<
  Required<Pick<AgentPlanView, "ownerId" | "departmentId" | "teams">>
> {
  if (previous)
    return {
      ownerId: previous.ownerId,
      departmentId: previous.departmentId ?? null,
      teams: previous.teams ?? [],
    };
  const { departmentId } = await access.team(userId, null);
  return {
    ownerId: userId,
    departmentId,
    teams: departmentId === null ? [] : [fullPlanTeam("department", departmentId)],
  };
}
