/** The scope identity recorded by the host before it releases a worker. */
export interface RunnerScope {
  readonly unit: string;
  readonly path: string;
}

/** The immutable unit name derived from the job identifier. */
export function scopeUnit(jobId: string): string;

/** Ends every process in the owned scope and confirms its absence. */
export function stopScope(
  scope: RunnerScope,
  jobId: string,
): Promise<"confirmed" | "failed">;
