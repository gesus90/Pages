import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { AgentError } from "@/backend/error/AgentErrors";
import {
  effectiveSpeechDuration,
  isSpeechDurationChoice,
} from "@/definition/SpeechRecognition";

import { requireAgentAdministrator } from "../agents/AgentServiceAccess";
import {
  findSpeechModel,
  isUnsuitableSpeechModel,
  listSpeechModels,
} from "./SpeechModels";

import type { AgentViewer } from "@/backend/auth/AgentProfilePolicy";
import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import type { SpeechSettingsRepository } from "@/backend/database/repositories/speech/SpeechSettingsRepository";
import type { AccountAccess } from "@/definition/Authorization";
import type {
  SpeechAdministration,
  SpeechModelSelection,
} from "@/definition/SpeechRecognition";
import type { SpeechModelEntry } from "./SpeechModels";
import type { SpeechSimulationMode } from "./SpeechSimulation";

/** What the setting is read and checked with. */
export interface SpeechSettingsDependencies {
  readonly settings: SpeechSettingsRepository;
  readonly connections: AgentConnectionRepository;
  readonly groups: Pick<UserGroupRepository, "findIdsByMember">;
  readonly simulation: SpeechSimulationMode;
}

/** A submitted change of the setting. */
export interface SpeechSettingsInput {
  readonly selection: SpeechModelSelection | null;
  readonly maxDurationMs: number;
  readonly revision: number;
}

/** The speech model that runs now, with the limit that applies to it. */
export interface SpeechConfiguration {
  readonly model: SpeechModelEntry;
  readonly maxDurationMs: number;
}

/**
 * The speech recognition setting of the instance (PAGE-273).
 *
 * @remarks
 * Only an administrator in the active admin mode reads the form and saves,
 * as for Pica. The setting belongs to the instance, not to Pica: without a
 * chosen model speech recognition is off. The model must be one of the
 * speech models {@link listSpeechModels} lists; a model the selection no
 * longer offers keeps its value and counts as unavailable, or as unsuitable
 * when its catalog lists it as no transcription model (PAGE-294).
 */
export class SpeechSettingsService {
  private readonly dependencies: SpeechSettingsDependencies;
  private readonly writes = new SerialQueue();

  public constructor(dependencies: SpeechSettingsDependencies) {
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
   * @returns The setting, its state, the speech models and their limits.
   */
  public async administration(
    actor: AccountAccess,
  ): Promise<SpeechAdministration> {
    requireAgentAdministrator(actor);
    const viewer = await this.viewer(actor);
    const [settings, models] = await Promise.all([
      this.dependencies.settings.read(),
      listSpeechModels(this.dependencies, viewer),
    ]);
    const selected = findSpeechModel(models, settings.selection);
    const modelLimits: Record<string, number> = {};
    for (const entry of models) {
      if (entry.limitMs !== null) modelLimits[entry.choice.id] = entry.limitMs;
    }
    return {
      settings,
      status: await this.status(viewer, settings.selection, selected),
      models: models.map((entry) => entry.choice),
      modelLimits,
      effectiveMaxDurationMs: effectiveSpeechDuration(
        settings.maxDurationMs,
        selected?.limitMs ?? null,
      ),
      isSimulation: this.isSimulation,
    };
  }

  /**
   * Saves model and longest recording.
   *
   * @param actor - The administrator in the admin mode.
   * @param input - The submitted choice with the revision it was read at.
   * @throws {AgentError} `profile_invalid` for a duration outside the
   * choices, `provider_model_not_found` for a model that is no speech model
   * of the instance, `profile_conflict` after a concurrent change.
   */
  public async save(
    actor: AccountAccess,
    input: SpeechSettingsInput,
  ): Promise<void> {
    requireAgentAdministrator(actor);
    const { maxDurationMs, selection, revision } = input;
    if (!isSpeechDurationChoice(maxDurationMs))
      throw new AgentError("profile_invalid");
    if (
      selection !== null &&
      findSpeechModel(
        await listSpeechModels(this.dependencies, await this.viewer(actor)),
        selection,
      ) === null
    )
      throw new AgentError("provider_model_not_found");
    await this.writes.run(() =>
      this.dependencies.settings.save({ selection, maxDurationMs, revision }),
    );
  }

  /**
   * The model that recognizes speech now, for every account of the instance.
   *
   * @returns The model and the longest recording that applies, or `null`
   * while speech recognition is off or its model is unavailable.
   */
  public async configuration(): Promise<SpeechConfiguration | null> {
    const settings = await this.dependencies.settings.read();
    if (settings.selection === null) return null;
    const model = findSpeechModel(
      await listSpeechModels(this.dependencies, null),
      settings.selection,
    );
    if (model === null) return null;
    return {
      model,
      maxDurationMs: effectiveSpeechDuration(
        settings.maxDurationMs,
        model.limitMs,
      ),
    };
  }

  private async viewer(actor: AccountAccess): Promise<AgentViewer> {
    return {
      actor,
      groupIds: await this.dependencies.groups.findIdsByMember(actor.userId),
    };
  }

  private async status(
    viewer: AgentViewer,
    selection: SpeechModelSelection | null,
    selected: SpeechModelEntry | null,
  ): Promise<SpeechAdministration["status"]> {
    if (selection === null) return "noModel";
    if (selected !== null) return "ready";
    return (await isUnsuitableSpeechModel(this.dependencies, viewer, selection))
      ? "modelUnsuitable"
      : "modelUnavailable";
  }
}
