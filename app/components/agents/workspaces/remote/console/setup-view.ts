import { INITIAL_SETUP_PROGRESS, SETUP_PHASES } from "@/definition/RemoteSetup";

import type { RemoteConsoleState } from "@/definition/RemoteConsole";
import type { SetupProgress } from "@/definition/RemoteSetup";
import type { ConsoleView } from "./console-view";

/** A console that never reported progress stopped before the script: phase 1 failed. */
const FAILED_FIRST_PHASE: SetupProgress = {
  ...INITIAL_SETUP_PROGRESS,
  phases: SETUP_PHASES.map((_, index) => (index === 0 ? "failed" : "pending")),
  step: "rights",
  outcome: "failed",
};

/**
 * The progress the panel draws, also when the server stopped the run before it reported any.
 *
 * @remarks
 * A refusal at the start, such as a missing right or a confirmed
 * installation, answers with an error instead of progress. It is phase 1 that
 * failed, so the panel shows the same sequence with its reason.
 *
 * @param state - The console state.
 * @param view - What the panel shows.
 * @returns The progress to draw.
 */
export function effectiveSetupProgress(
  state: RemoteConsoleState,
  view: ConsoleView,
): SetupProgress {
  if (state.setup !== null) return state.setup;
  const isStopped = state.status === "blocked" || state.status === "ended";
  if (isStopped && state.message !== null && view !== "connecting")
    return { ...FAILED_FIRST_PHASE, reason: state.message };
  return {
    ...INITIAL_SETUP_PROGRESS,
    phases: ["running", ...INITIAL_SETUP_PROGRESS.phases.slice(1)],
  };
}

/**
 * The phase the sequence is at: the one that runs, waits or failed, else the next to begin.
 *
 * @param progress - The progress to draw.
 * @returns The zero-based index, or the number of phases when every phase is settled.
 */
export function shownPhaseIndex(progress: SetupProgress): number {
  const marked = progress.phases.findIndex(
    (phase) => phase === "running" || phase === "waiting" || phase === "failed",
  );
  if (marked >= 0) return marked;
  const open = progress.phases.findIndex(
    (phase) => phase !== "done" && phase !== "skipped",
  );
  return open < 0 ? SETUP_PHASES.length : open;
}
