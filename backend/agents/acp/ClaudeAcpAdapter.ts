import { RUN_INSTANCE_VARIABLE } from "@/backend/agents/cli/CliProcessScan";

import { pagesMcpServers, readAdapterVersion } from "./AcpLaunch";

import type { Implementation } from "@agentclientprotocol/sdk";
import type { AcpLaunchSpecification } from "./AcpDriver";
import type { AcpLaunch } from "./AcpLaunch";
import type { ClaudeAcpProfile } from "./ClaudeAcpProfile";

/** The executable of the Claude ACP adapter, installed next to the Claude CLI. */
export const CLAUDE_ACP_BINARY = "claude-agent-acp";

/** The package the adapter names itself with when it initializes. */
const CLAUDE_ACP_PACKAGE = "@agentclientprotocol/claude-agent-acp";

/**
 * The adapter versions whose modes, configuration options, tool restriction
 * and MCP handling Pages verified: the 0.90 line. A 0.x release may change its
 * protocol surface with any minor version, so the next minor is not accepted
 * before it was verified.
 */
const SUPPORTED_VERSIONS = { major: 0, minor: 90 } as const;

/**
 * Whether the adapter that answered `initialize` is one Pages verified.
 *
 * @param agent - What the adapter reported about itself.
 * @returns `true` for claude-agent-acp 0.90.x; previews and other agents are
 * refused.
 */
export function isSupportedClaudeAcp(
  agent: Implementation | null | undefined,
): agent is Implementation {
  if (agent?.name !== CLAUDE_ACP_PACKAGE) return false;
  const version = readAdapterVersion(agent.version);
  return (
    version !== null &&
    version[0] === SUPPORTED_VERSIONS.major &&
    version[1] === SUPPORTED_VERSIONS.minor
  );
}

/**
 * Builds the start of the adapter for one session.
 *
 * @param specification - Instance, Claude CLI, mode profile and MCP access of the node.
 * @returns The variables of the adapter process, the Pages MCP server and the
 * Claude options of the session.
 *
 * @remarks
 * The adapter runs the Claude CLI of the connection, so the session uses its
 * sign-in in the credential folder and nothing else; the CLI that the adapter
 * packages is never used. The CLI keeps the exact model it was asked for: its
 * automatic fallback and the remap of retired model names are switched off.
 * Auto memory is off so no earlier run leaks into the prompt. The MCP
 * credential travels in the `session/new` request over the input of the
 * adapter, never in an argument list, and every process of the session
 * carries the instance tag.
 */
export function planClaudeAcpLaunch(
  specification: AcpLaunchSpecification & {
    readonly profile: ClaudeAcpProfile;
  },
): AcpLaunch {
  const { instanceId, mcp, profile } = specification;
  return {
    environment: {
      [RUN_INSTANCE_VARIABLE]: instanceId,
      CLAUDE_CODE_EXECUTABLE: specification.runnerFile,
      CLAUDE_CODE_DISABLE_MODEL_ACCESS_FALLBACK: "1",
      CLAUDE_CODE_DISABLE_LEGACY_MODEL_REMAP: "1",
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
    },
    mcpServers: pagesMcpServers(instanceId, mcp),
    sessionMeta: {
      claudeCode: {
        options: {
          ...profile.options,
          ...(specification.notesDirectory
            ? { additionalDirectories: [specification.notesDirectory] }
            : {}),
        },
      },
    },
  };
}
