import { logEvent } from "@/backend/logging/Logger";

/** Names of the server settings that switch on and shape the simulated Drive. */
export const GOOGLE_DRIVE_SIMULATION_SETTING_NAMES = {
  enabled: "PAGES_GOOGLE_DRIVE_SIMULATION",
  scenario: "PAGES_GOOGLE_DRIVE_SIMULATION_SCENARIO",
} as const;

/** Every scenario of the simulated Drive. */
export const GOOGLE_DRIVE_SIMULATION_SCENARIOS = [
  "full",
  "read_only",
  "item_forbidden",
  "unreachable",
] as const;

/**
 * How the simulated Drive behaves.
 *
 * - `full`: read and write access (the default).
 * - `read_only`: only the read scope is granted; every change is refused.
 * - `item_forbidden`: entries whose name starts with `gesperrt` answer 403.
 * - `unreachable`: Drive does not answer at all.
 */
export type GoogleDriveSimulationScenario =
  (typeof GOOGLE_DRIVE_SIMULATION_SCENARIOS)[number];

/** The active simulation of one server process. */
export interface GoogleDriveSimulationSettings {
  readonly scenario: GoogleDriveSimulationScenario;
}

function readScenario(text: string | undefined): GoogleDriveSimulationScenario {
  const wanted = text?.trim() ?? "";

  return (
    GOOGLE_DRIVE_SIMULATION_SCENARIOS.find((scenario) => scenario === wanted) ??
    "full"
  );
}

/**
 * Reads whether the simulated Google Drive (PAGE-270) is switched on.
 *
 * @param environment - Environment variables of the server process.
 * @returns The scenario, or `null` when the simulation is off.
 *
 * @remarks
 * `NODE_ENV=production` always wins: the setting is then ignored and the
 * ignoring logged, so a real instance never answers from simulated data.
 * An unknown scenario falls back to `full`.
 */
export function readGoogleDriveSimulation(
  environment: NodeJS.ProcessEnv = process.env,
): GoogleDriveSimulationSettings | null {
  if (environment[GOOGLE_DRIVE_SIMULATION_SETTING_NAMES.enabled] !== "1") {
    return null;
  }

  if (environment["NODE_ENV"] === "production") {
    logEvent({
      component: "GoogleDriveSimulation",
      event: "google_drive.simulation_ignored",
      level: "warn",
      message:
        "PAGES_GOOGLE_DRIVE_SIMULATION is ignored because NODE_ENV is production.",
    });

    return null;
  }

  const scenario = readScenario(
    environment[GOOGLE_DRIVE_SIMULATION_SETTING_NAMES.scenario],
  );

  logEvent({
    component: "GoogleDriveSimulation",
    event: "google_drive.simulation_active",
    level: "warn",
    message:
      "Google Drive is simulated in memory; no request reaches Google and no real data is shown.",
    metadata: { kind: scenario },
  });

  return { scenario };
}
