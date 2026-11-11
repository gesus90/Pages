import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { AgentError } from "@/backend/error/AgentErrors";
import { isSpeechSynthesisDurationChoice } from "@/definition/SpeechSynthesis";

import { requireAgentAdministrator } from "../agents/AgentServiceAccess";
import {
  findSpeechSynthesisModel,
  listSpeechSynthesisModels,
} from "./SpeechSynthesisModels";

import type { AgentViewer } from "@/backend/auth/AgentProfilePolicy";
import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import type { SpeechSynthesisSettingsRepository } from "@/backend/database/repositories/speech/SpeechSynthesisSettingsRepository";
import type { AccountAccess } from "@/definition/Authorization";
import type { SpeechModelSelection } from "@/definition/SpeechRecognition";
import type {
  AgentVoiceOptions,
  SpeechSynthesisAdministration,
  SpeechSynthesisDurationChoice,
} from "@/definition/SpeechSynthesis";
import type { SpeechSynthesisModelEntry } from "./SpeechSynthesisModels";
import type { SpeechSynthesisSimulationMode } from "./SpeechSynthesisSimulation";

/** What the setting is read and checked with. */
export interface SpeechSynthesisSettingsDependencies {
  readonly settings: SpeechSynthesisSettingsRepository;
  readonly connections: AgentConnectionRepository;
  readonly groups: Pick<UserGroupRepository, "findIdsByMember">;
  readonly simulation: SpeechSynthesisSimulationMode;
}

/** A submitted change of the setting. */
export interface SpeechSynthesisSettingsInput {
  readonly selection: SpeechModelSelection | null;
  readonly maxDurationMs: number;
  readonly revision: number;
}

/** The speech output model that speaks now, with the longest output. */
export interface SpeechSynthesisConfiguration {
  readonly model: SpeechSynthesisModelEntry;
  readonly maxDurationMs: SpeechSynthesisDurationChoice;
}

function statusOf(
  selection: SpeechModelSelection | null,
  selected: SpeechSynthesisModelEntry | null,
): SpeechSynthesisAdministration["status"] {
  if (selection === null) return "noModel";
  return selected === null ? "modelUnavailable" : "ready";
}

/**
 * The speech output setting of the instance (PAGE-300).
 *
 * @remarks
 * Built like the speech recognition setting of PAGE-273: only an
 * administrator in the active admin mode reads the form and saves. Without a
 * chosen model no agent has a voice; no model is chosen in advance. The model
 * must be one of the speech output models {@link listSpeechSynthesisModels}
 * lists; a model the catalog no longer offers keeps its value and counts as
 * unavailable.
 */
export class SpeechSynthesisSettingsService {
  private readonly dependencies: SpeechSynthesisSettingsDependencies;
  private readonly writes = new SerialQueue();

  public constructor(dependencies: SpeechSynthesisSettingsDependencies) {
    this.dependencies = dependencies;
  }

  /** Whether the development simulation answers instead of a provider. */
  public get isSimulation(): boolean {
    return this.dependencies.simulation.isActive;
  }

  /**
   * Supplies the settings card.
   *
   * @param actor - The administrator in the admin mode.
   * @returns The setting, its state and the speech output models.
   */
  public async administration(
    actor: AccountAccess,
  ): Promise<SpeechSynthesisAdministration> {
    requireAgentAdministrator(actor);
    const viewer = await this.viewer(actor);
    const [settings, models] = await Promise.all([
      this.dependencies.settings.read(),
      listSpeechSynthesisModels(this.dependencies, viewer),
    ]);
    const selected = findSpeechSynthesisModel(models, settings.selection);
    return {
      settings,
      status: statusOf(settings.selection, selected),
      models: models.map((entry) => entry.choice),
      isSimulation: this.isSimulation,
    };
  }

  /**
   * Saves model and longest output.
   *
   * @param actor - The administrator in the admin mode.
   * @param input - The checked choice with the revision it was read at.
   * @throws {AgentError} `profile_invalid` for a duration outside the
   * choices, `provider_model_not_found` for a model that is no speech output
   * model of the instance, `profile_conflict` after a concurrent change.
   */
  public async save(
    actor: AccountAccess,
    input: SpeechSynthesisSettingsInput,
  ): Promise<void> {
    requireAgentAdministrator(actor);
    const { maxDurationMs, selection, revision } = input;
    if (!isSpeechSynthesisDurationChoice(maxDurationMs))
      throw new AgentError("profile_invalid");
    if (
      selection !== null &&
      findSpeechSynthesisModel(
        await listSpeechSynthesisModels(
          this.dependencies,
          await this.viewer(actor),
        ),
        selection,
      ) === null
    )
      throw new AgentError("provider_model_not_found");
    await this.writes.run(() =>
      this.dependencies.settings.save({ selection, maxDurationMs, revision }),
    );
  }

  /**
   * The model that speaks now, for every agent of the instance.
   *
   * @returns The model and the longest output, or `null` while no model is
   * chosen or the chosen one is unavailable.
   */
  public async configuration(): Promise<SpeechSynthesisConfiguration | null> {
    const settings = await this.dependencies.settings.read();
    if (settings.selection === null) return null;
    const model = findSpeechSynthesisModel(
      await listSpeechSynthesisModels(this.dependencies, null),
      settings.selection,
    );
    return model === null
      ? null
      : { model, maxDurationMs: settings.maxDurationMs };
  }

  /**
   * What the voice tab of an agent offers: the model of the instance and its voices.
   *
   * @returns The status and, when ready, the model with its voice list.
   *
   * @remarks
   * It names no connection detail beyond the model; whoever may open the
   * agent panel reads it, since the voice of an agent is chosen there.
   */
  public async voiceOptions(): Promise<AgentVoiceOptions> {
    const settings = await this.dependencies.settings.read();
    const models = await listSpeechSynthesisModels(this.dependencies, null);
    const selected = findSpeechSynthesisModel(models, settings.selection);
    const status = statusOf(settings.selection, selected);
    if (selected === null || !selected.choice.connectionId)
      return { status, model: null };
    return {
      status,
      model: {
        connectionId: selected.choice.connectionId,
        model: selected.choice.model,
        name: selected.choice.modelName ?? selected.choice.model,
        voices: selected.voices,
      },
    };
  }

  private async viewer(actor: AccountAccess): Promise<AgentViewer> {
    return {
      actor,
      groupIds: await this.dependencies.groups.findIdsByMember(actor.userId),
    };
  }
}
