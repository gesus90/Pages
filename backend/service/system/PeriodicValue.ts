import { logCaughtError } from "@/backend/logging/Logger";

/** How often a value may be computed and how its failures are logged. */
export interface PeriodicValueOptions {
  /** The shortest time between two computations. */
  readonly intervalMs: number;
  /** The component named in the log when a computation fails. */
  readonly component: string;
  readonly now: () => number;
}

/**
 * An expensive value that is computed in the background, at most once per interval.
 *
 * @remarks
 * Reading never waits: it answers the last result, `null` until the first
 * one, and starts a new computation once the interval has passed and none is
 * running. A failed computation keeps the previous result.
 */
export class PeriodicValue<T> {
  private readonly options: PeriodicValueOptions;
  private value: T | null = null;
  private startedAt: number | null = null;
  private isComputing = false;

  /**
   * Creates the value without computing it.
   *
   * @param options - Interval, log component and clock.
   */
  public constructor(options: PeriodicValueOptions) {
    this.options = options;
  }

  /**
   * Answers the last result and computes a new one when it is due.
   *
   * @param compute - Computes the value; `null` keeps the previous result.
   * @returns The last result, `null` before the first.
   */
  public current(compute: () => Promise<T | null>): T | null {
    const now = this.options.now();
    const isDue =
      this.startedAt === null ||
      now - this.startedAt >= this.options.intervalMs;
    if (isDue && !this.isComputing) {
      this.startedAt = now;
      this.isComputing = true;
      void this.refresh(compute);
    }
    return this.value;
  }

  private async refresh(compute: () => Promise<T | null>): Promise<void> {
    try {
      const next = await compute();
      if (next !== null) this.value = next;
    } catch (error: unknown) {
      logCaughtError(this.options.component, error);
    } finally {
      this.isComputing = false;
    }
  }
}
