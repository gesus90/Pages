import { acpRunOptions } from "@/definition/AgentConfiguration";

import { picaAcpRunner } from "./PicaAcpRunners";

import type { ResolvedAgentAssignment } from "@/backend/service/agents/AgentAssignmentResolution";
import type { AgentEmployeeAccess } from "@/definition/AgentEmployee";
import type { PicaAcpProvider, PicaAcpRunner } from "./PicaAcpRunners";

/**
 * Whether a session of the employee reaches its Pages tools over Pica's
 * turn-bound bridge as its one MCP server.
 *
 * @remarks
 * Claude Code always uses the Pages helper and Antigravity always the bridge.
 * The native Pica builds of Codex and OpenCode refuse every built-in tool, so
 * full access runs their stock runner and reaches the Pages tools over the
 * bridge instead.
 */
function hasEmployeeBridgeMcp(
  provider: PicaAcpProvider,
  access: AgentEmployeeAccess,
): boolean {
  if (provider === "claude_code") return false;
  return provider === "antigravity" || access === "yolo";
}

/**
 * The runner of one job of an agent employee.
 *
 * @param agent - The assignment resolved from the agent's model.
 * @param access - The access the agent is stored with; every chat runner
 * runs both, full access inside the isolation with every native tool.
 * @returns Pica's runner of the provider, with a profile of its own per
 * access, so a session of one access is never continued with the other,
 * and the run options of the access.
 * @throws {ChatError} `acpProviderUnsupported` for a provider without a chat
 * adapter.
 */
export function employeeAcpRunner(
  agent: ResolvedAgentAssignment,
  access: AgentEmployeeAccess,
): PicaAcpRunner {
  const base = picaAcpRunner(agent);
  const options = acpRunOptions(access, 0);
  return {
    ...base,
    profile: `employee-${base.provider}-${access}-1`,
    hasBridgeMcp: hasEmployeeBridgeMcp(base.provider, access),
    runOptions: () => options,
  };
}
