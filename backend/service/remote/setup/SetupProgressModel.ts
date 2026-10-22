import {
  INITIAL_SETUP_PROGRESS,
  SETUP_PHASES,
  SETUP_PREPARATION_STEPS,
} from "@/definition/RemoteSetup";

import type {
  SetupOutcome,
  SetupPhaseState,
  SetupPreparationStep,
  SetupProgress,
} from "@/definition/RemoteSetup";
import type { SetupMarker } from "./SetupMarkerFilter";

const SETTLED_STATES: ReadonlySet<SetupPhaseState> = new Set([
  "done",
  "skipped",
]);
const FINISHED_STATES: ReadonlySet<SetupPhaseState> = new Set([
  ...SETTLED_STATES,
  "failed",
]);

function withPhase(
  progress: SetupProgress,
  index: number,
  state: SetupPhaseState,
): SetupProgress {
  return {
    ...progress,
    phases: progress.phases.map((current, position) =>
      position === index ? state : current,
    ),
  };
}

function isStopped(progress: SetupProgress): boolean {
  return progress.outcome !== null || progress.phases.includes("failed");
}

/**
 * The first phase of a run, with Pages still checking the machine before the script starts.
 *
 * @returns The progress at the first preparation step.
 */
export function startedProgress(): SetupProgress {
  return {
    ...withPhase(INITIAL_SETUP_PROGRESS, 0, "running"),
    step: SETUP_PREPARATION_STEPS[0],
  };
}

/**
 * Moves the preparation on to its next step.
 *
 * @param progress - The current progress.
 * @param step - The step that begins now, or `null` once the script runs.
 * @returns The new progress; a stopped run stays as it is.
 */
export function preparationStep(
  progress: SetupProgress,
  step: SetupPreparationStep | null,
): SetupProgress {
  if (isStopped(progress)) return progress;
  return { ...progress, step };
}

/**
 * Applies a progress report of the script.
 *
 * @remarks
 * A phase may only start after every earlier phase is done or skipped, a
 * finished phase is never reopened, and nothing follows a failed phase. A
 * report that breaks these rules changes nothing, so a forged or misordered
 * marker cannot advance the sequence or hide a failure.
 *
 * @param progress - The current progress.
 * @param marker - The report read from the terminal.
 * @returns The new progress, or the same object when the report is not accepted.
 */
export function applyMarker(
  progress: SetupProgress,
  marker: SetupMarker,
): SetupProgress {
  const index = marker.phase - 1;
  const current = progress.phases[index];
  if (current === undefined || isStopped(progress)) return progress;
  if (FINISHED_STATES.has(current)) return progress;
  const isReady = progress.phases
    .slice(0, index)
    .every((state) => SETTLED_STATES.has(state));
  if (!isReady) return progress;
  const next = withPhase(progress, index, marker.state);
  return index === 0 && marker.state !== "failed"
    ? { ...next, step: null }
    : next;
}

/**
 * The index of the phase that runs or waits; with none, the first phase that has not begun.
 *
 * @param progress - The current progress.
 * @returns The zero-based phase index, or the phase count when every phase is settled.
 */
export function currentPhaseIndex(progress: SetupProgress): number {
  const active = progress.phases.findIndex(
    (state) => state === "running" || state === "waiting",
  );
  if (active >= 0) return active;
  const settled = progress.phases.findIndex(
    (state) => !FINISHED_STATES.has(state),
  );
  return settled < 0 ? SETUP_PHASES.length : settled;
}

/**
 * Ends the run with a failure in the phase that was current.
 *
 * @param progress - The current progress.
 * @param end - Translation key naming the cause, and `partial` when part of the installation stands.
 * @returns The progress with the phase failed and no later phase started.
 */
export function failedProgress(
  progress: SetupProgress,
  end: { readonly reason: string; readonly outcome?: "failed" | "partial" },
): SetupProgress {
  if (progress.outcome !== null) return progress;
  const ending = { outcome: end.outcome ?? "failed", reason: end.reason };
  // The script already reported the failed phase; this only records how the run ended.
  if (progress.phases.includes("failed")) return { ...progress, ...ending };
  const index = currentPhaseIndex(progress);
  const failed =
    index >= SETUP_PHASES.length
      ? progress
      : withPhase(progress, index, "failed");
  return { ...failed, ...ending };
}

/**
 * Ends the run with an outcome Pages decided on.
 *
 * @param progress - The current progress.
 * @param end - The outcome and, unless it is confirmed, the reason.
 * @returns The progress with the outcome set.
 */
export function finishedProgress(
  progress: SetupProgress,
  end: { readonly outcome: SetupOutcome; readonly reason: string | null },
): SetupProgress {
  const phases = progress.phases.map((state, index) => {
    if (end.outcome === "confirmed" && index === SETUP_PHASES.length - 1)
      return "done";
    // A run that ends without a result leaves no phase looking as if it still ran.
    return end.outcome !== "confirmed" &&
      (state === "running" || state === "waiting")
      ? "skipped"
      : state;
  });
  return {
    ...progress,
    phases,
    step: null,
    outcome: end.outcome,
    reason: end.reason,
  };
}
