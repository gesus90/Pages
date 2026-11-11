import { createHash } from "node:crypto";

import { LRUCache } from "lru-cache";

import { logCaughtError } from "@/backend/logging/Logger";
import {
  agentVoiceSampleText,
  effectiveAgentVoice,
} from "@/definition/SpeechSynthesis";

import { simulatedSpeech } from "./SpeechSynthesisSimulation";

import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";
import type { AgentVoiceSampleLanguage } from "@/definition/SpeechSynthesis";
import type {
  SpeechSynthesisClient,
  SynthesizedAudioType,
} from "./SpeechSynthesisClient";
import type { SpeechSynthesisModelEntry } from "./SpeechSynthesisModels";
import type { SpeechSynthesisSettingsService } from "./SpeechSynthesisSettingsService";
import type { SpeechSynthesisSimulationMode } from "./SpeechSynthesisSimulation";

/** What the sample needs besides the setting. */
export interface SpeechSynthesisPreviewDependencies {
  readonly settings: Pick<SpeechSynthesisSettingsService, "configuration">;
  readonly connections: Pick<AgentConnectionRepository, "findSecretEncrypted">;
  readonly cipher: Pick<InstanceSecretCipher, "decrypt">;
  readonly client: Pick<SpeechSynthesisClient, "synthesize">;
  readonly simulation: SpeechSynthesisSimulationMode;
}

/** One sample of an agent's voice. */
export interface SpeechSynthesisPreviewInput {
  /** The agent's stored display name; the only part of the text that varies. */
  readonly agentName: string;
  /** The voice to hear; `null` for the model's first voice. */
  readonly voiceId: string | null;
  /** The speed in tenths, already checked. */
  readonly speedTenths: number;
  readonly language: AgentVoiceSampleLanguage;
  readonly signal: AbortSignal;
}

/** A spoken sample. */
export interface SpeechSynthesisSample {
  readonly audio: Buffer;
  readonly mimeType: SynthesizedAudioType;
  /** The rate the player applies: the speed when the model refused it, otherwise 1. */
  readonly playbackRate: number;
}

/** Why there is no sample. */
export type SpeechSynthesisPreviewError =
  "not_configured" | "provider_failed" | "provider_unreachable";

/** What a sample request gave. */
export type SpeechSynthesisPreviewOutcome =
  | { readonly ok: true; readonly sample: SpeechSynthesisSample }
  | { readonly ok: false; readonly code: SpeechSynthesisPreviewError };

/** How long a sample is kept, so hearing it again costs nothing. */
const SAMPLE_TTL_MS = 24 * 60 * 60 * 1000;

/** The memory all kept samples may take together. */
const MAXIMUM_CACHED_BYTES = 64 * 1024 * 1024;

const COMPONENT = "SpeechSynthesisPreviewService";

function sampleKey(
  model: SpeechSynthesisModelEntry,
  voice: string | null,
  input: SpeechSynthesisPreviewInput,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        model.choice.connectionId ?? "",
        model.choice.model,
        voice,
        input.speedTenths,
        input.agentName,
        input.language,
      ]),
    )
    .digest("hex");
}

/**
 * Speaks the fixed sample sentence of an agent with a voice and a speed (PAGE-300).
 *
 * @remarks
 * The text is fixed on the server ({@link agentVoiceSampleText}); only the
 * agent's stored name is filled in, so no client brings a text of its own.
 * Equal samples (model, voice, speed, name and language) are kept in memory
 * for 24 hours, so listening again calls no provider and costs nothing.
 * Audio never reaches the database, a file or a log, and it is gone with the
 * process. While the simulation is on, no provider is asked.
 */
export class SpeechSynthesisPreviewService {
  private readonly dependencies: SpeechSynthesisPreviewDependencies;
  private readonly samples = new LRUCache<string, SpeechSynthesisSample>({
    max: 500,
    maxSize: MAXIMUM_CACHED_BYTES,
    sizeCalculation: (sample) => Math.max(1, sample.audio.length),
    ttl: SAMPLE_TTL_MS,
  });

  public constructor(dependencies: SpeechSynthesisPreviewDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Speaks the sample of an agent.
   *
   * @param input - Name, voice, speed and language of the sample.
   * @returns The audio, or why there is none.
   */
  public async preview(
    input: SpeechSynthesisPreviewInput,
  ): Promise<SpeechSynthesisPreviewOutcome> {
    const configuration = await this.dependencies.settings.configuration();
    if (configuration === null) return { ok: false, code: "not_configured" };
    const { model } = configuration;
    const voice = effectiveAgentVoice(model.voices, input.voiceId).voiceId;
    const key = sampleKey(model, voice, input);
    const kept = this.samples.get(key);
    if (kept) return { ok: true, sample: kept };
    const outcome = await this.speak(model, voice, input);
    if (outcome.ok) this.samples.set(key, outcome.sample);
    return outcome;
  }

  private async speak(
    model: SpeechSynthesisModelEntry,
    voice: string | null,
    input: SpeechSynthesisPreviewInput,
  ): Promise<SpeechSynthesisPreviewOutcome> {
    const text = agentVoiceSampleText(input.agentName, input.language);
    const speed = input.speedTenths / 10;
    if (model.connection === null) return this.simulate(text, voice, speed);
    const apiKey = await this.readApiKey(model.connection.id);
    if (apiKey === null) return { ok: false, code: "not_configured" };
    const outcome = await this.dependencies.client.synthesize({
      apiKey,
      model: model.choice.model,
      text,
      voice,
      speed,
      signal: input.signal,
    });
    if (!outcome.ok) return outcome;
    return {
      ok: true,
      sample: {
        audio: outcome.audio,
        mimeType: outcome.mimeType,
        playbackRate: outcome.isSpeedApplied ? 1 : speed,
      },
    };
  }

  private simulate(
    text: string,
    voice: string | null,
    speed: number,
  ): SpeechSynthesisPreviewOutcome {
    if (this.dependencies.simulation.scenario === "provider_failed")
      return { ok: false, code: "provider_failed" };
    return {
      ok: true,
      sample: {
        audio: simulatedSpeech({ text, voice: voice ?? "", speed }),
        mimeType: "audio/wav",
        playbackRate: 1,
      },
    };
  }

  // A key that is missing or no longer decrypts makes the setting unusable; it is no provider failure.
  private async readApiKey(connectionId: string): Promise<string | null> {
    const encrypted =
      await this.dependencies.connections.findSecretEncrypted(connectionId);
    if (encrypted === null) return null;
    try {
      return this.dependencies.cipher.decrypt(connectionId, encrypted);
    } catch (error: unknown) {
      logCaughtError(COMPONENT, error);

      return null;
    }
  }
}
