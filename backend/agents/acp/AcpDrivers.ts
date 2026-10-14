import { CLAUDE_ACP_DRIVER } from "./ClaudeAcpDriver";
import { CODEX_ACP_DRIVER } from "./CodexAcpDriver";

import type { AcpProviderId } from "@/definition/AgentConfiguration";
import type { AcpDriver } from "./AcpDriver";

const DRIVERS: Readonly<Record<AcpProviderId, AcpDriver>> = {
  codex_cli: CODEX_ACP_DRIVER,
  claude_code: CLAUDE_ACP_DRIVER,
};

/**
 * The driver of an ACP runner.
 *
 * @param provider - A Codex CLI or Claude Code connection.
 * @returns What differs between the adapters of the two runners.
 */
export function acpDriverFor(provider: AcpProviderId): AcpDriver {
  return DRIVERS[provider];
}
