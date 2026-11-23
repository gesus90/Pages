import { describe, expect, it } from "vitest";

import { readPlanProgress } from "@/backend/agents/AgentPlanProgressInput";

const VIEW = {
  runId: "run",
  stepId: "step",
  attemptId: "attempt",
  ticketId: "t",
  ticketKey: "K-1",
  statusKey: "open",
  requirementsHash: "r",
  contentHash: "c",
  requiredChecks: [],
  items: [],
  record: null,
  issues: [],
};

const BASE = {
  source: "live",
  observedAt: "2026-01-01T00:00:00.000Z",
  todos: [{ id: "todo", text: "Do it", status: "open" }],
};

function rejects(input: unknown): void {
  expect(() => readPlanProgress(input)).toThrowError(
    expect.objectContaining({ code: "plan_invalid" }),
  );
}

describe("readPlanProgress", () => {
  it("reads a minimal live progress", () => {
    expect(readPlanProgress(BASE)).toEqual(BASE);
    expect(readPlanProgress({ ...BASE, source: "historical" }).source).toBe(
      "historical",
    );
  });

  it.each(["done", "active", "open", "failed", "missing", "unreported"])(
    "accepts the item status %s",
    (status) => {
      const todos = [{ id: "todo", text: "", status }];
      expect(readPlanProgress({ ...BASE, todos }).todos).toEqual(todos);
    },
  );

  it("reads item contracts and tickets", () => {
    const todos = [
      {
        id: "todo",
        text: "Do it",
        status: "done",
        contractId: "contract",
        ticket: { id: "t", key: "K-1", itemId: "i" },
      },
    ];
    expect(readPlanProgress({ ...BASE, todos }).todos).toEqual(todos);
  });

  it("reads work views, scope, observation and activity", () => {
    const tickets = [{ id: "t", key: "K-1", contentHash: "hash" }];
    const progress = {
      ...BASE,
      work: [VIEW],
      availability: "observed",
      tickets,
      scope: { runId: "run", stepId: "step", attemptId: "attempt" },
      activity: { text: "Working", reportedAt: "2026-01-01T00:00:00.000Z" },
    };
    expect(readPlanProgress(progress)).toEqual(progress);
    expect(
      readPlanProgress({
        ...BASE,
        availability: "unavailable",
        scope: { runId: "run", stepId: "step", attemptId: null },
      }),
    ).toMatchObject({
      availability: "unavailable",
      scope: { attemptId: null },
    });
  });

  it("shortens a long activity text", () => {
    const activity = {
      text: "x".repeat(300),
      reportedAt: "2026-01-01T00:00:00.000Z",
    };
    expect(readPlanProgress({ ...BASE, activity }).activity?.text).toHaveLength(
      200,
    );
  });

  it("rejects malformed progress", () => {
    rejects({ ...BASE, work: "view" });
    rejects({ ...BASE, source: "stale" });
    rejects({ ...BASE, todos: "none" });
    rejects({ ...BASE, observedAt: "" });
    rejects({ ...BASE, availability: "maybe" });
    rejects({ ...BASE, tickets: {} });
    rejects({ ...BASE, tickets: [{ id: "t", key: "K-1", contentHash: "" }] });
    rejects("progress");
  });

  it("rejects malformed items", () => {
    rejects({ ...BASE, todos: [{ id: "a", text: "t", status: "later" }] });
    rejects({ ...BASE, todos: [{ id: "a", text: 1, status: "open" }] });
    rejects({ ...BASE, todos: [{ id: "", text: "t", status: "open" }] });
    rejects({
      ...BASE,
      todos: [{ id: "a", text: "t", status: "open", contractId: "" }],
    });
    rejects({
      ...BASE,
      todos: [{ id: "a", text: "t", status: "open", ticket: {} }],
    });
  });

  it("rejects a malformed scope and activity", () => {
    rejects({ ...BASE, scope: { runId: "run", stepId: "step" } });
    rejects({ ...BASE, activity: { text: 1, reportedAt: "now" } });
  });
});
