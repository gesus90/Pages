/**
 * Lets a start callback record when native process creation begins (PAGE-264).
 *
 * @remarks
 * Only a callback that declared tracking lets a failure before
 * {@link AcpStartLifecycle.beforeSpawn} count as "never started"; every other
 * failed start stays unconfirmed, because nothing proves it spawned nothing.
 */
export interface AcpStartLifecycle {
  /** Declares that this callback calls `beforeSpawn` before every native process creation. */
  trackSpawn(): void;
  /**
   * Persists that native process creation begins; it must complete before the spawn.
   *
   * @param unit - The worker unit the process starts in, as evidence of its end (PAGE-335).
   */
  beforeSpawn(unit?: string): Promise<void>;
  /**
   * Declares that a start which failed after its spawn confirmed the end of
   * every process it created through its process frame (PAGE-340); the
   * reservation of the failed start may then be released.
   */
  confirmStartEnded(): void;
}
