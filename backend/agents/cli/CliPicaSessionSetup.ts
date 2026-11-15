import { AgentError } from "@/backend/error/AgentErrors";
import { picaNativeRunner } from "./CliAcpLaunch";
import {
  preparePicaCodexBundle,
  requirePicaCodexProfile,
} from "./PicaCodexBundle";
import { requirePicaNativeArtifact } from "./PicaNativeArtifact";

import type { AgentPlanSessionInput } from "@/backend/agents/AgentPlanExecution";
import type { AcpDriver } from "@/backend/agents/acp/AcpDriver";
import type { AcpLaunch } from "@/backend/agents/acp/AcpLaunch";
import type { PicaCodexBundle } from "./PicaCodexBundle";
import type { PicaNativeArtifact } from "./PicaNativeArtifact";

export { acpPicaSupport } from "@/backend/agents/acp/AcpPicaSupport";

/** Prepares the Codex bundle a Pica chat over Codex runs; `null` for every other session. */
export function picaCodexBundle(
  picaNative: PicaNativeArtifact | null,
  directory: string,
  adapter: string,
): PicaCodexBundle | null {
  return picaNative?.runner === "codex"
    ? preparePicaCodexBundle(directory, adapter, picaNative.directory)
    : null;
}

/**
 * Selects the native build that gives a Pica chat its Pages-only tools.
 *
 * @remarks
 * Codex and OpenCode offer no tool surface without MCP that Pages can use
 * through the stock runner. Pica therefore starts only the verified native
 * build, which refuses every built-in tool; without one the chat is refused.
 * An agent employee with full access needs those tools, so its chat runs
 * the stock runner inside the isolation and reaches the Pages tools over
 * Pica's bridge.
 */
export function selectPicaNativeArtifact(options: {
  readonly driver: AcpDriver;
  readonly input: AgentPlanSessionInput;
  readonly launch: AcpLaunch;
  readonly profile: ReturnType<AcpDriver["profile"]>;
  readonly toolsDirectory?: string;
}): PicaNativeArtifact | null {
  const { driver, input, launch, profile, toolsDirectory } = options;
  const runner = picaNativeRunner(driver.provider);
  if (!input.chat || runner === null || profile.mode === "yolo") return null;
  if (!input.chat.listener.picaCodex || launch.mcpServers.length > 0)
    throw new AgentError(driver.errors.adapterUnsupported);
  if (runner === "codex") requirePicaCodexProfile(profile);
  return requirePicaNativeArtifact(toolsDirectory, runner);
}
