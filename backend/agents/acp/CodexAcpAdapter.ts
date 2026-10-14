import { RUN_INSTANCE_VARIABLE } from "@/backend/agents/cli/CliProcessScan";

import { pagesMcpServers, readAdapterVersion } from "./AcpLaunch";

import type { Implementation } from "@agentclientprotocol/sdk";
import type { AcpLaunchSpecification } from "./AcpDriver";
import type { AcpLaunch } from "./AcpLaunch";
import type { CodexAcpProfile } from "./CodexAcpProfile";

/** The executable of the Codex ACP adapter, installed next to the Codex CLI. */
export const CODEX_ACP_BINARY = "codex-acp";

/** The package the adapter names itself with when it initializes. */
const CODEX_ACP_PACKAGE = "@agentclientprotocol/codex-acp";

/**
 * The adapter versions whose session modes, configuration options and MCP
 * startup Pages verified: 2.1.1 up to the next major version.
 */
const SUPPORTED_VERSIONS = {
  minimum: [2, 1, 1],
  major: 2,
} as const;

/** How long a new session waits for its MCP servers before its first turn. */
const MCP_STARTUP_WAIT_MS = 30_000;

/**
 * Whether the adapter that answered `initialize` is one Pages verified.
 *
 * @param agent - What the adapter reported about itself.
 * @returns `true` for codex-acp from 2.1.1 below 3.0.0; previews and other
 * agents are refused.
 */
export function isSupportedCodexAcp(
  agent: Implementation | null | undefined,
): agent is Implementation {
  if (agent?.name !== CODEX_ACP_PACKAGE) return false;
  const version = readAdapterVersion(agent.version);
  if (version === null || version[0] !== SUPPORTED_VERSIONS.major) return false;
  for (const [index, minimum] of SUPPORTED_VERSIONS.minimum.entries()) {
    if (version[index] !== minimum) return version[index] > minimum;
  }
  return true;
}

/**
 * Builds the start of the adapter for one session.
 *
 * @param specification - Instance, Codex CLI, mode profile and MCP access of the node.
 * @returns The variables of the adapter process and the Pages MCP server.
 *
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
      CODEX_CONFIG: JSON.stringify(profile.configuration),
      INITIAL_AGENT_MODE: profile.sessionMode,
      NO_BROWSER: "1",
    },
    mcpServers: pagesMcpServers(instanceId, mcp),
    sessionMeta: { mcpStartupAwaitTimeoutMs: MCP_STARTUP_WAIT_MS },
  };
}
