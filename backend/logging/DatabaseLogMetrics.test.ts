import { expect, it } from "vitest";

import {
  DatabaseLogMetrics,
  recordDatabaseLogMetrics,
  recordDatabaseTransaction,
  recordDatabaseWaitMetrics,
  takeUnscopedDatabaseLogMetrics,
  withDatabaseLogMetrics,
} from "./DatabaseLogMetrics";

it("keeps the first slowest statement and replaces it only when a later one is slower", () => {
  const metrics = new DatabaseLogMetrics();

  metrics.record("select", "statement-a", 5);
  metrics.record("update", "statement-b", 5);
  metrics.record("insert", "statement-c", 9.0004);

  expect(metrics.summary()).toMatchObject({
    databaseQueries: 3,
    databaseTotalMs: 19.0,
    databaseSlowestMs: 9,
    databaseSlowestStatementId: "statement-c",
    databaseSlowestOperation: "insert",
  });
});

it("separates queue and transfer waits from execution time and counts outcomes", () => {
  const metrics = new DatabaseLogMetrics();

  metrics.recordWait(1.25, 0.5);
  metrics.recordWait(2, 0.25);
  metrics.recordTransaction("committed");
  metrics.recordTransaction("rolled_back");
  metrics.recordTransaction("rolled_back");

  expect(metrics.summary()).toMatchObject({
    databaseQueries: 0,
    databaseQueueMs: 3.25,
    databaseIpcMs: 0.75,
    databaseTransactionsCommitted: 1,
    databaseTransactionsRolledBack: 2,
  });
});

it("stops accepting work for a finished boundary", () => {
  const metrics = new DatabaseLogMetrics();
  metrics.record("select", "statement-a", 2);

  const finalSummary = metrics.finish();

  expect(metrics.isActive()).toBe(false);
  expect(finalSummary.databaseQueries).toBe(1);
});

it("adds statements to every active enclosing scope exactly once", () => {
  const outerTotals = withDatabaseLogMetrics((outer) => {
    withDatabaseLogMetrics((inner) => {
      recordDatabaseLogMetrics("select", "statement-nested", 3);
      expect(inner.summary().databaseQueries).toBe(1);
    });
    return outer.summary();
  });

  expect(outerTotals.databaseQueries).toBe(1);
  expect(outerTotals.databaseSlowestStatementId).toBe("statement-nested");
});

it("reports whether a transaction has a parent that will emit its aggregate", () => {
  expect(recordDatabaseTransaction("committed")).toBe(false);

  withDatabaseLogMetrics((outer) => {
    expect(recordDatabaseTransaction("committed")).toBe(false);
    expect(outer.summary().databaseTransactionsCommitted).toBe(1);
    withDatabaseLogMetrics((inner) => {
      expect(recordDatabaseTransaction("rolled_back")).toBe(true);
      expect(inner.summary().databaseTransactionsRolledBack).toBe(1);
    });
  });
});

it("routes waits and statements outside a scope to the fallback aggregate", () => {
  takeUnscopedDatabaseLogMetrics();

  recordDatabaseLogMetrics("select", "statement-loose", 6);
  recordDatabaseWaitMetrics(1, 2);
  recordDatabaseLogMetrics("update", "statement-loose-2", 1);

  expect(takeUnscopedDatabaseLogMetrics()).toMatchObject({
    databaseQueries: 2,
    databaseTotalMs: 7,
    databaseSlowestStatementId: "statement-loose",
    databaseQueueMs: 1,
    databaseIpcMs: 2,
  });
  expect(takeUnscopedDatabaseLogMetrics()).toBeNull();
});

it("creates the fallback aggregate when a wait is the first unscoped event", () => {
  takeUnscopedDatabaseLogMetrics();

  recordDatabaseWaitMetrics(2, 1);
  recordDatabaseWaitMetrics(1, 0);

  expect(takeUnscopedDatabaseLogMetrics()).toMatchObject({
    databaseQueries: 0,
    databaseQueueMs: 3,
    databaseIpcMs: 1,
  });
});

it("adds waits to every active enclosing scope and not to the fallback aggregate", () => {
  takeUnscopedDatabaseLogMetrics();

  const scopedSummary = withDatabaseLogMetrics((metrics) => {
    recordDatabaseWaitMetrics(4, 2);
    return metrics.summary();
  });

  expect(scopedSummary).toMatchObject({ databaseQueueMs: 4, databaseIpcMs: 2 });
  expect(takeUnscopedDatabaseLogMetrics()).toBeNull();
});

it("sends statements of a finished scope to the fallback aggregate", () => {
  takeUnscopedDatabaseLogMetrics();

  withDatabaseLogMetrics((scope) => {
    scope.finish();
    recordDatabaseLogMetrics("select", "statement-late", 4);
    recordDatabaseWaitMetrics(0.5, 0.5);
    expect(recordDatabaseTransaction("committed")).toBe(false);
  });

  expect(takeUnscopedDatabaseLogMetrics()).toMatchObject({
    databaseQueries: 1,
    databaseQueueMs: 0.5,
    databaseIpcMs: 0.5,
    databaseTransactionsCommitted: 0,
  });
});
