import { RUN_INSTANCE_VARIABLE } from "@/backend/agents/cli/CliProcessScan";

import { isStableVersionAtLeast } from "@/definition/AgentToolVersion";

import { pagesMcpServers } from "./AcpLaunch";

import type { Implementation } from "@agentclientprotocol/sdk";
import type { AcpLaunchSpecification } from "./AcpDriver";
import type { AcpLaunch } from "./AcpLaunch";
import type { ClaudeAcpProfile } from "./ClaudeAcpProfile";

/** The executable of the Claude ACP adapter, installed next to the Claude CLI. */
export const CLAUDE_ACP_BINARY = "claude-agent-acp";

/** The largest output Claude Code keeps of one command: 128 KiB, above one escaped read chunk. */
const HELPER_OUTPUT_LIMIT = 131_072;

/** The package the adapter names itself with when it initializes. */
const CLAUDE_ACP_PACKAGE = "@agentclientprotocol/claude-agent-acp";

/**
 * The oldest claude-agent-acp release whose modes, configuration options,
 * tool restriction and MCP handling Pages implements.
 * @remarks
 * A newer release is accepted only after the tool manager's protocol check
 * passed with the CLI it runs with; a session then pins that exact version.
 */
export const CLAUDE_ACP_MINIMUM_VERSION = "0.90.0";

/**
 * Whether the adapter that answered `initialize` is one Pages supports.
 * @param agent - What the adapter reported about itself.
 * @returns `true` for a stable claude-agent-acp release from 0.90.0 on;
 * previews and other agents are refused. A session additionally pins the
 * exact version of the generation the tool manager verified.
 */
export function isSupportedClaudeAcp(
  agent: Implementation | null | undefined,
): agent is Implementation {
  return (
    agent?.name === CLAUDE_ACP_PACKAGE &&
    isStableVersionAtLeast(agent.version, CLAUDE_ACP_MINIMUM_VERSION)
  );
}

/**
 * Builds the start of the adapter for one session.
 * @param specification - Instance, Claude CLI, mode profile and MCP access of the node.
 * @returns The variables of the adapter process, the Pages MCP server and the
 * Claude options of the session.
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
      // A helper result holds up to one read chunk of JSON; the default cut would hide its end.
      ...(specification.purpose === "chat"
        ? { BASH_MAX_OUTPUT_LENGTH: String(HELPER_OUTPUT_LIMIT) }
        : {}),
    },
    mcpServers: pagesMcpServers(mcp),
    sessionMeta: {
      claudeCode: {
        options: profile.options,
        ...((specification.purpose ?? "plan") === "plan"
          ? { emitRawSDKMessages: [{ type: "assistant" }, { type: "result" }] }
          : {}),
      },
    },
  };
}
