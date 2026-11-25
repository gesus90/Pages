import { describe, expect, it } from "vitest";

import { AUTOMATION_EVENT_EXAMPLES } from "./AutomationEventData";

describe("AUTOMATION_EVENT_EXAMPLES", () => {
  it("names every event type", () => {
    expect(Object.keys(AUTOMATION_EVENT_EXAMPLES).sort()).toEqual([
      "plan.failed",
      "plan.started",
      "plan.step_changed",
      "plan.succeeded",
      "storage.limit_exceeded",
      "ticket.created",
      "ticket.status_changed",
    ]);
  });

  it("gives plan events a plan, a run and the step and error of the event", () => {
    const started = AUTOMATION_EVENT_EXAMPLES["plan.started"];
    const succeeded = AUTOMATION_EVENT_EXAMPLES["plan.succeeded"];
    const failed = AUTOMATION_EVENT_EXAMPLES["plan.failed"];
    const stepChanged = AUTOMATION_EVENT_EXAMPLES["plan.step_changed"];

    expect(started).toMatchObject({
      event: "plan.started",
      plan: { id: "plan-id" },
      run: { status: "running" },
      step: null,
      error: null,
    });
    expect(succeeded).toMatchObject({ run: { status: "succeeded" } });
    expect(failed).toMatchObject({
      run: { status: "failed" },
      step: { status: "failed" },
      error: "plan_interrupted",
    });
    expect(stepChanged).toMatchObject({ step: { status: "running" } });
  });

  it("gives ticket events a status and the previous one only on a change", () => {
    expect(AUTOMATION_EVENT_EXAMPLES["ticket.created"]).toMatchObject({
      event: "ticket.created",
      status: { id: "status-todo" },
      previousStatus: null,
    });
    expect(AUTOMATION_EVENT_EXAMPLES["ticket.status_changed"]).toMatchObject({
      status: { id: "status-done" },
      previousStatus: { id: "status-review" },
    });
  });

  it("gives the storage event its usage numbers", () => {
    expect(AUTOMATION_EVENT_EXAMPLES["storage.limit_exceeded"]).toEqual({
      totalBytes: 25_000_000_000,
      limitBytes: 20_000_000_000,
      largestDirectoryBytes: [18_000_000_000, 5_000_000_000],
    });
  });
});
