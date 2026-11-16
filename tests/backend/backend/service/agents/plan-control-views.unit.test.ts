import { beforeEach, expect, it, vi } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";
import { readPlanControlEntry } from "@/backend/service/agents/AgentPlanControlViews";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AgentPlanService } from "@/backend/service/agents/AgentPlanService";

const view = vi.fn();
const control = vi.fn();
const controlRun = vi.fn();
const readRun = vi.fn();
const plans = partial<AgentPlanService>({
  view,
  control,
  controlRun,
  run: readRun,
});
const plan = {
  id: "plan",
  ownerId: "user",
  revision: 2,
  canEdit: true,
  rights: { canRun: true, canDelete: true },
};
const state = {
  status: "idle",
  canPlay: true,
  canRestart: false,
  canPause: false,
  canResume: false,
  canStop: false,
  canEdit: true,
  runId: null,
  issue: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  view.mockResolvedValue(plan);
  control.mockResolvedValue(state);
});

it("projects an editable idle plan and its action blockers", async () => {
  const result = await readPlanControlEntry(plans, "user", "plan");
  expect(result).toMatchObject({
    revision: 2,
    status: "idle",
    canEdit: true,
    canDelete: true,
    canPlay: true,
    blockers: {
      delete: null,
      play: null,
      pause: "own_run_required",
      stop: "own_run_required",
    },
  });
});

it("shows a read-only blocker and withholds start details", async () => {
  view.mockResolvedValue({
    ...plan,
    ownerId: "other",
    canEdit: false,
    rights: { canRun: false, canDelete: false },
  });
  control.mockResolvedValue({
    ...state,
    canPlay: false,
    issue: "accessDenied",
    issues: [{ nodeId: "secret", reason: "bad" }],
    workspaceConflict: { secret: true },
  });
  const result = await readPlanControlEntry(plans, "user", "plan");
  expect(result).toMatchObject({
    canEdit: false,
    canDelete: false,
    issue: "plan_read_only",
    blockers: { delete: "plan_owner_required", play: "plan_read_only" },
  });
  expect(result).not.toHaveProperty("issues");
  expect(result).not.toHaveProperty("workspaceConflict");
});

it("projects active run state and readable continuation metadata", async () => {
  const run = {
    id: "run",
    planId: "plan",
    userId: "user",
    planRevision: 2,
    status: "running",
    stopRequested: false,
    steps: [],
    continuation: { version: 3, planRevision: 4 },
  };
  control.mockResolvedValue({
    ...state,
    status: "running",
    runId: "run",
    canPlay: false,
    canPause: true,
    canStop: true,
  });
  controlRun.mockResolvedValue(run);
  readRun.mockResolvedValue(run);
  const result = await readPlanControlEntry(plans, "user", "plan");
  expect(result).toMatchObject({
    canDelete: false,
    canPause: true,
    canStop: true,
    runId: "run",
    planRevision: 4,
    continuationVersion: 3,
    blockers: { delete: "plan_busy", play: "plan_busy" },
  });
});

it("hides historical details when access was revoked but preserves stop control", async () => {
  const run = {
    id: "run",
    planId: "plan",
    userId: "user",
    planRevision: 2,
    status: "running",
    stopRequested: false,
    steps: [],
  };
  control.mockResolvedValue({
    ...state,
    status: "running",
    runId: "run",
    canPlay: false,
    canPause: true,
    canStop: true,
  });
  controlRun.mockResolvedValue(run);
  readRun.mockRejectedValue(new AgentError("plan_access_denied"));
  const result = await readPlanControlEntry(plans, "user", "plan");
  expect(result).toMatchObject({
    issue: "plan_access_denied",
    canPause: false,
    canStop: true,
    blockers: { pause: "plan_access_denied" },
  });
});
