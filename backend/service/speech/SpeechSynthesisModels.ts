import { catalogModelChoice } from "@/definition/AgentModelChoice";
import { consumerModels } from "@/definition/AgentModelConsumers";
import { agentModelKey } from "@/definition/AgentPlanConfiguration";
import { isSpeechSynthesisModel } from "@/definition/SpeechSynthesis";

import { canUseAgentConnection } from "../agents/AgentConnectionAccess";
import {
  SPEECH_SYNTHESIS_SIMULATION_CONNECTION,
  SPEECH_SYNTHESIS_SIMULATION_MODEL,
  SPEECH_SYNTHESIS_SIMULATION_VOICES,
} from "./SpeechSynthesisSimulation";

import type { AgentViewer } from "@/backend/auth/AgentProfilePolicy";
import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { AgentConnectionRecord } from "@/backend/database/repositories/agent/AgentConnectionRows";
import type { AgentCatalogModel } from "@/definition/AgentModelCatalog";
import type { PageAgentModel } from "@/definition/PageAgent";
import type { SpeechModelSelection } from "@/definition/SpeechRecognition";
import type { SpeechSynthesisSimulationMode } from "./SpeechSynthesisSimulation";

/** A speech output model of the instance with what running it needs. */
export interface SpeechSynthesisModelEntry {
  readonly choice: PageAgentModel;
  /** The stored connection; `null` for the simulation. */
  readonly connection: AgentConnectionRecord | null;
  /** The voice IDs its catalog lists; `null` where it lists none. */
  readonly voices: readonly string[] | null;
}

/** Where the speech output models are read from. */
export interface SpeechSynthesisModelSource {
  readonly connections: AgentConnectionRepository;
  /** Whether the development simulation offers its model, and with which voices. */
  readonly simulation: SpeechSynthesisSimulationMode;
}

// The shared choice hides models whose stated modalities rule out chatting;
// speaking text aloud is exactly what such a model is listed for here. The
// shared choice already marks it as a speech output model.
function speechOutputChoice(
  connection: AgentConnectionRecord,
  model: AgentCatalogModel,
): PageAgentModel {
  return {
    ...catalogModelChoice(connection, model),
    isChatCapable: undefined,
    isSpeechOutputCapable: true,
  };
}

async function openRouterEntries(
  connections: AgentConnectionRepository,
  connection: AgentConnectionRecord,
): Promise<readonly SpeechSynthesisModelEntry[]> {
  const catalog = await connections.catalogs().find(connection.id);
  const failure = catalog.errorCode ? { isCatalogFailed: true } : {};
  return catalog.models.filter(isSpeechSynthesisModel).map((model) => ({
    choice: { ...speechOutputChoice(connection, model), ...failure },
    connection,
    voices: model.supportedVoices ?? null,
  }));
}

function simulationEntry(
  mode: SpeechSynthesisSimulationMode,
): SpeechSynthesisModelEntry {
  return {
    choice: {
      id: agentModelKey(
        SPEECH_SYNTHESIS_SIMULATION_CONNECTION,
        SPEECH_SYNTHESIS_SIMULATION_MODEL,
      ),
      connectionId: SPEECH_SYNTHESIS_SIMULATION_CONNECTION,
      name: "Simulation TTS",
      modelName: "Simulation TTS",
      connectionName: "Simulation",
      location: "local",
      model: SPEECH_SYNTHESIS_SIMULATION_MODEL,
      reasoning: "none",
      reasoningEfforts: [],
      catalogDefaultReasoningEffort: null,
      reasoningEffort: null,
      provider: "openrouter",
      isFree: true,
      isSimulation: true,
      isSpeechOutputCapable: true,
    },
    connection: null,
    voices:
      mode.scenario === "no_voices" ? null : SPEECH_SYNTHESIS_SIMULATION_VOICES,
  };
}

// Only OpenRouter's API offers speech output; CLI tools and other APIs offer none.
function isSpeechOutputConnection(connection: AgentConnectionRecord): boolean {
  return (
    connection.isActive &&
    connection.hasApiKey &&
    connection.provider === "openrouter"
  );
}

/**
 * Lists the speech output models of the instance (PAGE-300).
 *
 * @param source - The stored connections and the simulation switch.
 * @param viewer - The administrator who chooses; `null` when Pages speaks for
 * the instance, which no connection scope limits.
 * @returns The models the central rule of `tts` keeps, the simulation last.
 *
 * @remarks
 * Only a model whose stored OpenRouter catalog states `speech` among its
 * outputs ({@link isSpeechSynthesisModel}) is listed. No provider is called.
 */
export async function listSpeechSynthesisModels(
  source: SpeechSynthesisModelSource,
  viewer: AgentViewer | null,
): Promise<readonly SpeechSynthesisModelEntry[]> {
  const entries: SpeechSynthesisModelEntry[] = [];
  for (const connection of await source.connections.list()) {
    if (!isSpeechOutputConnection(connection)) continue;
    if (
      viewer !== null &&
      !(await canUseAgentConnection(source.connections, viewer, connection.id))
    )
      continue;
    entries.push(...(await openRouterEntries(source.connections, connection)));
  }
  if (source.simulation.isActive)
    entries.push(simulationEntry(source.simulation));
  const allowed = new Set(
    consumerModels(
      "tts",
      entries.map((entry) => entry.choice),
    ).map((choice) => choice.id),
  );
  return entries.filter((entry) => allowed.has(entry.choice.id));
}

/**
 * Finds the entry of a saved choice.
 *
 * @param entries - The listed speech output models.
 * @param selection - The saved choice; `null` without one.
 * @returns The entry, or `null` when the choice is not listed.
 */
export function findSpeechSynthesisModel(
  entries: readonly SpeechSynthesisModelEntry[],
  selection: SpeechModelSelection | null,
): SpeechSynthesisModelEntry | null {
  if (selection === null) return null;
  return (
    entries.find(
      (entry) =>
        entry.choice.connectionId === selection.connectionId &&
        entry.choice.model === selection.model,
    ) ?? null
  );
}
