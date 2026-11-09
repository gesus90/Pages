import { setTimeout as wait } from "node:timers/promises";

import { logEvent } from "@/backend/logging/Logger";

import { ConversationProviderTranscriber } from "./ConversationProviderTranscriber";

import type { SpeechRecognitionSetting } from "@/backend/config/SpeechRecognitionConfig";
import type { Readable } from "node:stream";

/** The audio a recognition reads. */
export interface ConversationTranscriptionInput {
  /** Opens the stored audio; each call reads it from the start. */
  readonly open: () => Readable;
  readonly mimeType: string;
  readonly sizeBytes: number;
}

/** What a recognition made of a voice message. */
export type ConversationTranscriptionOutcome =
  { readonly ok: true; readonly text: string } | { readonly ok: false };

/** Turns the audio of a voice message into text. */
export interface ConversationTranscriber {
  /**
   * Recognizes the text of a voice message.
   *
   * @returns The text, or `{ ok: false }` when the recognition failed; it
   * never rejects.
   */
  transcribe(
    input: ConversationTranscriptionInput,
  ): Promise<ConversationTranscriptionOutcome>;
}

/** The scenarios of the simulated recognition. */
export const CONVERSATION_TRANSCRIPTION_SCENARIOS = [
  "ok",
  "provider_failed",
  "slow",
] as const;

/** One scenario of the simulated recognition. */
export type ConversationTranscriptionScenario =
  (typeof CONVERSATION_TRANSCRIPTION_SCENARIOS)[number];

const COMPONENT = "ConversationTranscriber";
const SLOW_MILLISECONDS = 8_000;

async function countBytes(stream: Readable): Promise<number> {
  let count = 0;
  for await (const chunk of stream) {
    count += Buffer.isBuffer(chunk)
      ? chunk.length
      : Buffer.byteLength(String(chunk));
  }
  return count;
}

/**
 * The recognition without any provider: no request leaves Pages, the text is
 * fixed and names the number of bytes it received.
 */
class SimulatedTranscriber implements ConversationTranscriber {
  private readonly scenario: ConversationTranscriptionScenario;

  public constructor(scenario: ConversationTranscriptionScenario) {
    this.scenario = scenario;
  }

  /** Plays the scenario: fails, waits, or counts the bytes of the audio. */
  public async transcribe(
    input: ConversationTranscriptionInput,
  ): Promise<ConversationTranscriptionOutcome> {
    if (this.scenario === "provider_failed") return { ok: false };
    if (this.scenario === "slow") await wait(SLOW_MILLISECONDS);
    try {
      const bytes = await countBytes(input.open());
      return {
        ok: true,
        text: `Simulierte Spracherkennung: ${bytes} Bytes empfangen.`,
      };
    } catch (error: unknown) {
      logEvent({
        level: "warn",
        event: "conversation.transcription.failed",
        component: COMPONENT,
        message: "The simulated recognition could not read the audio",
        error,
      });
      return { ok: false };
    }
  }
}

/** The recognition while Pages has no speech model: every voice message keeps its audio and no text. */
class UnavailableTranscriber implements ConversationTranscriber {
  /** Fails at once; there is no model to ask. */
  public transcribe(): Promise<ConversationTranscriptionOutcome> {
    return Promise.resolve({ ok: false });
  }
}

function readScenario(
  input: string | undefined,
): ConversationTranscriptionScenario {
  return (
    CONVERSATION_TRANSCRIPTION_SCENARIOS.find(
      (scenario) => scenario === input,
    ) ?? "ok"
  );
}

/** The recognition of the server setting, or the one that fails at once without a model. */
function configuredTranscriber(
  speech: SpeechRecognitionSetting | undefined,
): ConversationTranscriber {
  if (speech?.model === undefined || speech.url === undefined)
    return new UnavailableTranscriber();
  return new ConversationProviderTranscriber({
    model: speech.model,
    url: speech.url,
    apiKeyFile: speech.apiKeyFile ?? null,
  });
}

/** Where the recognition of the process is chosen from. */
export interface ConversationTranscriberOptions {
  /** The speech model of `config.toml` (PAGE-277). */
  readonly speech?: SpeechRecognitionSetting;
  /** The environment, the process's own by default. */
  readonly environment?: Readonly<Record<string, string | undefined>>;
}

/**
 * Chooses the recognition of the process.
 *
 * @param options - The speech model of the server setting and the environment.
 * @returns The simulation with `PAGES_STT_SIMULATION=1` outside production,
 * otherwise the speech model of `[speechRecognition]` in `config.toml`, or a
 * recognition that fails at once when the file names no model and endpoint.
 *
 * @remarks
 * With `NODE_ENV=production` the simulation switch is ignored and the
 * ignoring is logged. `PAGES_STT_SIMULATION_SCENARIO` chooses `ok`
 * (default), `provider_failed` or `slow`. The simulation contacts no provider.
 */
export function createConversationTranscriber(
  options: ConversationTranscriberOptions = {},
): ConversationTranscriber {
  const environment = options.environment ?? process.env;
  if (environment.PAGES_STT_SIMULATION !== "1")
    return configuredTranscriber(options.speech);
  if (environment.NODE_ENV === "production") {
    logEvent({
      level: "warn",
      event: "conversation.transcription.simulation_ignored",
      component: COMPONENT,
      message:
        "PAGES_STT_SIMULATION is ignored because NODE_ENV is production.",
    });
    return configuredTranscriber(options.speech);
  }
  const scenario = readScenario(environment.PAGES_STT_SIMULATION_SCENARIO);
  logEvent({
    level: "info",
    event: "conversation.transcription.simulation_active",
    component: COMPONENT,
    message:
      "The speech recognition simulation is active; no provider is contacted.",
    metadata: { scenario },
  });
  return new SimulatedTranscriber(scenario);
}
