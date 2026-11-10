import { beforeEach, describe, expect, it } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";
import { TOOL_ENTRIES } from "@/definition/AgentTools/ToolCatalog";

import {
  ATTEMPT_ID,
  CONNECTION_ID,
  JOB_ID,
  REQUEST_ID,
  STEP_ID,
  TOKEN,
  USER_ID,
  envelope,
  openDefault,
  pagesAccessWorld,
  remoteWith,
  runWith,
} from "./runner-pages-access-harness";

import type { PagesAccessWorld } from "./runner-pages-access-harness";

let world: PagesAccessWorld;

beforeEach(() => {
  world = pagesAccessWorld();
});

function receive(
  request: Parameters<typeof envelope>[0],
): Promise<Readonly<Record<string, unknown>>> {
  return world.service.receive(CONNECTION_ID, envelope(request));
}

function stepOf(status: string, attemptId = ATTEMPT_ID): object {
  return {
    id: STEP_ID,
    status,
    execution: { attemptId },
    resourceAccess: { pages: "active" },
  };
}

describe("RunnerPagesAccessService.receive input", () => {
  it("rejects a message that does not match the request schema", async () => {
    await expect(
      world.service.receive(CONNECTION_ID, { version: 2 }),
    ).rejects.toThrow();
    expect(world.pagesJob).not.toHaveBeenCalled();
  });

  it("rejects a request larger than 64 KiB before it looks at the job", async () => {
    await openDefault(world);

    await expect(
      receive({
        kind: "call",
        name: "read_ticket",
        arguments: { text: "x".repeat(70_000) },
      }),
    ).rejects.toThrow("Remote Pages request too large");
    expect(world.pagesJob).not.toHaveBeenCalled();
  });

  it("answers a lease request for an open capability", async () => {
    await openDefault(world);

    await expect(receive({ kind: "lease" })).resolves.toEqual({
      version: 1,
      type: "pages-result",
      requestId: REQUEST_ID,
      ok: true,
      result: { active: true },
    });
    expect(world.pagesJob).toHaveBeenCalledExactlyOnceWith(
      CONNECTION_ID,
      JOB_ID,
    );
  });
});

