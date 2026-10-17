import { AsyncLocalStorage } from "node:async_hooks";

interface DatabaseLogSummary {
  readonly databaseQueries: number;
  readonly databaseTotalMs: number;
  readonly databaseSlowestMs: number;
  readonly databaseSlowestStatementId: string | null;
  readonly databaseSlowestOperation: string | null;
  readonly databaseTransactionsCommitted: number;
  readonly databaseTransactionsRolledBack: number;
}

const scopes = new AsyncLocalStorage<readonly DatabaseLogMetrics[]>();
let unscoped: DatabaseLogMetrics | null = null;

/** Bounded statement totals for one request, job, initialization or transaction. */
export class DatabaseLogMetrics {
  private queries = 0;
  private totalMs = 0;
  private slowestMs = 0;
  private slowestStatementId: string | null = null;
  private slowestOperation: string | null = null;
  private transactionsCommitted = 0;
  private transactionsRolledBack = 0;
  private isClosed = false;

  /** Whether work can still contribute before this boundary's closing event. */
  public isActive(): boolean {
    return !this.isClosed;
  }

  /** Counts one attempted statement, without retaining its text or parameters. */
  public record(
    operation: string,
    statementId: string,
    durationMs: number,
  ): void {
    this.queries += 1;
    this.totalMs += durationMs;
    if (this.slowestStatementId !== null && durationMs <= this.slowestMs)
      return;
    this.slowestMs = durationMs;
    this.slowestStatementId = statementId;
    this.slowestOperation = operation;
  }

  /** Counts transaction outcomes, also in each enclosing operation. */
  public recordTransaction(outcome: "committed" | "rolled_back"): void {
    if (outcome === "committed") this.transactionsCommitted += 1;
    else this.transactionsRolledBack += 1;
  }

  /** Returns safe, rounded primitives for the enclosing operation's completion event. */
  public summary(): DatabaseLogSummary {
    return {
      databaseQueries: this.queries,
      databaseTotalMs: Math.round(this.totalMs * 1_000) / 1_000,
      databaseSlowestMs: Math.round(this.slowestMs * 1_000) / 1_000,
      databaseSlowestStatementId: this.slowestStatementId,
      databaseSlowestOperation: this.slowestOperation,
      databaseTransactionsCommitted: this.transactionsCommitted,
      databaseTransactionsRolledBack: this.transactionsRolledBack,
    };
  }

  /** Closes this boundary so late work contributes to its own scope or the fallback aggregate. */
  public finish(): DatabaseLogSummary {
    this.isClosed = true;
    return this.summary();
  }
}

/** Adds an async-local scope; nested transactions also contribute once to their parent request/job. */
export function withDatabaseLogMetrics<Result>(
  work: (metrics: DatabaseLogMetrics) => Result,
): Result {
  const metrics = new DatabaseLogMetrics();
  return scopes.run([...(scopes.getStore() ?? []), metrics], () =>
    work(metrics),
  );
}

/** Updates every enclosing scope without per-statement log records or retained statement lists. */
export function recordDatabaseLogMetrics(
  operation: string,
  statementId: string,
  durationMs: number,
): void {
  const active = (scopes.getStore() ?? []).filter((metrics) =>
    metrics.isActive(),
  );
  if (active.length === 0) {
    unscoped ??= new DatabaseLogMetrics();
    unscoped.record(operation, statementId, durationMs);
  }
  for (const metrics of active)
    metrics.record(operation, statementId, durationMs);
}

/** Counts an outcome and reports whether a parent operation will emit its aggregate. */
export function recordDatabaseTransaction(
  outcome: "committed" | "rolled_back",
): boolean {
  const active = (scopes.getStore() ?? []).filter((metrics) =>
    metrics.isActive(),
  );
  for (const metrics of active) metrics.recordTransaction(outcome);
  return active.length > 1;
}

/** Drains the bounded fallback aggregate for work outside a request/job/transaction scope. */
export function takeUnscopedDatabaseLogMetrics(): DatabaseLogSummary | null {
  const summary = unscoped?.summary() ?? null;
  unscoped = null;
  return summary;
}
