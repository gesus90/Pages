import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";

import {
  ATTEMPT_ID,
  CONNECTION_ID,
  PLAN_ID,
  RUN_ID,
  STEP_ID,
  USER_ID,
  pagesAccessWorld,
  remoteWith,
  runWith,
} from "./runner-pages-access-harness";

import type { RemotePlanStep } from "@/backend/service/agents/AgentPlanRemoteExecution";
import type { PagesAccessWorld } from "./runner-pages-access-harness";

const mocks = vi.hoisted(() => ({
  readPlanSnapshot: vi.fn(),
  isOriginalRemoteJob: vi.fn(),
  logCaughtError: vi.fn(),
}));

vi.mock("@/backend/service/agents/AgentPlanSnapshot", () => ({
  readPlanSnapshot: mocks.readPlanSnapshot,
}));
vi.mock("@/backend/service/agents/AgentPlanRemoteCancellation", () => ({
  isOriginalRemoteJob: mocks.isOriginalRemoteJob,
}));
vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: mocks.logCaughtError,
}));

let world: PagesAccessWorld;

function snapshotWith(remote: RemotePlanStep = remoteWith()): object {
  return { remoteSteps: [{ ...remote }] };
}

function activeStep(overrides: Record<string, unknown> = {}): object {
  return {
    id: STEP_ID,
    status: "running",
    execution: { attemptId: ATTEMPT_ID },
    resourceAccess: { pages: "active" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  world = pagesAccessWorld();
  world.runsUnfinished.mockResolvedValue([runWith()]);
  mocks.readPlanSnapshot.mockReturnValue(snapshotWith());
  world.progress.mockResolvedValue({
    status: "running",
    cancellation: undefined,
  });
  mocks.isOriginalRemoteJob.mockReturnValue(true);
});

describe("RunnerPagesAccessService.recover reopening", () => {
  it("revokes the old credential and reopens an original running attempt", async () => {
    await world.service.recover();

    expect(world.revoke).toHaveBeenCalledExactlyOnceWith(RUN_ID, STEP_ID);
    expect(world.progress).toHaveBeenCalledExactlyOnceWith(
      CONNECTION_ID,
      RUN_ID,
      ATTEMPT_ID,
    );
    expect(world.requirePlan).toHaveBeenCalledExactlyOnceWith(USER_ID, PLAN_ID);
    expect(world.authorize).toHaveBeenCalledExactlyOnceWith(
      USER_ID,
      remoteWith().parameters,
      { projectId: "project-1", target: { connectionId: CONNECTION_ID } },
    );
    expect(world.issue).toHaveBeenCalledOnce();
    expect(world.evidence()?.pages).toBe("active");
  });

  it("reads the snapshot of every unfinished run", async () => {
    world.runsUnfinished.mockResolvedValue([
      runWith(),
      runWith({ id: "run-2" }),
    ]);

    await world.service.recover();

    expect(world.runsSnapshot.mock.calls).toEqual([[RUN_ID], ["run-2"]]);
  });

  it("skips steps that never held Pages access", async () => {
    world.runsUnfinished.mockResolvedValue([
      runWith({
        steps: [
          activeStep({ resourceAccess: undefined }),
          activeStep({ id: "step-2", execution: undefined }),
        ],
      }),
    ]);

    await world.service.recover();

    expect(world.revoke).not.toHaveBeenCalled();
    expect(world.write).not.toHaveBeenCalled();
  });

  it("fails to reopen a step without prepared parameters and closes its evidence", async () => {
    mocks.readPlanSnapshot.mockReturnValue(
      snapshotWith(remoteWith({ parameters: undefined })),
    );

    await world.service.recover();

    expect(world.authorize).not.toHaveBeenCalled();
    expect(mocks.logCaughtError).toHaveBeenCalledOnce();
    expect(world.evidence()?.pages).toBe("closed");
  });

  it("logs a failed restore and still closes the evidence", async () => {
    const failure = new AgentError("plan_access_denied");
    world.authorize.mockRejectedValue(failure);

    await world.service.recover();

    expect(mocks.logCaughtError).toHaveBeenCalledExactlyOnceWith(
      "RunnerPagesAccessService",
      failure,
    );
    expect(world.issue).not.toHaveBeenCalled();
    expect(world.evidence()?.pages).toBe("closed");
  });
});

describe("RunnerPagesAccessService.recover closing", () => {
  const closed = { files: [], events: [], pages: "closed" };

  it.each([
    { name: "a step that is not running", step: { status: "paused" }, run: {} },
    { name: "a run asked to stop", step: {}, run: { stopRequested: true } },
  ])("closes the evidence for $name", async ({ step, run }) => {
    world.runsUnfinished.mockResolvedValue([
      runWith({ ...run, steps: [activeStep(step)] }),
    ]);

    await world.service.recover();

    expect(world.progress).not.toHaveBeenCalled();
    expect(world.issue).not.toHaveBeenCalled();
    expect(world.evidence()).toEqual(closed);
  });

  it.each([
    { name: "no remote steps at all", snapshot: {} },
    { name: "no remote step for it", snapshot: { remoteSteps: [] } },
    {
      name: "a remote step without Pages access",
      snapshot: snapshotWith(remoteWith({ command: { pagesAccess: 0 } })),
    },
  ])("closes the evidence for a snapshot with $name", async ({ snapshot }) => {
    mocks.readPlanSnapshot.mockReturnValue(snapshot);

    await world.service.recover();

    expect(world.progress).not.toHaveBeenCalled();
    expect(world.issue).not.toHaveBeenCalled();
    expect(world.evidence()).toEqual(closed);
  });

  it.each([
    { name: "no job", job: undefined },
    { name: "a finished job", job: { status: "succeeded" } },
    { name: "a cancelled job", job: { status: "running", cancellation: {} } },
  ])("does not reopen after $name", async ({ job }) => {
    world.progress.mockResolvedValue(job);
    mocks.isOriginalRemoteJob.mockImplementation(
      (run, step, candidate) => candidate !== undefined,
    );

    await world.service.recover();

    expect(world.requirePlan).not.toHaveBeenCalled();
    expect(world.evidence()).toEqual(closed);
  });

  it("does not reopen a job of another attempt", async () => {
    mocks.isOriginalRemoteJob.mockReturnValue(false);

    await world.service.recover();

    expect(world.requirePlan).not.toHaveBeenCalled();
    expect(world.evidence()).toEqual(closed);
  });

  it("does not reopen when the executor may no longer edit the plan", async () => {
    world.requirePlan.mockResolvedValue({ canEdit: false, projectId: "p" });

    await world.service.recover();

    expect(world.authorize).not.toHaveBeenCalled();
    expect(world.issue).not.toHaveBeenCalled();
    expect(world.evidence()).toEqual(closed);
  });
});
