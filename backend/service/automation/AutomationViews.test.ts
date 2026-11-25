import { expect, it } from "vitest";

import {
  automationRunDetail,
  automationRunSummary,
  automationView,
} from "./AutomationViews";

import type { StoredAutomation } from "@/backend/database/repositories/automation/AutomationRepository";
import type { StoredAutomationAgentJob } from "@/backend/database/repositories/automation/AutomationAgentJobRepository";
import type { StoredAutomationRun } from "@/backend/database/repositories/automation/AutomationRunRepository";
import type { AutomationPermissions } from "@/definition/Automation";
import type { AutomationAccount } from "./AutomationDirectory";

const PERMISSIONS: AutomationPermissions = {
  canRead: true,
  canEdit: false,
  canRun: true,
  canDelete: false,
};

function stored(overrides: Partial<StoredAutomation> = {}): StoredAutomation {
  return {
    id: "a1",
    creatorId: "u1",
    name: "Nightly",
    trigger: { type: "manual" },
    action: {
      type: "script",
      workspaceId: "w",
      interpreterProfileId: "i",
      content: "echo",
      timeoutSeconds: 5,
    },
    sharing: { scope: "private" },
    isActive: true,
    deleteAfterSuccess: false,
    agentNotification: { mode: "off" },
    nextRunAt: "2026-02-01T00:00:00Z",
    revision: 3,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-02T00:00:00Z",
    ...overrides,
  };
}

function storedRun(
  overrides: Partial<StoredAutomationRun> = {},
): StoredAutomationRun {
  return {
    id: "r1",
    sequence: 1,
    automationId: "a1",
    triggerKind: "manual",
    eventType: null,
    triggerSubject: null,
    triggerData: null,
    requestedBy: null,
    status: "queued",
    outcome: null,
    exitCode: null,
    forwardState: null,
    planRunId: null,
    planRunStatus: null,
    paused: false,
    errorCode: null,
    summary: null,
    answer: "answer",
    output: "output",
    error: "error",
    queuedAt: "2026-01-01T00:00:00Z",
    startedAt: null,
    endedAt: null,
    ...overrides,
  };
}

function account(isAgent: boolean): AutomationAccount {
  return {
    id: "u1",
    displayName: "Ada",
    isAgent,
    isActive: true,
    isAdministrator: false,
    isReadOnly: false,
    timeZone: "UTC",
    language: "en",
  };
}

it("summarizes a queued run without result", () => {
  const summary = automationRunSummary(storedRun(), "Nightly");
  expect(summary.result).toBeNull();
  expect(summary.duration).toBeNull();
  expect(summary.trigger).toEqual({ kind: "manual", subject: null });
});

it("summarizes a finished run with event type and duration", () => {
  const summary = automationRunSummary(
    storedRun({
      eventType: "plan.failed",
      outcome: "ok",
      exitCode: 0,
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: "2026-01-01T00:00:01.500Z",
    }),
    "Nightly",
  );
  expect(summary.trigger).toMatchObject({ eventType: "plan.failed" });
  expect(summary.result).toMatchObject({ outcome: "ok", exitCode: 0 });
  expect(summary.duration).toBe(1500);
});

it("has no duration for a negative or invalid span", () => {
  const negative = storedRun({
    startedAt: "2026-01-01T00:00:02Z",
    endedAt: "2026-01-01T00:00:01Z",
  });
  const invalid = storedRun({ startedAt: "x", endedAt: "y" });
  expect(automationRunSummary(negative, "n").duration).toBeNull();
  expect(automationRunSummary(invalid, "n").duration).toBeNull();
});

const JOB: StoredAutomationAgentJob = {
  id: "j1",
  runId: "r1",
  automationId: "a1",
  agentId: "g1",
  creatorId: "u1",
  kind: "action",
  prompt: "p",
  state: "queued",
  answer: null,
  errorCode: null,
  sessionId: null,
  queuedAt: "q",
  deliveredAt: null,
  completedAt: null,
};

it("details a run with parsed trigger data and deliveries", () => {
  const detail = automationRunDetail(storedRun({ triggerData: '{"a":1}' }), {
    automationName: "Nightly",
    jobs: [JOB],
    canSeeOutput: true,
  });
  expect(detail.output).toBe("output");
  expect(detail.triggerData).toEqual({ a: 1 });
  expect(detail.deliveries).toEqual([
    {
      agentId: "g1",
      kind: "action",
      state: "queued",
      queuedAt: "q",
      deliveredAt: null,
      completedAt: null,
      errorCode: null,
    },
  ]);
});

it("hides the output and rejects unusable trigger data", () => {
  const context = { automationName: "n", jobs: [], canSeeOutput: false };
  const read = (
    triggerData: string | null,
  ): Readonly<Record<string, unknown>> | null =>
    automationRunDetail(storedRun({ triggerData }), context).triggerData;
  expect(automationRunDetail(storedRun(), context).output).toBeNull();
  expect(read(null)).toBeNull();
  expect(read("[1]")).toBeNull();
  expect(read("3")).toBeNull();
  expect(read("null")).toBeNull();
  expect(read("{broken")).toBeNull();
});

it("builds the view of an active automation", () => {
  const view = automationView(stored(), {
    creator: account(true),
    permissions: PERMISSIONS,
    canSeeScript: true,
    lastRun: storedRun(),
  });
  expect(view.creator).toEqual({
    accountId: "u1",
    kind: "agent",
    displayName: "Ada",
  });
  expect(view.action).toMatchObject({ content: "echo" });
  expect(view.nextRunAt).toBe("2026-02-01T00:00:00Z");
  expect(view.lastRun?.runId).toBe("r1");
  expect(view.permissions).toBe(PERMISSIONS);
});

it("hides script content and next run of an inactive automation", () => {
  const view = automationView(stored({ isActive: false }), {
    creator: account(false),
    permissions: PERMISSIONS,
    canSeeScript: false,
    lastRun: null,
  });
  expect(view.creator.kind).toBe("human");
  expect(view.action).toMatchObject({ type: "script", content: null });
  expect(view.nextRunAt).toBeNull();
  expect(view.lastRun).toBeNull();
});

it("keeps non-script actions and handles a missing creator", () => {
  const action = { type: "plan", planId: "p" } as const;
  const view = automationView(stored({ action }), {
    creator: null,
    permissions: PERMISSIONS,
    canSeeScript: false,
    lastRun: null,
  });
  expect(view.action).toBe(action);
  expect(view.creator).toMatchObject({ kind: "human", displayName: "" });
});
