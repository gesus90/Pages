import { RUN_INSTANCE_VARIABLE } from "@/backend/agents/cli/CliProcessScan";

import type { Implementation, McpServerStdio } from "@agentclientprotocol/sdk";
import type { CliSessionMcp } from "@/backend/agents/cli/CliSessionPlans";
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

/** The name of the Pages MCP server in every session. */
export const PAGES_MCP_SERVER = "pages";

/** How long a new session waits for its MCP servers before its first turn. */
const MCP_STARTUP_WAIT_MS = 30_000;

/** What starting the adapter for one session needs; nothing of it is free user input. */
export interface CodexAcpLaunchSpecification {
  readonly instanceId: string;
  /** The Codex CLI of the connection, which holds its ChatGPT sign-in. */
  readonly codexFile: string;
  readonly profile: CodexAcpProfile;
  readonly mcp: CliSessionMcp | null;
}

/** The environment of the adapter process and the MCP servers of its session. */
export interface CodexAcpLaunch {
  readonly environment: Readonly<Record<string, string>>;
  readonly mcpServers: readonly McpServerStdio[];
  /** Extension data of `session/new`: the session waits for its MCP servers. */
  readonly sessionMeta: Readonly<Record<string, unknown>>;
}

function readVersion(text: string): readonly number[] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(text);
  return match ? match.slice(1).map(Number) : null;
}

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
  const version = readVersion(agent.version);
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
  specification: CodexAcpLaunchSpecification,
): CodexAcpLaunch {
  const { instanceId, mcp, profile } = specification;
  return {
    environment: {
      [RUN_INSTANCE_VARIABLE]: instanceId,
      CODEX_PATH: specification.codexFile,
      CODEX_CONFIG: JSON.stringify(profile.configuration),
      INITIAL_AGENT_MODE: profile.sessionMode,
      NO_BROWSER: "1",
    },
    mcpServers:
      mcp === null
        ? []
        : [
            {
              name: PAGES_MCP_SERVER,
              command: mcp.node,
              args: [mcp.bundle],
              env: [
                { name: "PAGES_URL", value: mcp.url },
                { name: "PAGES_TOKEN", value: mcp.token },
                { name: RUN_INSTANCE_VARIABLE, value: instanceId },
              ],
            },
          ],
    sessionMeta: { mcpStartupAwaitTimeoutMs: MCP_STARTUP_WAIT_MS },
  };
}
