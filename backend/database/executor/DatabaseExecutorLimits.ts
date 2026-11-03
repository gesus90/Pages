/**
 * Every budget and bound of the database executor in one place (PAGE-197).
 *
 * @remarks
 * The values are conservative for a single self-hosted server; see
 * `docs/DatabaseExecutor.md` for the reasoning behind each of them.
 */
export const DATABASE_EXECUTOR_LIMITS = {
  /**
   * Reader connections next to the single writer. Every running DuckDB call
   * occupies one thread of the worker's libuv pool (4 threads), so writer
   * plus two readers leave one thread for the worker's own file access.
   */
  readerConnections: 2,
  /** Reads the server keeps in flight to the worker; more wait in the server. */
  readsInFlight: 4,
  /** Reads that may wait in the server before new ones are refused. */
  maximumQueuedReads: 512,
  /** Writer jobs (statements and whole transactions) that may wait. */
  maximumQueuedWrites: 256,
  /** Of those, writer jobs of recurring background work. */
  maximumQueuedBackgroundWrites: 32,
  /** Longest wait of a read for its turn before it is refused unstarted. */
  readQueueBudgetMs: 10_000,
  /**
   * Longest wait of a writer job of an HTTP request for its turn. A request
   * then answers 503 with Retry-After instead of loading without end.
   */
  requestWriteQueueBudgetMs: 25_000,
  /**
   * Longest wait of a writer job outside a request, such as agent
   * persistence. It is long, because refusing a run's progress costs more
   * than waiting for a slow commit; it still ends every wait.
   */
  backgroundWriteQueueBudgetMs: 600_000,
  /** Largest estimated result of one statement, in bytes. */
  maximumResultBytes: 64 * 1024 * 1024,
  /** Largest estimated set of bound values of one statement, in bytes. */
  maximumParameterBytes: 64 * 1024 * 1024,
  /** Longest wait for the worker to open the database at start. */
  openTimeoutMs: 120_000,
  /**
   * Longest wait at stop for the jobs already accepted, before the worker
   * closes. Only jobs that still have to send a statement can miss it: a COMMIT
   * already sent finishes in the worker, however long its checkpoint takes.
   */
  drainTimeoutMs: 15_000,
  /** Longest wait for the worker to checkpoint and close at stop. */
  closeTimeoutMs: 120_000,
  /** Longest wait for the worker process to exit after it closed or timed out. */
  exitTimeoutMs: 5_000,
  /** Restarts after unexpected worker exits before the executor gives up. */
  maximumRestarts: 3,
  /** Delay before the first restart; it doubles for every further one. */
  restartDelayMs: 1_000,
  /** Window after which earlier unexpected exits no longer count. */
  restartWindowMs: 10 * 60 * 1000,
  /** Budget of the database probe of `/health`. */
  healthProbeBudgetMs: 3_000,
} as const;
