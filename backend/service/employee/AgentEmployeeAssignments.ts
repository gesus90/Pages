import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import { logCaughtError } from "@/backend/logging/Logger";
import { acpRunOptions } from "@/definition/AgentConfiguration";

import { employeeRunMode } from "../chat/acp/EmployeeAcpRunners";

import type { StoredAgentEmployee } from "@/backend/database/repositories/employee/AgentEmployeeRepository";
import type { ResolvedAgentAssignment } from "../agents/AgentAssignmentResolution";
import type {
  AgentEmployeeSessionDependencies,
  AgentJobRequest,
} from "./AgentEmployeeSessionTypes";

/**
 * The model and the run options a job answers with: the model of
 * {@link resolveAgentModel} and the run mode of the employee's access level.
 *
 * @param models - The model resolver of the employee sessions.
 * @param employee - The stored employee the job runs for.
 * @param override - The model the job asks for, when it has one.
 */
export async function employeeAssignment(
  models: AgentEmployeeSessionDependencies["models"],
  employee: StoredAgentEmployee,
  override: AgentJobRequest["modelOverride"],
): Promise<ResolvedAgentAssignment> {
  const resolved = await resolveAgentModel(models, employee, override);
  return {
    ...resolved,
    run: acpRunOptions(employeeRunMode(employee.access), 0),
  };
}

/**
 * The model an employee answers with. A job's model override is tried first;
 * when it cannot be resolved, the employee's own model answers.
 */
export async function resolveAgentModel(
  models: AgentEmployeeSessionDependencies["models"],
  employee: StoredAgentEmployee,
  override: AgentJobRequest["modelOverride"],
): Promise<ResolvedAgentAssignment> {
  if (!override) return models.resolve(employee);
  try {
    return await models.resolve({
      ...employee,
      connectionId: override.connectionId,
      model: override.model,
      reasoningEffort: null,
    });
  } catch (error: unknown) {
    if (!(error instanceof AgentEmployeeError)) throw error;
    logCaughtError("AgentEmployeeSessions", error);
    return models.resolve(employee);
  }
}

/** The job title and the role of an agent, as its instruction names them. */
export async function agentIdentity(
  dependencies: Pick<
    AgentEmployeeSessionDependencies,
    "authorization" | "store"
  >,
  agentId: string,
): Promise<{
  readonly position: string | null;
  readonly roleName: string | null;
}> {
  const [snapshot, titles] = await Promise.all([
    dependencies.authorization.snapshot(),
    dependencies.store.identities().jobTitles(),
  ]);
  const account = snapshot.accounts.find(
    (candidate) => candidate.userId === agentId,
  );
  return {
    position: titles.get(agentId) ?? null,
    roleName: account?.role?.name ?? null,
  };
}
