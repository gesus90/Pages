import { catalogModelChoice } from "@/definition/AgentModelChoice";
import { consumerModels } from "@/definition/AgentModelConsumers";
import { agentModelKey } from "@/definition/AgentPlanConfiguration";

import { canUseAgentConnection } from "../agents/AgentConnectionAccess";
import {
  SPEECH_SIMULATION_CONNECTION,
  SPEECH_SIMULATION_MODEL,
  SPEECH_SIMULATION_SHORT_LIMIT_MS,
} from "./SpeechSimulation";

import type { AgentViewer } from "@/backend/auth/AgentProfilePolicy";
import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { AgentConnectionRecord } from "@/backend/database/repositories/agent/AgentConnectionRows";
import type { AgentCatalogModel } from "@/definition/AgentModelCatalog";
import type { PageAgentModel } from "@/definition/PageAgent";
import type { SpeechModelSelection } from "@/definition/SpeechRecognition";
import type { SpeechSimulationMode } from "./SpeechSimulation";

/**
 * Z.AI's speech recognition model.
 *
 * @remarks
 * Z.AI's model listing names no capabilities, so this documented entry is
 * the one place in Pages that names its recognition model
 * (https://docs.z.ai/guides/audio/glm-asr-2512): WAV and MP3, at most 30
 * seconds and 25 MB per recording, through
 * `POST https://api.z.ai/api/paas/v4/audio/transcriptions`.
 */
export const ZAI_SPEECH_MODEL = {
  id: "glm-asr-2512",
  name: "GLM-ASR-2512",
  maxDurationMs: 30_000,
} as const;

/** A speech model of the instance with what running it needs. */
export interface SpeechModelEntry {
  readonly choice: PageAgentModel;
  /** The stored connection; `null` for the simulation. */
  readonly connection: AgentConnectionRecord | null;
  /** The longest recording the model takes; `null` where none is stated. */
  readonly limitMs: number | null;
}

/** Where the speech models are read from. */
export interface SpeechModelSource {
  readonly connections: AgentConnectionRepository;
  readonly simulation: SpeechSimulationMode;
}

function isStatedSpeechModel(model: AgentCatalogModel): boolean {
  const output = model.outputModalities;
  return (
    model.inputModalities?.includes("audio") === true &&
    output?.length === 1 &&
    output[0] === "text"
  );
}

// The shared choice hides models whose stated modalities rule out chatting;
// recognizing speech is exactly what such a model is listed for here.
function speechChoice(
  connection: AgentConnectionRecord,
  model: AgentCatalogModel,
): PageAgentModel {
  return {
    ...catalogModelChoice(connection, model),
    isChatCapable: undefined,
    isSpeechCapable: true,
  };
}

function zaiEntry(connection: AgentConnectionRecord): SpeechModelEntry {
  return {
    choice: speechChoice(connection, {
      id: ZAI_SPEECH_MODEL.id,
      name: ZAI_SPEECH_MODEL.name,
      contextWindow: null,
      promptPrice: null,
      completionPrice: null,
      isFree: false,
      reasoning: "none",
      reasoningEfforts: [],
      defaultReasoningEffort: null,
    }),
    connection,
    limitMs: ZAI_SPEECH_MODEL.maxDurationMs,
  };
}

async function openRouterEntries(
  connections: AgentConnectionRepository,
  connection: AgentConnectionRecord,
): Promise<readonly SpeechModelEntry[]> {
  const catalog = await connections.catalogs().find(connection.id);
  const failure = catalog.errorCode ? { isCatalogFailed: true } : {};
  return catalog.models.filter(isStatedSpeechModel).map((model) => ({
    choice: { ...speechChoice(connection, model), ...failure },
    connection,
    limitMs: null,
  }));
}

function simulationEntry(mode: SpeechSimulationMode): SpeechModelEntry {
  return {
    choice: {
      id: agentModelKey(SPEECH_SIMULATION_CONNECTION, SPEECH_SIMULATION_MODEL),
      connectionId: SPEECH_SIMULATION_CONNECTION,
      name: "Simulation",
      modelName: "Simulation",
      connectionName: "Simulation",
      location: "local",
      model: SPEECH_SIMULATION_MODEL,
      reasoning: "none",
      reasoningEfforts: [],
      catalogDefaultReasoningEffort: null,
      reasoningEffort: null,
      provider: "openrouter",
      isFree: true,
      isSimulation: true,
      isSpeechCapable: true,
    },
    connection: null,
    limitMs:
      mode.scenario === "short_limit" ? SPEECH_SIMULATION_SHORT_LIMIT_MS : null,
  };
}

// Only the two connected APIs recognize speech; CLI tools offer none.
function isSpeechConnection(connection: AgentConnectionRecord): boolean {
  return (
    connection.isActive &&
    connection.hasApiKey &&
    (connection.provider === "openrouter" || connection.provider === "zai")
  );
}

/**
 * Lists the speech models of the instance (PAGE-273).
 *
 * @param source - The stored connections and the simulation switch.
 * @param viewer - The administrator who chooses; `null` when Pages runs the
 * recognition for the instance, which no connection scope limits.
 * @returns The models the central rule of `stt` keeps, the simulation last.
 *
 * @remarks
 * OpenRouter's stored catalog states the modalities of each model; a model
 * that accepts audio and outputs only text is listed. Z.AI lists its
 * documented {@link ZAI_SPEECH_MODEL}. No provider is called.
 */
export async function listSpeechModels(
  source: SpeechModelSource,
  viewer: AgentViewer | null,
): Promise<readonly SpeechModelEntry[]> {
  const entries: SpeechModelEntry[] = [];
  for (const connection of await source.connections.list()) {
    if (!isSpeechConnection(connection)) continue;
    if (
      viewer !== null &&
      !(await canUseAgentConnection(source.connections, viewer, connection.id))
    )
      continue;
    if (connection.provider === "zai") entries.push(zaiEntry(connection));
    else
      entries.push(
        ...(await openRouterEntries(source.connections, connection)),
      );
  }
  if (source.simulation.isActive)
    entries.push(simulationEntry(source.simulation));
  const allowed = new Set(
    consumerModels(
      "stt",
      entries.map((entry) => entry.choice),
    ).map((choice) => choice.id),
  );
  return entries.filter((entry) => allowed.has(entry.choice.id));
}

/**
 * Finds the entry of a saved choice.
 *
 * @param entries - The listed speech models.
 * @param selection - The saved choice; `null` without one.
 * @returns The entry, or `null` when the choice is not listed.
 */
export function findSpeechModel(
  entries: readonly SpeechModelEntry[],
  selection: SpeechModelSelection | null,
): SpeechModelEntry | null {
  if (selection === null) return null;
  return (
    entries.find(
      (entry) =>
        entry.choice.connectionId === selection.connectionId &&
        entry.choice.model === selection.model,
    ) ?? null
  );
}
