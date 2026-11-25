import { beforeEach, describe, expect, it, vi } from "vitest";

import { AutomationPlanEvents } from "./AutomationPlanEvents";

import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";

const mocks = vi.hoisted(() => ({
  logCaughtError: vi.fn(),
  withBackgroundDatabaseWork: vi.fn(
    (origin: string, work: () => Promise<void>): Promise<void> => work(),
  ),
}));

vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: mocks.logCaughtError,
}));
vi.mock("@/backend/database/executor/DatabaseWorkContext", () => ({
  withBackgroundDatabaseWork: mocks.withBackgroundDatabaseWork,
}));

const NOW = new Date("2026-11-25T12:00:00.000Z");
const record = vi.fn();

function step(id: string, status: string, error?: string): AgentPlanStepResult {
  return {
    id,
    name: `Step ${id}`,
    status,
    error: error ?? null,
  } as unknown as AgentPlanStepResult;
}

function run(
  status: AgentPlanRun["status"],
  steps: readonly AgentPlanStepResult[] = [],
): AgentPlanRun {
  return {
    id: "run1",
    planId: "plan1",
    planName: "Plan",
    userId: "u1",
    status,
    steps,
  } as unknown as AgentPlanRun;
}

function events(): AutomationPlanEvents {
  return new AutomationPlanEvents({ record }, () => NOW);
}

function recorded(index: number): Record<string, unknown> {
  const call = record.mock.calls[index] as [Record<string, unknown>];
  return call[0];
}

function payload(index: number): Record<string, unknown> {
  return JSON.parse(recorded(index).payload as string) as Record<
    string,
    unknown
  >;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.withBackgroundDatabaseWork.mockImplementation((origin, work) => work());
  record.mockResolvedValue(undefined);
});

describe("runStarted", () => {
  it("records plan.started", () => {
    events().runStarted(run("running"));
    expect(mocks.withBackgroundDatabaseWork).toHaveBeenCalledWith(
      "automation_plan_event",
      expect.any(Function),
    );
    expect(recorded(0)).toMatchObject({
      eventType: "plan.started",
      actorId: "u1",
      occurredAt: NOW.toISOString(),
    });
    expect(payload(0)).toEqual({
      event: "plan.started",
      at: NOW.toISOString(),
      plan: { id: "plan1", name: "Plan" },
      run: { id: "run1", status: "running" },
      step: null,
      error: null,
    });
  });

  it("uses the current time by default", () => {
    new AutomationPlanEvents({ record }).runStarted(run("running"));
    expect(typeof recorded(0).occurredAt).toBe("string");
  });
});

describe("runChanged", () => {
  it("records started and ended steps only", () => {
    events().runChanged(
      run("running", [step("a", "waiting"), step("b", "running")]),
      run("running", [
        step("a", "running"),
        step("b", "running"),
        step("c", "succeeded"),
        step("d", "waiting"),
      ]),
    );
    expect(record).toHaveBeenCalledTimes(2);
    expect(payload(0).step).toEqual({
      id: "a",
      name: "Step a",
      status: "running",
    });
    expect(recorded(1)).toMatchObject({ eventType: "plan.step_changed" });
  });

  it("records a succeeded ending", () => {
    events().runChanged(run("running"), run("succeeded"));
    expect(recorded(0)).toMatchObject({ eventType: "plan.succeeded" });
    expect(payload(0)).toMatchObject({ step: null, error: null });
  });

  it("records a failed ending with the failed step and reason", () => {
    events().runChanged(
      run("pausing"),
      run("failed", [step("a", "succeeded"), step("b", "failed", "boom_code")]),
    );
    const ending = record.mock.calls.length - 1;
    expect(recorded(ending)).toMatchObject({ eventType: "plan.failed" });
    expect(payload(ending)).toMatchObject({
      step: { id: "b", status: "failed" },
      error: "boom_code",
    });
  });

  it("records a failed ending without a failed step", () => {
    events().runChanged(run("stopping"), run("work_done_closeout_open"));
    expect(recorded(0)).toMatchObject({ eventType: "plan.failed" });
    expect(payload(0)).toMatchObject({
      step: null,
      error: "work_done_closeout_open",
    });
  });

  it("records no event for other endings or no ending", () => {
    events().runChanged(run("paused"), run("cancelled"));
    events().runChanged(run("running"), run("paused"));
    events().runChanged(run("succeeded"), run("succeeded"));
    expect(record).not.toHaveBeenCalled();
  });
});

describe("failing writes", () => {
  it("logs a rejected write", async () => {
    const error = new Error("down");
    record.mockRejectedValue(error);
    events().runStarted(run("running"));
    await vi.waitFor(() =>
      expect(mocks.logCaughtError).toHaveBeenCalledWith(
        "AutomationPlanEvents",
        error,
      ),
    );
  });
});
