import { logCaughtError } from "@/backend/logging/Logger";
import { agentCallSynthesisPath } from "@/definition/AgentCall";
import { effectiveAgentVoice } from "@/definition/SpeechSynthesis";

import { simulatedSpeech } from "./SpeechSynthesisSimulation";

import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";
import type { AgentCallPath } from "@/definition/AgentCall";
import type {
  SpeechStreamFormat,
  SpeechSynthesisClient,
  SynthesizedAudioType,
} from "./SpeechSynthesisClient";
import type { SpeechSynthesisModelEntry } from "./SpeechSynthesisModels";
import type { SpeechSynthesisSettingsService } from "./SpeechSynthesisSettingsService";
import type { SpeechSynthesisSimulationMode } from "./SpeechSynthesisSimulation";

/** What the speech of an agent needs besides the setting. */
export interface AgentSpeechDependencies {
  readonly settings: Pick<SpeechSynthesisSettingsService, "configuration">;
  readonly connections: Pick<AgentConnectionRepository, "findSecretEncrypted">;
  readonly cipher: Pick<InstanceSecretCipher, "decrypt">;
  readonly client: Pick<
    SpeechSynthesisClient,
    "synthesize" | "synthesizeStream"
  >;
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
  /** Whether the chosen model delivers audio while it still synthesizes. */
  readonly path: AgentCallPath;
}

/** How the audio of a streamed text arrives. */
export interface AgentSpeechFormat {
  /** `audio/pcm` arrives in blocks while it is synthesized, any other type as one whole file. */
  readonly mimeType: "audio/pcm" | SynthesizedAudioType;
  /** The sample rate of `audio/pcm`; 0 for a whole file. */
  readonly sampleRate: number;
  /** The channels of `audio/pcm`; 0 for a whole file. */
  readonly channels: number;
  /** The rate the player applies: the speed when the model refused it, otherwise 1. */
  readonly playbackRate: number;
}

/** Receives the audio of a text while it is synthesized. */
export interface AgentSpeechSink {
  /** Called once, before the first block. */
  readonly begin: (format: AgentSpeechFormat) => void;
  readonly block: (audio: Buffer) => void;
}

/** What streaming a text gave; the audio itself went to the sink. */
export type AgentSpeechStreamOutcome =
  { readonly ok: true } | Extract<AgentSpeechOutcome, { ok: false }>;

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

/** The sample rate and size of the simulated blocks: 100 milliseconds of 24 kHz mono. */
const SIMULATION_SAMPLE_RATE = 24_000;
const SIMULATION_BLOCK_BYTES = 4_800;
const WAV_HEADER_BYTES = 44;

/**
 * Whether a speech output model streams its audio.
 * @param model - The chosen model of the instance.
 * @returns `streaming` for the simulation and for every OpenRouter model whose
 * PCM arrives while it is synthesized, `buffered` for the others.
 */
export function speechSynthesisPathOf(
  model: SpeechSynthesisModelEntry,
): AgentCallPath {
  return agentCallSynthesisPath(
    model.connection === null ? null : model.choice.model,
  );
}

function formatOf(
  format: SpeechStreamFormat,
  speed: number,
): AgentSpeechFormat {
  return {
    mimeType: format.mimeType,
    sampleRate: format.layout?.sampleRate ?? 0,
    channels: format.layout?.channels ?? 0,
    playbackRate: format.isSpeedApplied ? 1 : speed,
  };
}

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
      return { isConfigured: false, isVoiceMissing: false, path: "buffered" };
    const voice = effectiveAgentVoice(configuration.model.voices, voiceId);
    return {
      isConfigured: true,
      isVoiceMissing: voice.missingVoiceId !== null,
      path: speechSynthesisPathOf(configuration.model),
    };
  }

  /**
   * Speaks one text and hands its audio on while it is synthesized.
   * @param input - Text, voice, speed and the caller's cancellation.
   * @param sink - Receives the format and then the audio in blocks.
   * @returns Whether audio arrived, or why there is none.
   * @remarks
   * The audio passes through memory only; nothing of it is kept.
   */
  public async speakStream(
    input: AgentSpeechInput,
    sink: AgentSpeechSink,
  ): Promise<AgentSpeechStreamOutcome> {
    const configuration = await this.dependencies.settings.configuration();
    if (configuration === null) return { ok: false, code: "not_configured" };
    const { model } = configuration;
    const voice = effectiveAgentVoice(model.voices, input.voiceId).voiceId;
    const speed = input.speedTenths / 10;
    if (model.connection === null)
      return this.simulateStream(input.text, { voice, speed }, sink);
    const apiKey = await this.readApiKey(model.connection.id);
    if (apiKey === null) return { ok: false, code: "not_configured" };
    return this.dependencies.client.synthesizeStream(
      {
        apiKey,
        model: model.choice.model,
        text: input.text,
        voice,
        speed,
        signal: input.signal,
      },
      {
        begin: (format) => sink.begin(formatOf(format, speed)),
        block: (audio) => sink.block(audio),
      },
    );
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

  // The simulated tone arrives in blocks like a streaming provider's PCM.
  private simulateStream(
    text: string,
    options: { readonly voice: string | null; readonly speed: number },
    sink: AgentSpeechSink,
  ): AgentSpeechStreamOutcome {
    if (this.dependencies.simulation.scenario === "provider_failed")
      return { ok: false, code: "provider_failed" };
    const pcm = simulatedSpeech({
      text,
      voice: options.voice ?? "",
      speed: options.speed,
    }).subarray(WAV_HEADER_BYTES);
    sink.begin({
      mimeType: "audio/pcm",
      sampleRate: SIMULATION_SAMPLE_RATE,
      channels: 1,
      playbackRate: 1,
    });
    for (let start = 0; start < pcm.length; start += SIMULATION_BLOCK_BYTES)
      sink.block(pcm.subarray(start, start + SIMULATION_BLOCK_BYTES));
    return { ok: true };
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
