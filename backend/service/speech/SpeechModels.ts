import { catalogModelChoice } from "@/definition/AgentModelChoice";
import { consumerModels } from "@/definition/AgentModelConsumers";
import { agentModelKey } from "@/definition/AgentPlanConfiguration";
import { isTranscriptionModel } from "@/definition/SpeechRecognition";

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
  return catalog.models.filter(isTranscriptionModel).map((model) => ({
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

// Without a viewer Pages recognizes for the instance, which no connection scope limits.
async function isUsableSpeechConnection(
  source: SpeechModelSource,
  viewer: AgentViewer | null,
  connection: AgentConnectionRecord,
): Promise<boolean> {
  if (!isSpeechConnection(connection)) return false;
  return (
    viewer === null ||
    canUseAgentConnection(source.connections, viewer, connection.id)
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
 * OpenRouter's stored catalog states the modalities of each model; only a
 * transcription model ({@link isTranscriptionModel}) is listed, never a chat
 * model that also accepts audio or a model that states nothing. Z.AI lists
 * its documented {@link ZAI_SPEECH_MODEL}. No provider is called.
 */
export async function listSpeechModels(
  source: SpeechModelSource,
  viewer: AgentViewer | null,
): Promise<readonly SpeechModelEntry[]> {
  const entries: SpeechModelEntry[] = [];
  for (const connection of await source.connections.list()) {
    if (!(await isUsableSpeechConnection(source, viewer, connection))) continue;
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

/** Why a saved choice that {@link listSpeechModels} no longer lists does not run. */
export type UnlistedSpeechStatus =
  "modelUnavailable" | "modelUnsuitable" | "modelNotInCatalog";

/**
 * Tells why a saved choice is no longer listed (PAGE-294, PAGE-302).
 *
 * @param source - The stored connections and the simulation switch.
 * @param viewer - The administrator who reads the setting.
 * @param selection - The saved choice that {@link listSpeechModels} no longer lists.
 * @returns `modelUnsuitable` when its OpenRouter catalog lists the model, but
 * not as a transcription model, such as a chat model that accepts audio;
 * `modelNotInCatalog` when the usable OpenRouter connection's catalog no
 * longer lists the model at all; `modelUnavailable` when the connection is
 * gone, switched off, without a key or outside the viewer's scope.
 *
 * @remarks
 * It only tells the settings card why a saved model is unusable; the choice
 * stays saved, nothing replaces it and nothing runs with it.
 */
export async function unlistedSpeechModelStatus(
  source: SpeechModelSource,
  viewer: AgentViewer,
  selection: SpeechModelSelection,
): Promise<UnlistedSpeechStatus> {
  const connection = await source.connections.find(selection.connectionId);
  if (
    connection?.provider !== "openrouter" ||
    !(await isUsableSpeechConnection(source, viewer, connection))
  )
    return "modelUnavailable";
  const catalog = await source.connections.catalogs().find(connection.id);
  const model = catalog.models.find((entry) => entry.id === selection.model);
  if (model === undefined) return "modelNotInCatalog";
  return isTranscriptionModel(model) ? "modelUnavailable" : "modelUnsuitable";
}
