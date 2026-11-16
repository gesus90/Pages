import { RUN_INSTANCE_VARIABLE } from "@/backend/agents/cli/CliProcessScan";

import { isStableVersionAtLeast } from "@/definition/AgentToolVersion";

import { pagesMcpServers } from "./AcpLaunch";

import type { Implementation } from "@agentclientprotocol/sdk";
import type { AcpLaunchSpecification } from "./AcpDriver";
import type { AcpLaunch } from "./AcpLaunch";
import type { CodexAcpProfile } from "./CodexAcpProfile";

/** The executable of the Codex ACP adapter, installed next to the Codex CLI. */
export const CODEX_ACP_BINARY = "codex-acp";

/** The package the adapter names itself with when it initializes. */
const CODEX_ACP_PACKAGE = "@agentclientprotocol/codex-acp";

/** The oldest codex-acp release whose session modes, options and MCP startup Pages implements. */
export const CODEX_ACP_MINIMUM_VERSION = "2.1.1";

/** How long a new session waits for its MCP servers before its first turn. */
const MCP_STARTUP_WAIT_MS = 30_000;

/**
 * Whether the adapter that answered `initialize` is one Pages supports.
 * @param agent - What the adapter reported about itself.
 * @returns `true` for a stable codex-acp release from 2.1.1 on; previews and
 * other agents are refused. A session additionally pins the exact version of
 * the generation the tool manager verified.
 */
export function isSupportedCodexAcp(
  agent: Implementation | null | undefined,
): agent is Implementation {
  return (
    agent?.name === CODEX_ACP_PACKAGE &&
    isStableVersionAtLeast(agent.version, CODEX_ACP_MINIMUM_VERSION)
  );
}

function sessionConfiguration(
  specification: AcpLaunchSpecification & { readonly profile: CodexAcpProfile },
): Readonly<Record<string, unknown>> {
  return { ...specification.profile.configuration };
}

/**
 * Builds the start of the adapter for one session.
 * @param specification - Instance, Codex CLI, mode profile and MCP access of the node.
 * @returns The variables of the adapter process and the Pages MCP server.
 * @remarks
 * The adapter runs the Codex CLI of the connection, so the session uses its
 * ChatGPT sign-in in the credential folder and nothing else. The MCP
 * credential travels in the `session/new` request over the input of the
 * adapter, never in an argument list. Every process of the session carries
 * the instance tag, so the closeout finds them.
 */
export function planCodexAcpLaunch(
  specification: AcpLaunchSpecification & { readonly profile: CodexAcpProfile },
): AcpLaunch {
  const { instanceId, mcp, profile } = specification;
  return {
    environment: {
      [RUN_INSTANCE_VARIABLE]: instanceId,
      CODEX_PATH: specification.runnerFile,
      CODEX_CONFIG: JSON.stringify(sessionConfiguration(specification)),
      INITIAL_AGENT_MODE: profile.sessionMode,
      NO_BROWSER: "1",
    },
    mcpServers: pagesMcpServers(mcp),
    sessionMeta: { mcpStartupAwaitTimeoutMs: MCP_STARTUP_WAIT_MS },
  };
}
