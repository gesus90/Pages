/** Heartbeats one account may send per window. */
export const PRESENCE_HEARTBEATS_PER_WINDOW = 120;

/** The window of the heartbeat limit. */
export const PRESENCE_HEARTBEAT_WINDOW_MILLISECONDS = 60_000;

interface HeartbeatWindow {
  readonly count: number;
  readonly until: number;
}

/**
 * Limits the browser presence heartbeats of each account (PAGE-421).
 *
 * @remarks
 * Each account has one fixed window. At most once per window every expired
 * window of every account is removed, so accounts that stopped sending
 * leave no entry behind.
 */
export class PresenceHeartbeatLimit {
  private readonly calls = new Map<string, HeartbeatWindow>();
  private readonly now: () => number;
  private nextSweep = 0;

  /** Creates the limit with a clock that tests can advance. */
  public constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /**
   * Counts one heartbeat of the account.
   *
   * @param accountId - The signed-in account.
   * @returns Whether the heartbeat is within the limit.
   */
  public permit(accountId: string): boolean {
    const now = this.now();
    this.sweep(now);
    const current = this.calls.get(accountId);
    if (current === undefined || current.until <= now) {
      this.calls.set(accountId, {
        count: 1,
        until: now + PRESENCE_HEARTBEAT_WINDOW_MILLISECONDS,
      });
      return true;
    }
    if (current.count >= PRESENCE_HEARTBEATS_PER_WINDOW) return false;
    this.calls.set(accountId, {
      count: current.count + 1,
      until: current.until,
    });
    return true;
  }

  /** Counts the accounts the limit still holds a window for. */
  public get size(): number {
    return this.calls.size;
  }

  private sweep(now: number): void {
    if (now < this.nextSweep) return;
    this.nextSweep = now + PRESENCE_HEARTBEAT_WINDOW_MILLISECONDS;
    for (const [accountId, window] of this.calls)
      if (window.until <= now) this.calls.delete(accountId);
  }
}

declare global {
  var pagesPresenceHeartbeatLimit: PresenceHeartbeatLimit | undefined;
}

/**
 * The one heartbeat limit of the process.
 *
 * @returns The same limit on every call.
 */
export function sharedPresenceHeartbeatLimit(): PresenceHeartbeatLimit {
  globalThis.pagesPresenceHeartbeatLimit ??= new PresenceHeartbeatLimit();
  return globalThis.pagesPresenceHeartbeatLimit;
}
