import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";

/** One run's reversible execution barrier; cancellation always wins over pause. */
export class AgentPlanPauseGate {
  private isPaused = false;
  private readonly listeners = new Set<(paused: boolean) => void>();
  private readonly waiters = new Set<() => void>();

  /** Closes the barrier synchronously before any asynchronous process control. */
  public pause(): void {
    this.isPaused = true;
    for (const listener of this.listeners) listener(true);
  }

  /**
   * Opens the same barrier without replacing any execution or its signal.
   *
   * @remarks
   * Waiters wake at once, so a turn that finished during the pause is recorded
   * as soon as the run goes on, not at the next poll.
   */
  public resume(): void {
    this.isPaused = false;
    for (const listener of this.listeners) listener(false);
    for (const wake of this.waiters) wake();
  }

  /** Observes changes, including a pause that preceded registration. */
  public listen(listener: (paused: boolean) => void): () => void {
    this.listeners.add(listener);
    listener(this.isPaused);
    return () => this.listeners.delete(listener);
  }

  /** Waits without holding the engine write queue; resume and Stop wake the wait immediately. */
  public async wait(signal: AbortSignal): Promise<void> {
    while (this.isPaused && !signal.aborted) await this.untilChange(signal);
    if (signal.aborted) throw new AgentPlanCancelledError();
  }

  private untilChange(signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve) => {
      const wake = (): void => {
        this.waiters.delete(wake);
        signal.removeEventListener("abort", wake);
        resolve();
      };
      this.waiters.add(wake);
      signal.addEventListener("abort", wake, { once: true });
    });
  }
}

const gates = new Map<string, AgentPlanPauseGate>();

/** Shares one barrier with outer nodes, loop members and request providers. */
export function planPauseGate(runId: string): AgentPlanPauseGate {
  let gate = gates.get(runId);
  if (!gate) {
    gate = new AgentPlanPauseGate();
    gates.set(runId, gate);
  }
  return gate;
}

/** Drops only a terminal run's barrier after waking cancelled waiters. */
export function forgetPlanPauseGate(runId: string): void {
  gates.get(runId)?.resume();
  gates.delete(runId);
}
