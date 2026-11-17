/**
 * Wakes the waiters of calls inside this process.
 * @remarks
 * A wake-up only tells a waiter to look at the stored call again; it carries
 * no decision. The call register decides, so a missed or doubled wake-up
 * never changes an outcome.
 */
export class AgentPlanInvocationWakeups {
  private readonly waiters = new Map<string, Set<() => void>>();

  /**
   * Registers a waiter of one call.
   * @returns Removes the waiter again.
   */
  public subscribe(invocationId: string, wake: () => void): () => void {
    const entries = this.waiters.get(invocationId) ?? new Set<() => void>();
    entries.add(wake);
    this.waiters.set(invocationId, entries);
    return () => {
      entries.delete(wake);
      if (entries.size === 0) this.waiters.delete(invocationId);
    };
  }

  /** Wakes every waiter of one call. */
  public notify(invocationId: string): void {
    for (const wake of [...(this.waiters.get(invocationId) ?? [])]) wake();
  }

  /** Wakes every waiter of every call, after something changed that concerns any of them. */
  public notifyAll(): void {
    for (const id of [...this.waiters.keys()]) this.notify(id);
  }
}
