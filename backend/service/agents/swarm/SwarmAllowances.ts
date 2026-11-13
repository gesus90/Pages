import { findSwarmViolations } from "./SwarmWorkspaceState";

import type { AgentPlanSwarmViolation } from "@/definition/AgentPlanSwarmRun";
import type {
  SwarmAllowance,
  SwarmWorkspaceState,
} from "./SwarmWorkspaceState";

interface MutableAllowance {
  readonly scope: Set<string>;
  readonly locks: Set<string>;
}

/**
 * What every running subtask may see changed during its period (PAGE-313).
 *
 * @remarks
 * A subtask collects the areas and locks of every helper that was active
 * at any time while it ran, its own included. So a change that another
 * helper was allowed to make is never a violation of this subtask, and a
 * change nobody was allowed names every helper active in the period.
 */
export class SwarmAllowances {
  private readonly periods = new Map<string, Map<string, MutableAllowance>>();
  private readonly reported = new Set<string>();

  /**
   * Opens the period of a subtask.
   *
   * @param taskId - The subtask that starts.
   * @param active - Area and locks of every helper active now, the starting one included.
   */
  public open(taskId: string, active: readonly SwarmAllowance[]): void {
    const period = new Map<string, MutableAllowance>();
    this.periods.set(taskId, period);
    for (const allowance of active) this.add(allowance);
  }

  /** Adds an area or a lock to the period of every running subtask. */
  public add(allowance: SwarmAllowance): void {
    for (const period of this.periods.values()) {
      const entry = period.get(allowance.workerId) ?? {
        scope: new Set<string>(),
        locks: new Set<string>(),
      };
      for (const path of allowance.scope) entry.scope.add(path);
      for (const path of allowance.locks) entry.locks.add(path);
      period.set(allowance.workerId, entry);
    }
  }

  /**
   * Closes the period of a subtask and finds its violations.
   *
   * @returns The violations not reported before; a file changed once is
   * reported once, also when several periods saw it.
   */
  public close(
    taskId: string,
    states: {
      readonly before: SwarmWorkspaceState;
      readonly after: SwarmWorkspaceState;
      readonly at: string;
    },
  ): readonly AgentPlanSwarmViolation[] {
    const period =
      this.periods.get(taskId) ?? new Map<string, MutableAllowance>();
    this.periods.delete(taskId);
    const allowances = [...period.entries()].map(([workerId, entry]) => ({
      workerId,
      scope: [...entry.scope],
      locks: [...entry.locks],
    }));
    const workerIds = allowances.map((allowance) => allowance.workerId).sort();
    return findSwarmViolations(states.before, states.after, allowances).flatMap(
      (finding) => {
        const files = finding.files.filter((file) =>
          this.isNew(`${file}|${states.after.entries.get(file) ?? "gone"}`),
        );
        const isGitChange = finding.kind !== "outside";
        if (
          isGitChange &&
          !this.isNew(
            `${finding.kind}|${finding.kind === "head" ? states.after.head : states.after.index}`,
          )
        )
          return [];
        if (!isGitChange && files.length === 0) return [];
        return [
          {
            kind: finding.kind,
            taskId,
            workerIds,
            files: files.slice(0, 200),
            at: states.at,
          },
        ];
      },
    );
  }

  /** Forgets the period of a subtask that never ran to its end. */
  public drop(taskId: string): void {
    this.periods.delete(taskId);
  }

  private isNew(key: string): boolean {
    if (this.reported.has(key)) return false;
    this.reported.add(key);
    return true;
  }
}
