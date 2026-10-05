/**
 * Runs asynchronous tasks one after another in the order they were submitted.
 *
 * @remarks
 * Pages runs as one Node.js process, so a queue in memory is enough to keep
 * read-then-write sequences of parallel requests from interleaving.
 */
export class SerialQueue {
  private pendingWork: Promise<void> = Promise.resolve();

  /**
   * Starts a task once every earlier task finished.
   *
   * @param task - Work to run exclusively.
   * @returns The task's result; a failing task does not block later ones.
   */
  public run<Result>(task: () => Promise<Result>): Promise<Result> {
    const result = this.pendingWork.then(task);

    this.pendingWork = result.then(ignoreOutcome, ignoreOutcome);

    return result;
  }

  /** Resolves once every submitted task finished. */
  public async idle(): Promise<void> {
    await this.pendingWork;
  }
}

/** Keeps the queue alive after a task failed. */
function ignoreOutcome(): void {}
