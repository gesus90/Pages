import { setTimeout as wait } from "node:timers/promises";

import { logCaughtError, logEvent } from "@/backend/logging/Logger";
import {
  readSpeechMimeType,
  SPEECH_MAXIMUM_BYTES,
  SPEECH_MIME_TYPES,
} from "@/definition/SpeechRecognition";

import { inspectSpeechAudio } from "./SpeechAudio";
import {
  simulatedSpeechText,
  SPEECH_SIMULATION_SLOW_MS,
} from "./SpeechSimulation";

import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";
import type {
  SpeechMimeType,
  SpeechTestOutcome,
} from "@/definition/SpeechRecognition";
import type { SpeechModelEntry } from "./SpeechModels";
import type {
  SpeechProviderClient,
  SpeechProviderId,
} from "./SpeechProviderClient";
import type { SpeechSettingsService } from "./SpeechSettingsService";
import type { SpeechSimulationMode } from "./SpeechSimulation";

/** What the recognition needs besides the setting. */
export interface SpeechRecognitionDependencies {
  readonly settings: Pick<SpeechSettingsService, "configuration">;
  readonly connections: Pick<AgentConnectionRepository, "findSecretEncrypted">;
  readonly cipher: Pick<InstanceSecretCipher, "decrypt">;
  readonly client: Pick<SpeechProviderClient, "transcribe">;
  readonly simulation: SpeechSimulationMode;
}

/** One finished recording to recognize. */
export interface SpeechRecognitionInput {
  /** The complete recording; the service clears it after use. */
  readonly audio: Buffer;
  /** The format the sender declared. */
  readonly mimeType: string;
  /** Cancels the provider request, for example when the connection closes. */
  readonly signal: AbortSignal;
}

/** The limits a client records within, as `speech_config` names them. */
export interface SpeechLimits {
  readonly maxDurationMs: number;
  readonly mimeTypes: readonly SpeechMimeType[];
}

const COMPONENT = "SpeechRecognitionService";

function failure(
  code: Extract<SpeechTestOutcome, { ok: false }>["code"],
): SpeechTestOutcome {
  return { ok: false, code };
}

/**
 * Turns a finished recording into text with the model of the instance (PAGE-273).
 *
 * @remarks
 * The text comes after the recording, never live. Audio stays in memory: it
 * is checked, passed on unchanged and cleared afterwards, and it never
 * reaches the database, a file or a log; neither does the API key, which
 * never leaves the server. Only WAV and MP3 are accepted, at most 25 MB and
 * at most the longest recording that applies, measured from the audio
 * itself. While the simulation is on, no provider is asked.
 */
export class SpeechRecognitionService {
  private readonly dependencies: SpeechRecognitionDependencies;

  public constructor(dependencies: SpeechRecognitionDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * The limits that apply now.
   *
   * @returns The longest recording and the formats, or `null` while speech
   * recognition is off.
   */
  public async limits(): Promise<SpeechLimits | null> {
    const configuration = await this.dependencies.settings.configuration();
    return configuration === null
      ? null
      : {
          maxDurationMs: configuration.maxDurationMs,
          mimeTypes: SPEECH_MIME_TYPES,
        };
  }

  /**
   * Recognizes the text of a finished recording.
   *
   * @param input - The recording, its declared format and the cancellation.
   * @returns The text, or the code of why there is none.
   */
  public async transcribe(
    input: SpeechRecognitionInput,
  ): Promise<SpeechTestOutcome> {
    try {
      return await this.recognize(input);
    } finally {
      input.audio.fill(0);
    }
  }

  private async recognize(
    input: SpeechRecognitionInput,
  ): Promise<SpeechTestOutcome> {
    const configuration = await this.dependencies.settings.configuration();
    if (configuration === null) return failure("not_configured");
    const mimeType = readSpeechMimeType(input.mimeType);
    if (mimeType === null || input.audio.length === 0)
      return failure("unsupported_format");
    if (input.audio.length > SPEECH_MAXIMUM_BYTES) return failure("too_large");
    const facts = inspectSpeechAudio(input.audio, mimeType);
    if (facts === null) return failure("unsupported_format");
    if (facts.durationMs > configuration.maxDurationMs)
      return failure("too_long");
    const outcome = this.dependencies.simulation.isActive
      ? await this.simulate(input)
      : await this.ask(configuration.model, { ...input, mimeType });
    logEvent({
      level: "info",
      event: "speech.recognition.finished",
      component: COMPONENT,
      message: "Speech recognition finished",
      metadata: {
        reason: outcome.ok ? "ok" : outcome.code,
        bytes: input.audio.length,
        durationMs: facts.durationMs,
        source: this.dependencies.simulation.isActive
          ? "simulation"
          : "provider",
      },
    });
    return outcome;
  }

  private async simulate(
    input: SpeechRecognitionInput,
  ): Promise<SpeechTestOutcome> {
    const { scenario } = this.dependencies.simulation;
    if (scenario === "provider_failed") return failure("provider_failed");
    if (scenario === "provider_unreachable")
      return failure("provider_unreachable");
    if (scenario === "slow")
      await wait(SPEECH_SIMULATION_SLOW_MS, undefined, {
        signal: input.signal,
      });
    return { ok: true, text: simulatedSpeechText(input.audio.length) };
  }

  private async ask(
    model: SpeechModelEntry,
    input: SpeechRecognitionInput & { readonly mimeType: SpeechMimeType },
  ): Promise<SpeechTestOutcome> {
    const { connection } = model;
    if (connection === null) return failure("not_configured");
    const provider: SpeechProviderId | null =
      connection.provider === "openrouter" || connection.provider === "zai"
        ? connection.provider
        : null;
    const apiKey = await this.readApiKey(connection.id);
    if (provider === null || apiKey === null) return failure("not_configured");
    const outcome = await this.dependencies.client.transcribe({
      provider,
      apiKey,
      model: model.choice.model,
      audio: input.audio,
      mimeType: input.mimeType,
      signal: input.signal,
    });
    return outcome.ok
      ? { ok: true, text: outcome.text }
      : failure(outcome.code);
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
