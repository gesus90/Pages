const DEFAULT_INTERVAL_MS = 60_000;
const MAXIMUM_TRACKED_KEYS = 64;

/**
 * Lets an identical log line through at most once per interval.
 *
 * @remarks
 * A broken Firebase project or an unreachable Google endpoint fails every
 * message the same way. The throttle keeps such a failure from flooding the log
 * while the first occurrence of each distinct failure is still reported.
 */
export class FcmLogThrottle {
  private readonly lastAllowedAtMs = new Map<string, number>();
  private readonly now: () => number;
  private readonly intervalMs: number;

  /**
   * Creates a throttle.
   *
   * @param now - Clock in milliseconds.
   * @param intervalMs - Minimum time between two lines with the same key.
   */
  public constructor(now: () => number, intervalMs: number = DEFAULT_INTERVAL_MS) {
    this.now = now;
    this.intervalMs = intervalMs;
  }

  /**
   * Tells whether a line with this key may be written now, and counts it when so.
   *
   * @param key - Identifies the kind of line; keep the set of keys small.
   * @returns `false` when a line with the same key was allowed within the interval.
   */
  public allow(key: string): boolean {
    const nowMs = this.now();
    const lastMs = this.lastAllowedAtMs.get(key);

    // A clock that stepped backwards must not silence the line until it catches up.
    if (lastMs !== undefined && nowMs >= lastMs && nowMs - lastMs < this.intervalMs) {
      return false;
    }

    if (!this.lastAllowedAtMs.has(key) && this.lastAllowedAtMs.size >= MAXIMUM_TRACKED_KEYS) {
      this.lastAllowedAtMs.clear();
    }

    this.lastAllowedAtMs.set(key, nowMs);

    return true;
  }
}
