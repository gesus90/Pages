const progress = new Map<string, number>();
const MAXIMUM_IDLE_MS = 120_000;

/** Records successful queue work, including an empty database poll, rather than timer activity. */
export function recordServiceProgress(worker: string): void {
  progress.set(worker, Date.now());
}

/** Requires recent successful work from every consumer belonging to this process. */
export function hasServiceProgress(workers: readonly string[]): boolean {
  return workers.every((worker) => {
    const lastProgress = progress.get(worker);
    return (
      lastProgress !== undefined && Date.now() - lastProgress < MAXIMUM_IDLE_MS
    );
  });
}
