import { logEvent } from "@/backend/logging/Logger";

/** The scenarios `PAGES_STT_SIMULATION_SCENARIO` selects. */
export const SPEECH_SIMULATION_SCENARIOS = [
  "ok",
  "short_limit",
  "provider_failed",
  "provider_unreachable",
  "slow",
] as const;

/** One scenario of the simulated speech recognition. */
export type SpeechSimulationScenario =
  (typeof SPEECH_SIMULATION_SCENARIOS)[number];

/** Whether the speech recognition simulation is on and which scenario it plays. */
export interface SpeechSimulationMode {
  readonly isActive: boolean;
  readonly scenario: SpeechSimulationScenario;
}

/** The connection of the simulated speech model; never a stored connection. */
export const SPEECH_SIMULATION_CONNECTION = "pages-stt-simulation";

/** The model name the simulated connection offers. */
export const SPEECH_SIMULATION_MODEL = "simulation";

/** The limit of the scenario `short_limit`, like Z.AI's 30 seconds. */
export const SPEECH_SIMULATION_SHORT_LIMIT_MS = 30_000;

/** The wait of the scenario `slow`. */
export const SPEECH_SIMULATION_SLOW_MS = 5_000;

const INACTIVE: SpeechSimulationMode = { isActive: false, scenario: "ok" };
const COMPONENT = "SpeechSimulation";

function readScenario(input: string | undefined): SpeechSimulationScenario {
  return (
    SPEECH_SIMULATION_SCENARIOS.find((scenario) => scenario === input) ?? "ok"
  );
}

/**
 * Reads the simulation switch of the speech recognition (PAGE-273).
 *
 * @param environment - The environment, the process's own by default.
 * @returns Active only with `PAGES_STT_SIMULATION=1` outside production.
 *
 * @remarks
 * With `NODE_ENV=production` the switch is ignored and the ignoring is
 * logged, so a production instance never offers the simulated model and a
 * saved choice of it counts as unavailable.
 */
export function readSpeechSimulationMode(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): SpeechSimulationMode {
  if (environment.PAGES_STT_SIMULATION !== "1") return INACTIVE;
  if (environment.NODE_ENV === "production") {
    logEvent({
      level: "warn",
      event: "speech.simulation.ignored",
      component: COMPONENT,
      message:
        "PAGES_STT_SIMULATION is ignored because NODE_ENV is production.",
    });
    console.warn(
      "[pages] PAGES_STT_SIMULATION=1 is ignored because NODE_ENV=production.",
    );
    return INACTIVE;
  }
  const scenario = readScenario(environment.PAGES_STT_SIMULATION_SCENARIO);
  logEvent({
    level: "info",
    event: "speech.simulation.active",
    component: COMPONENT,
    message:
      "The speech recognition simulation is active; no provider is contacted.",
    metadata: { kind: scenario },
  });
  console.info(
    `[pages] Speech recognition simulation active (scenario ${scenario}); no request goes to a provider.`,
  );
  return { isActive: true, scenario };
}

let processMode: SpeechSimulationMode | null = null;

/**
 * The simulation switch of this process, read and logged once.
 *
 * @returns The same mode on every call.
 */
export function currentSpeechSimulationMode(): SpeechSimulationMode {
  processMode ??= readSpeechSimulationMode();
  return processMode;
}

/**
 * The fixed text of the simulation; it names the bytes received, so a
 * caller can check that the audio arrived completely.
 *
 * @param bytes - The size of the received audio.
 * @returns The recognized text of the simulation.
 */
export function simulatedSpeechText(bytes: number): string {
  return `Simulierte Spracherkennung: ${bytes} Bytes empfangen.`;
}
