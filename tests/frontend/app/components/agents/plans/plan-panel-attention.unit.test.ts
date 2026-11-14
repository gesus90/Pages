import { expect, it } from "vitest";

import { planPanelAttention } from "@/app/components/agents/plans/plan-panel-status-model";

import { planControl } from "./plan-panel-fixture";

import type { PlanPanelAttentionInput } from "@/app/components/agents/plans/plan-panel-status-model";

function input(
  overrides: Partial<PlanPanelAttentionInput> = {},
): PlanPanelAttentionInput {
  return {
    control: planControl(),
    isWorkspaceMissing: false,
    hasScheduledDeletion: false,
    hasRecoveryError: false,
    ...overrides,
  };
}

it("points at nothing without a hidden notice", () => {
  expect(planPanelAttention(input())).toBeNull();
  expect(planPanelAttention(input({ control: undefined }))).toBeNull();
  expect(
    planPanelAttention(
      input({
        control: planControl({
          canResume: true,
          resumeBlock: { code: "cleanup_unconfirmed", action: "release" },
        }),
      }),
    ),
  ).toBeNull();
});

it.each([
  [
    "a wait for the workspace",
    input({
      control: planControl({
        workspaceWait: {
          resource: "workspace",
          reason: "runner_offline",
          runId: null,
          jobId: null,
          attemptId: null,
        },
      }),
    }),
  ],
  [
    "a cleanup obligation",
    input({
      control: planControl({
        cleanup: [
          {
            workspaceId: "workspace",
            workspaceName: "Workspace",
            runId: "old",
            ownerId: "owner",
            blocker: "runner_offline",
            updatedAt: "2026-11-13T10:00:00.000Z",
          },
        ],
      }),
    }),
  ],
  [
    "a block of Fortsetzen",
    input({
      control: planControl({
        resumeBlock: { code: "cleanup_unconfirmed", action: "release" },
      }),
    }),
  ],
  ["a missing workspace", input({ isWorkspaceMissing: true })],
  ["a scheduled deletion", input({ hasScheduledDeletion: true })],
])("names %s a warning", (name, value) => {
  expect(planPanelAttention(value), name).toBe("warning");
});

it("names a refused recovery request an error before any warning", () => {
  expect(
    planPanelAttention(
      input({ hasRecoveryError: true, isWorkspaceMissing: true }),
    ),
  ).toBe("error");
});
