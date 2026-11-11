import { acpRunOptions } from "@/definition/AgentConfiguration";
import { hasHostTools } from "@/definition/AgentEmployee";

import { picaAcpRunner } from "./PicaAcpRunners";

import type { McpServer } from "@agentclientprotocol/sdk";
import type { ResolvedAgentAssignment } from "@/backend/service/agents/AgentAssignmentResolution";
import type { AcpPermissionMode } from "@/definition/AgentConfiguration";
import type { AgentEmployeeAccess } from "@/definition/AgentEmployee";
import type { PicaAcpProvider, PicaAcpRunner } from "./PicaAcpRunners";

/**
 * The run mode of the runner for an access level (PAGE-303).
 *
 * @remarks
 * "Nur Pages" runs in "Nur Lesen", where the runner offers nothing but the
 * Pages tools and Pages refuses every other request. "Arbeitsplatz" and
 * YOLO both run the runner without an approval step; they differ only in
 * the isolation the session starts in.
 */
export function employeeRunMode(
  access: AgentEmployeeAccess,
): AcpPermissionMode {
  return hasHostTools(access) ? "yolo" : "read_only";
}

/**
 * Whether a session of the employee reaches its Pages tools over Pica's
 * turn-bound bridge as one of its MCP servers.
 *
 * @remarks
 * Claude Code always uses the Pages helper and Antigravity always the bridge.
 * The native Pica builds of Codex and OpenCode refuse every built-in tool, so
 * host tools run their stock runner and reach the Pages tools over the
 * bridge instead.
 */
function hasEmployeeBridgeMcp(
  provider: PicaAcpProvider,
  access: AgentEmployeeAccess,
): boolean {
  if (provider === "claude_code") return false;
  return provider === "antigravity" || hasHostTools(access);
}

/**
 * The runner of one job of an agent employee.
 *
 * @param agent - The assignment resolved from the agent's model.
 * @param access - The access level the agent is stored with.
 * @param hostMcpServers - The MCP servers configured on the host for the
 * agent's CLI; only "Arbeitsplatz" and YOLO pass any.
 * @returns Pica's runner of the provider, with a profile of its own per
 * level, so a session of one level is never continued with another, the
 * run options of the level, the host servers and, for YOLO, the start
 * without isolation.
 * @throws {ChatError} `acpProviderUnsupported` for a provider without a chat
 * adapter.
 */
export function employeeAcpRunner(
  agent: ResolvedAgentAssignment,
  access: AgentEmployeeAccess,
  hostMcpServers: readonly McpServer[] = [],
): PicaAcpRunner {
  const base = picaAcpRunner(agent);
  const options = acpRunOptions(employeeRunMode(access), 0);
  return {
    ...base,
    profile: `employee-${base.provider}-${access}-1`,
    hasBridgeMcp: hasEmployeeBridgeMcp(base.provider, access),
    hostMcpServers: hasHostTools(access) ? hostMcpServers : [],
    isUnisolated: access === "yolo",
    runOptions: () => options,
  };
}
