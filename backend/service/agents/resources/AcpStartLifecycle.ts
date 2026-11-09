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
  /** Persists that native process creation begins; it must complete before the spawn. */
  beforeSpawn(): Promise<void>;
}
