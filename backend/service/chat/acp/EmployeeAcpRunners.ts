import {
  agentAccessSessionProfile,
  effectiveAgentAccess,
} from "@/definition/AgentAccessMode";
import { acpRunOptions } from "@/definition/AgentConfiguration";
import { employeeAccessMode } from "@/definition/AgentEmployee";
import { ChatError } from "@/backend/error/ChatErrors";

import { picaAcpRunner } from "./PicaAcpRunners";

import type { McpServer } from "@agentclientprotocol/sdk";
import type { ResolvedAgentAssignment } from "@/backend/service/agents/AgentAssignmentResolution";
import type { AcpPermissionMode } from "@/definition/AgentConfiguration";
import type { AgentEmployeeAccess } from "@/definition/AgentEmployee";
import type { PicaAcpProvider, PicaAcpRunner } from "./PicaAcpRunners";

/**
 * The run mode of the runner for an access level: the same two modes as for
 * plan nodes and swarms.
 * @throws {ChatError} `accessModeRequired` for the earlier `workspace`,
 * which never runs until "Lesend" or "YOLO" is chosen.
 */
export function employeeRunMode(
  access: AgentEmployeeAccess,
): AcpPermissionMode {
  const mode = employeeAccessMode(access);
  if (mode === null) throw new ChatError("accessModeRequired");
  return mode;
}

/**
 * Whether a session of the employee reaches its Pages tools over Pica's
 * turn-bound bridge as one of its MCP servers.
 * @remarks
 * Claude Code always uses the Pages helper and Antigravity always the bridge.
 * The native Pica builds of Codex and OpenCode refuse every built-in tool, so
 * YOLO runs their stock runner and reaches the Pages tools over the bridge
 * instead.
 */
function hasEmployeeBridgeMcp(
  provider: PicaAcpProvider,
  mode: AcpPermissionMode,
): boolean {
  if (provider === "claude_code") return false;
  return provider === "antigravity" || mode === "yolo";
}

/**
 * The runner of one job of an agent employee, in a chat or in a run of its own.
 * @param agent - The assignment resolved from the agent's model.
 * @param access - The access level the agent is stored with.
 * @param hostMcpServers - The MCP servers configured on the host for the
 * agent's CLI; only YOLO passes any, see {@link effectiveAgentAccess}.
 * @returns Pica's runner of the provider, with a profile of its own per mode
 * and policy version, so a session of one mode is never continued with
 * another, the run options of the mode and the host servers. A YOLO session
 * starts natively on the host like every YOLO plan node.
 * @throws {ChatError} `acpProviderUnsupported` for a provider without a chat
 * adapter, `accessModeRequired` for the earlier `workspace`.
 */
export function employeeAcpRunner(
  agent: ResolvedAgentAssignment,
  access: AgentEmployeeAccess,
  hostMcpServers: readonly McpServer[] = [],
): PicaAcpRunner {
  const base = picaAcpRunner(agent);
  const mode = employeeRunMode(access);
  const options = acpRunOptions(mode, 0);
  return {
    ...base,
    profile: agentAccessSessionProfile(`employee-${base.provider}`, mode),
    // A kept employee session continues in the pool, which tells the turn what the session already knows.
    canResumeSession: true,
    hasBridgeMcp: hasEmployeeBridgeMcp(base.provider, mode),
    hostMcpServers: effectiveAgentAccess(mode).hostMcpServers
      ? hostMcpServers
      : [],
    runOptions: () => options,
  };
}
