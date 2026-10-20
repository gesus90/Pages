import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanLoopRun } from "@/definition/AgentPlanLoopRun";
import type { AgentPlanSnapshot } from "../AgentPlanSnapshot";

/**
 * What a loop needs from the engine that schedules it.
 *
 * @remarks
 * The engine owns the run: its view, the stop signal and the durable writes.
 * The loop reads and changes only its own state through this boundary, so
 * it never becomes a second scheduler.
 */
export interface LoopHost {
  /** Aborts when the run is stopped; every member of the loop runs under it. */
  readonly signal: AbortSignal;
  readonly run: () => AgentPlanRun;
  /** The frozen plan; a resume may replace it while the loop is paused. */
  readonly snapshot: () => AgentPlanSnapshot;
  /** Whether new work may start: the run is running, not stopped, not paused. */
  readonly canDispatch: () => boolean;
  /** Whether the run is pausing or paused, as opposed to stopped or failed. */
  readonly isPausing: () => boolean;
  /** Rechecks the executor's access to the plan before the loop starts. */
  readonly authorize: () => Promise<void>;
  readonly current: (loopId: string) => AgentPlanLoopRun | undefined;
  /**
   * Changes the state of a loop and writes the run durably.
   *
   * @returns The new state.
   * @throws When the write failed; the engine has then stopped the run.
   */
  readonly update: (
    loopId: string,
    change: (record: AgentPlanLoopRun) => AgentPlanLoopRun,
  ) => Promise<AgentPlanLoopRun>;
}
