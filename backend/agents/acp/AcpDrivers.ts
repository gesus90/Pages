import { CLAUDE_ACP_DRIVER } from "./ClaudeAcpDriver";
import { CODEX_ACP_DRIVER } from "./CodexAcpDriver";
import { OPENCODE_ACP_DRIVER } from "./OpenCodeAcpDriver";

import type { NativeAcpProviderId } from "@/definition/AgentConfiguration";
import type { AcpDriver } from "./AcpDriver";

const DRIVERS: Readonly<Record<NativeAcpProviderId, AcpDriver>> = {
  codex_cli: CODEX_ACP_DRIVER,
  claude_code: CLAUDE_ACP_DRIVER,
  opencode: OPENCODE_ACP_DRIVER,
};

/**
 * The driver of an ACP runner.
 *
 * @param provider - A native ACP runner, shared by plans and Pica.
 * @returns What differs between the runners' verified ACP contracts.
 */
export function acpDriverFor(provider: NativeAcpProviderId): AcpDriver {
  return DRIVERS[provider];
}
