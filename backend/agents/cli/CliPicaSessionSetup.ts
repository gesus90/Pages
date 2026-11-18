import { PICA_CODEX_ADAPTER_VERSION } from "@/backend/agents/acp/PicaCodexAdapterPatch";
import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import { picaNativeRunner } from "./CliAcpLaunch";
import {
  preparePicaCodexBundle,
  requirePicaCodexProfile,
} from "./PicaCodexBundle";
import { requirePicaNativeArtifact } from "./PicaNativeArtifact";

import type { AgentPlanSessionInput } from "@/backend/agents/AgentPlanExecution";
import type { AcpDriver } from "@/backend/agents/acp/AcpDriver";
import type { AcpLaunch } from "@/backend/agents/acp/AcpLaunch";
import type { AgentToolLocation } from "@/backend/service/agents/tools/AgentToolContracts";
import type { PicaCodexBundle } from "./PicaCodexBundle";
import type { PicaNativeArtifact } from "./PicaNativeArtifact";

export { acpPicaSupport } from "@/backend/agents/acp/AcpPicaSupport";

/** Prepares the Codex bundle a Pica chat over Codex runs; `null` for every other session. */
export async function picaCodexBundle(
  picaNative: PicaNativeArtifact | null,
  directory: string,
  adapter: {
    readonly file: string;
    readonly version?: string | null;
    readonly retained?: () => Promise<AgentToolLocation | null>;
  },
): Promise<PicaCodexBundle | null> {
  if (picaNative?.runner !== "codex") return null;
  try {
    let file = adapter.file;
    if (adapter.version && adapter.version !== PICA_CODEX_ADAPTER_VERSION) {
      const retained = await adapter.retained?.();
      if (retained?.version !== PICA_CODEX_ADAPTER_VERSION)
        throw new AgentError("pica_codex_adapter_unavailable");
      file = retained.file;
    }
    return preparePicaCodexBundle(directory, file, picaNative.directory);
  } catch (error: unknown) {
    logCaughtError("CliPicaSessionSetup", error);
    throw new AgentError("pica_codex_adapter_unavailable");
  }
}

/**
 * Selects the native build that gives a Pica chat its Pages-only tools.
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
