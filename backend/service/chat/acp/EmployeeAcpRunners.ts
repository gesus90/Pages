import { ChatError } from "@/backend/error/ChatErrors";
import { acpRunOptions } from "@/definition/AgentConfiguration";
import { employeeAccessModes } from "@/definition/AgentEmployee";

import { picaAcpRunner } from "./PicaAcpRunners";

import type { ResolvedAgentAssignment } from "@/backend/service/agents/AgentAssignmentResolution";
import type { AgentEmployeeAccess } from "@/definition/AgentEmployee";
import type { PicaAcpRunner } from "./PicaAcpRunners";

/**
 * The runner of one job of an agent employee.
 *
 * @param agent - The assignment resolved from the agent's model.
 * @param access - The access the agent is stored with.
 * @returns Pica's runner of the provider, with a profile of its own per
 * access, so a session of one access is never continued with the other,
 * and the run options of the access.
 * @throws {ChatError} `acpProviderUnsupported` for a provider without a chat
 * adapter, `acpPermissionModeUnsupported` for full access where the provider
 * does not run it.
 */
export function employeeAcpRunner(
  agent: ResolvedAgentAssignment,
  access: AgentEmployeeAccess,
): PicaAcpRunner {
  const base = picaAcpRunner(agent);
  if (!employeeAccessModes(base.provider).includes(access))
    throw new ChatError("acpPermissionModeUnsupported");
  const options = acpRunOptions(access, 0);
  return {
    ...base,
    profile: `employee-${base.provider}-${access}-1`,
    runOptions: () => options,
  };
}
