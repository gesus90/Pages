import { beforeEach, describe, expect, it } from "vitest";

import {
  ATTEMPT_ID,
  CONNECTION_ID,
  RUN_ID,
  STEP_ID,
  USER_ID,
  envelope,
  issuedScope,
  openDefault,
  pagesAccessWorld,
  remoteWith,
  runWith,
} from "./runner-pages-access-harness";

import type { PlanRemoteAccess } from "@/definition/AgentPlanRemoteAccess";
import type { PagesAccessWorld } from "./runner-pages-access-harness";

let world: PagesAccessWorld;

beforeEach(() => {
  world = pagesAccessWorld();
});

describe("RunnerPagesAccessService.open", () => {
  it("issues a scoped capability and records the active evidence", async () => {
    await openDefault(world);

    expect(world.issue).toHaveBeenCalledExactlyOnceWith(
      USER_ID,
      {
        runId: RUN_ID,
        stepId: STEP_ID,
        operations: [],
        tickets: [
          { id: "ticket-1", key: "PAGE-1" },
          { id: "ticket-2", key: "PAGE-2" },
        ],
        reach: "full",
      },
      0,
    );
    expect(world.evidence()).toEqual({
      files: [],
      pages: "active",
      events: [],
    });
  });

  it("keeps earlier evidence while it marks the access active", async () => {
    const earlier: PlanRemoteAccess = {
      files: [],
      pages: "closed",
      events: [],
    };
    world.write.mockImplementationOnce(async (run, attempt, update) => {
      expect(update(earlier)).toEqual({
        files: [],
        pages: "active",
        events: [],
      });
    });

    await openDefault(world);

    expect(world.write).toHaveBeenCalledOnce();
  });

  it("offers a ticket-bound ACP-less provider only the session operations", async () => {
    const remote = remoteWith({
      step: {
        type: "agent",
        id: STEP_ID,
        completion: "todos",
        configuration: {
          provider: "openai",
          template: { run: { access: "read_only", timeoutMinutes: 3 } },
        },
      },
    });

    await openDefault(world, remote);

    const scope = issuedScope(world);
    expect(scope.reach).toBe("tickets");
    expect(scope.operations).toContain("ticket.setStatus");
  });

  it("leaves out the status operation when the step does not complete by todos", async () => {
    const remote = remoteWith({
      step: {
        type: "agent",
        id: STEP_ID,
        completion: "result",
        configuration: {
          provider: "openai",
          template: { run: { access: "read_only", timeoutMinutes: 3 } },
        },
      },
    });

    await openDefault(world, remote);

    const scope = issuedScope(world);
    expect(scope.operations).not.toContain("ticket.setStatus");
  });

  it("does nothing for a step without Pages access", async () => {
    await openDefault(world, remoteWith({ command: { pagesAccess: 0 } }));

    expect(world.issue).not.toHaveBeenCalled();
    expect(world.write).not.toHaveBeenCalled();
  });

  it("does not issue a second capability for an attempt that is already open", async () => {
    await openDefault(world);
    await openDefault(world);

    expect(world.issue).toHaveBeenCalledOnce();
  });

  it.each([
    ["a script node", { step: { type: "script", id: STEP_ID } }],
    [
      "an agent without a provider",
      { step: { type: "agent", id: STEP_ID, configuration: {} } },
    ],
    ["a step without prepared parameters", { parameters: undefined }],
  ])("refuses %s as unavailable", async (name, overrides) => {
    await expect(
      openDefault(world, remoteWith(overrides)),
    ).rejects.toMatchObject({ code: "plan_mcp_unavailable" });

    expect(world.issue).not.toHaveBeenCalled();
  });
});

describe("RunnerPagesAccessService.close", () => {
  it("revokes an open capability and records the closed evidence", async () => {
    await openDefault(world);

    await world.service.close(RUN_ID, STEP_ID, ATTEMPT_ID);

    expect(world.revoke).toHaveBeenCalledExactlyOnceWith(RUN_ID, STEP_ID);
    expect(world.evidence()).toEqual({
      files: [],
      events: [],
      pages: "closed",
    });
    await expect(
      world.service.receive(CONNECTION_ID, envelope({ kind: "lease" })),
    ).resolves.toMatchObject({ ok: false, error: "plan_mcp_unavailable" });
  });

  it("revokes a capability that only the stored run still lists as active", async () => {
    await world.service.close(RUN_ID, STEP_ID, ATTEMPT_ID);

    expect(world.revoke).toHaveBeenCalledExactlyOnceWith(RUN_ID, STEP_ID);
    expect(world.evidence()?.pages).toBe("closed");
  });

  it("leaves a run alone whose stored step is no longer active", async () => {
    world.runsFind.mockResolvedValue(
      runWith({
        steps: [
          {
            id: STEP_ID,
            status: "running",
            execution: { attemptId: ATTEMPT_ID },
            resourceAccess: { pages: "closed" },
          },
        ],
      }),
    );

    await world.service.close(RUN_ID, STEP_ID, ATTEMPT_ID);

    expect(world.revoke).not.toHaveBeenCalled();
    expect(world.write).not.toHaveBeenCalled();
  });

  it("does not revoke for a different attempt of the step", async () => {
    await openDefault(world);

    await world.service.close(RUN_ID, STEP_ID, "other-attempt");

    expect(world.revoke).not.toHaveBeenCalled();
  });

  it("returns quietly when the run is gone", async () => {
    world.runsFind.mockResolvedValue(undefined);

    await expect(
      world.service.close(RUN_ID, STEP_ID, ATTEMPT_ID),
    ).resolves.toBeUndefined();

    expect(world.revoke).not.toHaveBeenCalled();
  });

  it("keeps earlier evidence files and events when it closes", async () => {
    await openDefault(world);
    world.write.mockImplementationOnce(async (run, attempt, update) => {
      const active: PlanRemoteAccess = {
        files: [],
        events: [],
        pages: "active",
      };
      expect(update(active)).toEqual({
        files: [],
        events: [],
        pages: "closed",
      });
      expect(update(undefined)).toEqual({
        files: [],
        events: [],
        pages: "closed",
      });
    });

    await world.service.close(RUN_ID, STEP_ID, ATTEMPT_ID);

    expect(world.revoke).toHaveBeenCalledOnce();
  });
});