describe("RunnerPagesAccessService.receive access checks", () => {
  beforeEach(async () => {
    await openDefault(world);
  });

  const unavailable = {
    version: 1,
    type: "pages-result",
    requestId: REQUEST_ID,
    ok: false,
    error: "plan_mcp_unavailable",
  };

  it("answers unavailable when the runner has no such job", async () => {
    world.pagesJob.mockRejectedValue(new Error("Pages runner unavailable"));

    await expect(receive({ kind: "lease" })).resolves.toEqual(unavailable);
  });

  it("answers unavailable for a job without a plan binding", async () => {
    world.pagesJob.mockResolvedValue({});

    await expect(receive({ kind: "lease" })).resolves.toEqual(unavailable);
  });

  it("answers unavailable for an attempt that holds no capability", async () => {
    world.pagesJob.mockResolvedValue({ plan: { attemptId: "unknown" } });

    await expect(receive({ kind: "lease" })).resolves.toEqual(unavailable);
  });

  it("answers unavailable once the capability has expired", async () => {
    const expired = pagesAccessWorld();
    expired.issue.mockResolvedValue({
      token: TOKEN,
      expiresAt: Date.now() - 1,
    });
    await openDefault(expired);

    await expect(
      expired.service.receive(CONNECTION_ID, envelope({ kind: "lease" })),
    ).resolves.toEqual(unavailable);
    expect(expired.runsFind).not.toHaveBeenCalled();
  });

  it.each([
    ["a missing run", undefined],
    ["a finished run", runWith({ status: "succeeded" })],
    ["a paused run", runWith({ status: "paused" })],
    ["a run asked to stop", runWith({ stopRequested: true })],
    [
      "a step that is no longer running",
      runWith({ steps: [stepOf("failed")] }),
    ],
    ["a run without the step", runWith({ steps: [] })],
    [
      "a step with a newer attempt",
      runWith({ steps: [stepOf("running", "attempt-2")] }),
    ],
  ])("answers unavailable for %s", async (name, run) => {
    world.runsFind.mockResolvedValue(run);

    await expect(receive({ kind: "lease" })).resolves.toEqual(unavailable);
    expect(world.requirePlan).not.toHaveBeenCalled();
  });

  it("serves a run that is pausing", async () => {
    world.runsFind.mockResolvedValue(runWith({ status: "pausing" }));

    await expect(receive({ kind: "lease" })).resolves.toMatchObject({
      ok: true,
    });
  });

  it("denies a request when the executor may no longer edit the plan", async () => {
    world.requirePlan.mockResolvedValue({ canEdit: false, projectId: "p" });

    await expect(receive({ kind: "lease" })).resolves.toEqual({
      ...unavailable,
      error: "plan_access_denied",
    });
    expect(world.authorize).not.toHaveBeenCalled();
  });

  it("checks the live rights over the prepared parameters", async () => {
    await receive({ kind: "lease" });

    expect(world.requirePlan).toHaveBeenCalledExactlyOnceWith(
      USER_ID,
      "plan-1",
    );
    expect(world.authorize).toHaveBeenCalledExactlyOnceWith(
      USER_ID,
      remoteWith().parameters,
      { projectId: "project-1", target: { connectionId: CONNECTION_ID } },
    );
  });

  it("surfaces the code of a refused parameter authorization", async () => {
    world.authorize.mockRejectedValue(
      new AgentError("parameter_ticket_changed"),
    );

    await expect(receive({ kind: "lease" })).resolves.toEqual({
      ...unavailable,
      error: "parameter_ticket_changed",
    });
  });
});

describe("RunnerPagesAccessService.receive dispatch", () => {
  it("refuses every kind when the step has no prepared parameters any more", async () => {
    const remote = remoteWith();
    await openDefault(world, remote);
    Reflect.deleteProperty(remote, "parameters");

    await expect(receive({ kind: "lease" })).resolves.toMatchObject({
      ok: false,
      error: "plan_mcp_unavailable",
    });
    expect(world.authorize).not.toHaveBeenCalled();
  });

  it("answers a prepare request with the manifest of the pinned files", async () => {
    await openDefault(world);

    await expect(receive({ kind: "prepare" })).resolves.toMatchObject({
      ok: true,
      result: { files: [] },
    });
  });

  it("refuses a chunk of a file that was never pinned", async () => {
    await openDefault(world);

    await expect(
      receive({ kind: "asset", index: 0, offset: 0 }),
    ).resolves.toMatchObject({
      ok: false,
      error: "parameter_asset_unavailable",
    });
  });

  it("lists only the tools the verified credential may call", async () => {
    await openDefault(world);
    const allowed = TOOL_ENTRIES.slice(0, 3);
    world.api.handle.mockResolvedValue({
      tools: allowed.map((entry) => entry.operation),
    });

    const answer = await receive({ kind: "list" });

    expect(world.api.handle).toHaveBeenCalledExactlyOnceWith(TOKEN, {
      operation: "verify",
    });
    expect(answer).toMatchObject({
      ok: true,
      result: { tools: allowed.map((entry) => entry.tool) },
    });
  });

  it("lists nothing for a credential that verifies with no operations", async () => {
    await openDefault(world);
    world.api.handle.mockResolvedValue({ tools: [] });

    await expect(receive({ kind: "list" })).resolves.toMatchObject({
      ok: true,
      result: { tools: [] },
    });
  });

  it("refuses a listing when the verification names no tools", async () => {
    await openDefault(world);
    world.api.handle.mockResolvedValue({ projects: [] });

    await expect(receive({ kind: "list" })).resolves.toMatchObject({
      ok: false,
      error: "plan_mcp_unavailable",
    });
  });
});
