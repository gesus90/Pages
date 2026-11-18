import { isStableVersionAtLeast } from "@/definition/AgentToolVersion";

import type { Implementation } from "@agentclientprotocol/sdk";
import type { CliHome } from "@/backend/agents/cli/CliContracts";

/** The oldest Antigravity CLI whose official `agy acp` entry point Pages implements. */
export const ANTIGRAVITY_MINIMUM_VERSION = "1.5.9";

/** The name `agy acp` reports in its `initialize` answer. */
export const ANTIGRAVITY_AGENT_NAME = "Antigravity ACP Server";

/** The application data folder of a connection, below its own config directory. */
export const ANTIGRAVITY_APP_DATA_DIRECTORY = "antigravity-acp";

/**
 * The application data folder `agy --print` reads below `$HOME/.gemini`.
 * @remarks
 * Print mode has no flag for another folder, so a print-mode command sees
 * the connection's {@link ANTIGRAVITY_APP_DATA_DIRECTORY} under this name.
 */
export const ANTIGRAVITY_PRINT_DATA_DIRECTORY = "antigravity-cli";

/** The file the CLI keeps a Google sign-in in; Pages checks only that it exists. */
export const ANTIGRAVITY_TOKEN_FILE = "antigravity-oauth-token";

/**
 * The select option of `agy acp` that carries a model's thinking level.
 * @remarks
 * The official entry point names it `thought_level` and refuses
 * `thinking_level` as an unknown option. It appears after a model is
 * selected, and each model offers its own levels.
 */
export const ANTIGRAVITY_EFFORT_OPTION = "thought_level";

/**
 * The arguments of the official ACP entry point for one connection context.
 * @param home - The connection's isolated context.
 * @returns `agy acp` with its Gemini and application folders inside that
 * context, so no personal `~/.gemini` login or setting is read.
 */
export function antigravityAcpArguments(home: CliHome): readonly string[] {
  return [
    "acp",
    `--gemini-dir=${home.config}`,
    `--app-data-dir=${ANTIGRAVITY_APP_DATA_DIRECTORY}`,
    "--disable-telemetry",
  ];
}

/**
 * Whether `initialize` came from the official ACP entry point of a supported CLI.
 * @param agent - What the CLI reported about itself.
 * @returns `true` for a stable release at or above the minimum; previews and
 * other agents are refused.
 */
export function isSupportedAntigravityAcp(
  agent: Implementation | null | undefined,
): agent is Implementation {
  return (
    agent?.name === ANTIGRAVITY_AGENT_NAME &&
    isStableVersionAtLeast(agent.version, ANTIGRAVITY_MINIMUM_VERSION)
  );
}
