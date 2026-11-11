import type { AgentPlanControl } from "@/definition/AgentPlanControl";

/** The colour family of the status marker. */
export type PlanPanelTone =
  "ready" | "blocked" | "active" | "paused" | "neutral" | "error" | "open";

/**
 * The one line the collapsed panel shows: a status marker and a short sentence.
 *
 * @remarks
 * `state` names the translation `plans.panel.state.<state>.label` and `.hint`;
 * `variant` picks another hint of the same state.
 */
export interface PlanPanelState {
  readonly state: string;
  readonly tone: PlanPanelTone;
  readonly variant?: string;
}

/** What the status line is derived from; all of it comes from the server or the draft. */
export interface PlanPanelStateInput {
  readonly hasPlan: boolean;
  readonly control: AgentPlanControl | undefined;
  readonly isDirty: boolean;
  readonly isReadOnly: boolean;
  /** The refusal of the last request of the panel, as an error code. */
  readonly actionError: string | null;
  /** The last request was refused because the plan has findings. */
  readonly hasRefusedIssues: boolean;
  /** Every remaining step of the running run waits behind a failure. */
  readonly isRunBlocked: boolean;
}

const RUN_STATES: Readonly<Record<string, PlanPanelState>> = {
  stopping: { state: "stopping", tone: "active" },
  pausing: { state: "pausing", tone: "active" },
};

function pausedState(control: AgentPlanControl): PlanPanelState {
  return control.canResume
    ? { state: "paused", tone: "paused" }
    : { state: "pausedBlocked", tone: "blocked" };
}

/** Which hint an ended run shows: continuable, run by another executor, or plainly ended. */
function endedVariant(input: PlanPanelStateInput): string | undefined {
  if (input.control?.canResume) return "resumable";
  return input.control?.resumeBlocker === "own_run_required"
    ? "foreign"
    : undefined;
}

function endedState(input: PlanPanelStateInput): PlanPanelState | null {
  const control = input.control;
  // The work is done, so this reads apart from a failure, also while the recovery view still loads.
  if (control?.status === "work_done_closeout_open")
    return {
      state: "work_done_closeout_open",
      tone: "open",
      variant: endedVariant(input),
    };
  if (control?.status === "failed")
    return {
      state: control.resumeKind === "interrupted" ? "interrupted" : "failed",
      tone: "blocked",
      variant: endedVariant(input),
    };
  // A stopped run with a safe state continues like a failed one; without it, it reads as ready.
  if (control?.status === "cancelled" && control.resumeKind)
    return { state: "stopped", tone: "open", variant: endedVariant(input) };
  if (!control?.canPlay) return { state: "blocked", tone: "blocked" };
  if (control.status === "succeeded" || control.status === "cancelled")
    return { state: "ready", tone: "ready", variant: control.status };
  return null;
}

/**
 * Derives the status line of the plan panel.
 *
 * @remarks
 * An active run speaks first, honestly in its intermediate states: a
 * requested pause is not yet a pause. Without one, unsaved changes, missing
 * rights and findings explain why Starten is unavailable before a plan reads
 * as ready.
 */
export function planPanelState(input: PlanPanelStateInput): PlanPanelState {
  const { control } = input;
  if (!input.hasPlan) return { state: "none", tone: "neutral" };
  if (input.hasRefusedIssues) return { state: "blocked", tone: "blocked" };
  if (input.actionError) return { state: "error", tone: "error" };
  if (!control) return { state: "checking", tone: "neutral" };
  const runState = RUN_STATES[control.status];
  if (runState) return runState;
  if (control.status === "paused") return pausedState(control);
  if (control.status === "running")
    return input.isRunBlocked
      ? { state: "runBlocked", tone: "blocked" }
      : { state: "running", tone: "active" };
  if (input.isReadOnly) return { state: "readOnly", tone: "neutral" };
  if (input.isDirty) return { state: "unsaved", tone: "neutral" };
  return endedState(input) ?? { state: "ready", tone: "ready" };
}
