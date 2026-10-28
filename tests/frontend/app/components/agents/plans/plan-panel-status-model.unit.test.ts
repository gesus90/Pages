import { expect, it } from "vitest";

import { planPanelState } from "@/app/components/agents/plans/plan-panel-status-model";

import { planControl } from "./plan-panel-fixture";

import type { PlanPanelStateInput } from "@/app/components/agents/plans/plan-panel-status-model";

function input(
  overrides: Partial<PlanPanelStateInput> = {},
): PlanPanelStateInput {
  return {
    hasPlan: true,
    control: planControl(),
    isDirty: false,
    isReadOnly: false,
    actionError: null,
    hasRefusedIssues: false,
    isRunBlocked: false,
    recovery: null,
    ...overrides,
  };
}

it("names a missing plan, refused findings, a refusal and an unknown state in this order", () => {
  expect(
    planPanelState(input({ hasPlan: false, hasRefusedIssues: true })),
  ).toEqual({ state: "none", tone: "neutral" });
  expect(
    planPanelState(input({ hasRefusedIssues: true, actionError: "x" })),
  ).toEqual({ state: "blocked", tone: "blocked" });
  expect(
    planPanelState(input({ actionError: "x", control: undefined })),
  ).toEqual({ state: "error", tone: "error" });
  expect(planPanelState(input({ control: undefined }))).toEqual({
    state: "checking",
    tone: "neutral",
  });
});

it("lets an active run speak first, honestly in its intermediate states", () => {
  const active = { isDirty: true, isReadOnly: true };

  expect(
    planPanelState(
      input({ ...active, control: planControl({ status: "stopping" }) }),
    ),
  ).toEqual({ state: "stopping", tone: "active" });
  expect(
    planPanelState(
      input({ ...active, control: planControl({ status: "pausing" }) }),
    ),
  ).toEqual({ state: "pausing", tone: "active" });
  expect(
    planPanelState(
      input({ control: planControl({ status: "paused", canResume: true }) }),
    ),
  ).toEqual({ state: "paused", tone: "paused" });
  expect(
    planPanelState(input({ control: planControl({ status: "paused" }) })),
  ).toEqual({ state: "pausedBlocked", tone: "blocked" });
  expect(
    planPanelState(input({ control: planControl({ status: "running" }) })),
  ).toEqual({ state: "running", tone: "active" });
  expect(
    planPanelState(
      input({
        isRunBlocked: true,
        control: planControl({ status: "running" }),
      }),
    ),
  ).toEqual({ state: "runBlocked", tone: "blocked" });
});

it("explains missing rights and unsaved changes before a plan reads as ready", () => {
  expect(planPanelState(input({ isReadOnly: true, isDirty: true }))).toEqual({
    state: "readOnly",
    tone: "neutral",
  });
  expect(planPanelState(input({ isDirty: true }))).toEqual({
    state: "unsaved",
    tone: "neutral",
  });
  expect(planPanelState(input())).toEqual({ state: "ready", tone: "ready" });
  expect(
    planPanelState(input({ control: planControl({ canPlay: false }) })),
  ).toEqual({ state: "blocked", tone: "blocked" });
});

it("names how the last run ended and whether a failure may be resumed", () => {
  for (const status of ["succeeded", "cancelled"] as const)
    expect(planPanelState(input({ control: planControl({ status }) }))).toEqual(
      {
        state: "ready",
        tone: "ready",
        variant: status,
      },
    );
  const failed = planControl({ status: "failed", canPlay: false });

  expect(
    planPanelState(
      input({ control: failed, recovery: { isAvailable: true, reason: null } }),
    ),
  ).toEqual({ state: "failed", tone: "blocked", variant: "resumable" });
  expect(
    planPanelState(
      input({
        control: failed,
        recovery: { isAvailable: false, reason: "No" },
      }),
    ),
  ).toEqual({ state: "failed", tone: "blocked", variant: undefined });
  expect(planPanelState(input({ control: failed }))).toEqual({
    state: "blocked",
    tone: "blocked",
  });
  expect(
    planPanelState(input({ control: planControl({ status: "failed" }) })),
  ).toEqual({ state: "ready", tone: "ready" });
});
