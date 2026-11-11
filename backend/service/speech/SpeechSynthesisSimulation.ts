import { logEvent } from "@/backend/logging/Logger";

import { wavFromPcm } from "./SpeechSynthesisAudio";

/** The scenarios `PAGES_TTS_SIMULATION_SCENARIO` selects. */
export const SPEECH_SYNTHESIS_SIMULATION_SCENARIOS = [
  "ok",
  "no_voices",
  "provider_failed",
] as const;

/** One scenario of the simulated speech output. */
export type SpeechSynthesisSimulationScenario =
  (typeof SPEECH_SYNTHESIS_SIMULATION_SCENARIOS)[number];

/** Whether the speech output simulation is on and which scenario it plays. */
export interface SpeechSynthesisSimulationMode {
  readonly isActive: boolean;
  readonly scenario: SpeechSynthesisSimulationScenario;
}

/** The connection of the simulated speech output model; never a stored connection. */
export const SPEECH_SYNTHESIS_SIMULATION_CONNECTION = "pages-tts-simulation";

/** The model name the simulated connection offers. */
export const SPEECH_SYNTHESIS_SIMULATION_MODEL = "simulation-tts";

/** The voices of the simulated model; each speaks at a pitch of its own. */
export const SPEECH_SYNTHESIS_SIMULATION_VOICES: readonly string[] = [
  "Zephyr",
  "Puck",
  "Charon",
  "Kore",
  "Fenrir",
  "Leda",
];

const INACTIVE: SpeechSynthesisSimulationMode = {
  isActive: false,
  scenario: "ok",
};
const COMPONENT = "SpeechSynthesisSimulation";
const SAMPLE_RATE = 24_000;
/** Milliseconds of simulated speech per character at 1.0×. */
const MS_PER_CHARACTER = 55;

function readScenario(
  input: string | undefined,
): SpeechSynthesisSimulationScenario {
  return (
    SPEECH_SYNTHESIS_SIMULATION_SCENARIOS.find(
      (scenario) => scenario === input,
    ) ?? "ok"
  );
}

/**
 * Reads the simulation switch of the speech output (PAGE-300).
 *
 * @param environment - The environment, the process's own by default.
 * @returns Active only with `PAGES_TTS_SIMULATION=1` outside production.
 *
 * @remarks
 * Like the speech recognition simulation, the switch is ignored with
 * `NODE_ENV=production`, so a production instance never offers the
 * simulated model and never answers with simulated audio.
 */
export function readSpeechSynthesisSimulationMode(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): SpeechSynthesisSimulationMode {
  if (environment.PAGES_TTS_SIMULATION !== "1") return INACTIVE;
  if (environment.NODE_ENV === "production") {
    console.warn(
      "[pages] PAGES_TTS_SIMULATION=1 is ignored because NODE_ENV=production.",
    );
    return INACTIVE;
  }
  const scenario = readScenario(environment.PAGES_TTS_SIMULATION_SCENARIO);
  logEvent({
    level: "info",
    event: "speech.synthesis.simulation.active",
    component: COMPONENT,
    message:
      "The speech output simulation is active; no provider is contacted.",
    metadata: { kind: scenario },
  });
  return { isActive: true, scenario };
}

let processMode: SpeechSynthesisSimulationMode | null = null;

/**
 * The simulation switch of this process, read and logged once.
 *
 * @returns The same mode on every call.
 */
export function currentSpeechSynthesisSimulationMode(): SpeechSynthesisSimulationMode {
  processMode ??= readSpeechSynthesisSimulationMode();
  return processMode;
}

function voicePitch(voice: string): number {
  let sum = 0;
  for (const character of voice) sum += character.codePointAt(0) ?? 0;
  return 160 + (sum % 9) * 30;
}

/**
 * Simulated speech: a WAV tone whose length follows the text and the speed
 * and whose pitch follows the voice, so a listener hears both settings.
 *
 * @param input - The text, the voice and the speed of the request.
 * @returns A mono 16-bit WAV at 24 kHz.
 */
export function simulatedSpeech(input: {
  readonly text: string;
  readonly voice: string;
  readonly speed: number;
}): Buffer {
  const durationMs = (input.text.length * MS_PER_CHARACTER) / input.speed;
  const samples = Math.round((SAMPLE_RATE * durationMs) / 1000);
  const pcm = Buffer.alloc(samples * 2);
  const pitch = voicePitch(input.voice);
  const syllable = Math.round(SAMPLE_RATE * (0.18 / input.speed));
  for (let index = 0; index < samples; index += 1) {
    const envelope = Math.sin((Math.PI * (index % syllable)) / syllable);
    const sample = Math.sin((2 * Math.PI * pitch * index) / SAMPLE_RATE);
    pcm.writeInt16LE(Math.round(sample * envelope * 9_000), index * 2);
  }
  return wavFromPcm(pcm, { sampleRate: SAMPLE_RATE, channels: 1 });
}
