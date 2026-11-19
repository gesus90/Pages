import { logCaughtError } from "@/backend/logging/Logger";
import { effectiveAgentVoice } from "@/definition/SpeechSynthesis";

import { simulatedSpeech } from "./SpeechSynthesisSimulation";

import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";
import type {
  SpeechSynthesisClient,
  SynthesizedAudioType,
} from "./SpeechSynthesisClient";
import type { SpeechSynthesisSettingsService } from "./SpeechSynthesisSettingsService";
import type { SpeechSynthesisSimulationMode } from "./SpeechSynthesisSimulation";

/** What the speech of an agent needs besides the setting. */
export interface AgentSpeechDependencies {
  readonly settings: Pick<SpeechSynthesisSettingsService, "configuration">;
  readonly connections: Pick<AgentConnectionRepository, "findSecretEncrypted">;
  readonly cipher: Pick<InstanceSecretCipher, "decrypt">;
  readonly client: Pick<SpeechSynthesisClient, "synthesize">;
  readonly simulation: SpeechSynthesisSimulationMode;
}

/** One text an agent speaks. */
export interface AgentSpeechInput {
  readonly text: string;
  /** The voice the agent saved; `null` for the first voice of the model. */
  readonly voiceId: string | null;
  /** The speed in tenths, already checked. */
  readonly speedTenths: number;
  readonly signal: AbortSignal;
}

/** What the speech output of the instance offers an agent. */
export interface AgentSpeechReadiness {
  readonly isConfigured: boolean;
  /** The saved voice is not one the model lists; the first voice speaks instead. */
  readonly isVoiceMissing: boolean;
}

/** What speaking a text gave. */
export type AgentSpeechOutcome =
  | {
      readonly ok: true;
      readonly audio: Buffer;
      readonly mimeType: SynthesizedAudioType;
      /** The rate the player applies: the speed when the model refused it, otherwise 1. */
      readonly playbackRate: number;
    }
  | {
      readonly ok: false;
      readonly code:
        "not_configured" | "provider_failed" | "provider_unreachable";
    };

const COMPONENT = "AgentSpeechService";

/**
 * Speaks the text of an agent's answer with the voice the agent saved.
 * @remarks
 * It uses the speech output model of the instance, which may run on any
 * connection that offers speech output, OpenRouter included. The audio stays
 * in memory and never reaches the database or a log. Each request is one
 * sentence of a running answer, so the first one can play while the rest is
 * still written; the provider client buffers one sentence, not the answer.
 * While the simulation is on, no provider is asked.
 */
export class AgentSpeechService {
  private readonly dependencies: AgentSpeechDependencies;

  public constructor(dependencies: AgentSpeechDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Tells whether an agent can speak now.
   * @param voiceId - The voice the agent saved; `null` for the first voice.
   * @returns Whether a model is chosen and whether the saved voice is missing from it.
   */
  public async readiness(
    voiceId: string | null,
  ): Promise<AgentSpeechReadiness> {
    const configuration = await this.dependencies.settings.configuration();
    if (configuration === null)
      return { isConfigured: false, isVoiceMissing: false };
    const voice = effectiveAgentVoice(configuration.model.voices, voiceId);
    return {
      isConfigured: true,
      isVoiceMissing: voice.missingVoiceId !== null,
    };
  }

  /**
   * Speaks one text.
   * @param input - Text, voice, speed and the caller's cancellation.
   * @returns The audio, or why there is none.
   */
  public async speak(input: AgentSpeechInput): Promise<AgentSpeechOutcome> {
    const configuration = await this.dependencies.settings.configuration();
    if (configuration === null) return { ok: false, code: "not_configured" };
    const { model } = configuration;
    const voice = effectiveAgentVoice(model.voices, input.voiceId).voiceId;
    const speed = input.speedTenths / 10;
    if (model.connection === null)
      return this.simulate(input.text, voice, speed);
    const apiKey = await this.readApiKey(model.connection.id);
    if (apiKey === null) return { ok: false, code: "not_configured" };
    const outcome = await this.dependencies.client.synthesize({
      apiKey,
      model: model.choice.model,
      text: input.text,
      voice,
      speed,
      signal: input.signal,
    });
    if (!outcome.ok) return outcome;
    return {
      ok: true,
      audio: outcome.audio,
      mimeType: outcome.mimeType,
      playbackRate: outcome.isSpeedApplied ? 1 : speed,
    };
  }

  private simulate(
    text: string,
    voice: string | null,
    speed: number,
  ): AgentSpeechOutcome {
    if (this.dependencies.simulation.scenario === "provider_failed")
      return { ok: false, code: "provider_failed" };
    return {
      ok: true,
      audio: simulatedSpeech({ text, voice: voice ?? "", speed }),
      mimeType: "audio/wav",
      playbackRate: 1,
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
