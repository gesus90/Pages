import { beforeEach, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { stopPlanRun } from "@/backend/service/agents/AgentPlanStop";
import { executeOwnedScript } from "@/backend/service/agents/AgentPlanScriptOwner";
import { hasUnconfirmedRunCloseout } from "@/backend/service/agents/AgentPlanRunState";
import { endInterruptedScriptWithFailure } from "@/backend/service/agents/AgentPlanScriptRecovery";

import { patchRecoveryStep, recoveryFixture } from "./page84-recovery-fixture";

import type * as FileSystem from "node:fs/promises";
import type * as ScriptResources from "@/backend/service/agents/AgentPlanScriptResources";
import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanScriptRun } from "@/definition/AgentPlanScript";

const INSTANCE = "20000000-0000-4000-8000-000000000002";

const boundary = vi.hoisted(
  (): {
    hasMarker: boolean;
    capture: unknown;
    unit: string;
    write: Mock;
    remove: Mock;
    execFile: Mock;
  } => ({
    hasMarker: false,
    capture: null,
    unit: "LoadState=not-found\nActiveState=inactive",
    write: vi.fn(),
    remove: vi.fn(),
    execFile: vi.fn(),
  }),
);

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof FileSystem>();
  return {
    ...original,
    readFile: vi.fn(async (file: string, encoding: BufferEncoding) => {
      if (!String(file).includes(`pages-plan-script-${INSTANCE}`))
        return original.readFile(file, encoding);
      if (boundary.hasMarker) return INSTANCE;
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    }),
  };
});
vi.mock("node:child_process", () => ({ execFile: boundary.execFile }));
vi.mock("@/backend/agents/local/LocalSessionFiles", () => ({
  readLocalRecord: vi.fn(async () => {
    if (boundary.capture) return boundary.capture;
    throw Object.assign(new Error("missing"), { code: "ENOENT" });
  }),
  writeLocalRecord: boundary.write,
}));
vi.mock(
  "@/backend/service/agents/AgentPlanScriptResources",
  async (importOriginal) => ({
    ...(await importOriginal<typeof ScriptResources>()),
    removeScriptResources: boundary.remove,
  }),
);

/** A dispatched attempt whose owner never spawned a process. */
function unstartedScript(): AgentPlanScriptRun {
  return {
    attemptId: "10000000-0000-4000-8000-000000000001",
    instanceId: INSTANCE,
    interpreterProfileId: "node",
    directory: "/synthetic/work",
    userId: "owner",
    uid: 1000,
    gid: 1000,
    processId: null,
    startedAt: "2026-11-15T15:04:40.000Z",
    endedAt: null,
    exitCode: null,
    signal: null,
    failure: null,
    closeout: "pending",
    stdout: null,
    stderr: "",
  };
}

/** The fixture step "b" carrying an attempt that never got a process. */
async function unstartedStep(): Promise<AgentPlanStepResult> {
  const fixture = await recoveryFixture();
  return patchRecoveryStep(fixture.completed, "b", {
    script: unstartedScript(),
  }).steps[1];
}

async function stop(): Promise<AgentPlanRun[]> {
  const fixture = await recoveryFixture();
  const stored: AgentPlanRun = {
    ...patchRecoveryStep(fixture.completed, "b", {
      status: "running",
      script: unstartedScript(),
    }),
    status: "running",
  };
  const updates: AgentPlanRun[] = [];
  const update = vi.fn(async (run: AgentPlanRun) => {
    updates.push(structuredClone(run));
  });
  await stopPlanRun("run", {
    active: new Map(),
    writes: new SerialQueue(),
    runs: { find: vi.fn(async () => stored), update },
    steps: { closeGroups: vi.fn(), finishPlanRun: vi.fn() },
  } as unknown as Parameters<typeof stopPlanRun>[1]);
  return updates;
}

beforeEach(() => {
  boundary.hasMarker = false;
  boundary.capture = null;
  boundary.unit = "LoadState=not-found\nActiveState=inactive";
  boundary.write.mockReset();
  boundary.remove.mockReset();
  boundary.execFile.mockReset();
  boundary.execFile.mockImplementation((...call: unknown[]) => {
    const done = call.at(-1);
    if (typeof done === "function") done(null, { stdout: boundary.unit });
  });
});

it("confirms the closeout of a script that never got a process, so the run releases its workspace", async () => {
  const updates = await stop();
  const final = updates.at(-1);
  expect(final?.status).toBe("cancelled");
  expect(final?.controlError).toBeUndefined();
  expect(final?.steps[1].script).toMatchObject({
    processId: null,
    closeout: "confirmed",
    failure: "cancelled",
  });
  expect(final?.steps[1].script?.endedAt).toEqual(expect.any(String));
  expect(final && hasUnconfirmedRunCloseout(final)).toBe(false);
  expect(boundary.remove).toHaveBeenCalledWith(INSTANCE, undefined);
  // Stop never creates a runtime directory for an attempt that owns none.
  expect(boundary.write).not.toHaveBeenCalled();
});

it("keeps the attempt pending while its launched owner unit is still active", async () => {
  boundary.hasMarker = true;
  boundary.capture = unstartedScript();
  boundary.unit = "LoadState=loaded\nActiveState=active";
  const updates = await stop();
  expect(updates.at(-1)?.steps[1].script?.closeout).toBe("pending");
  expect(boundary.remove).not.toHaveBeenCalled();
  expect(boundary.write).toHaveBeenCalledWith(
    expect.stringContaining("control.json"),
    { action: "stop" },
  );
});

it("adopts the capture the owner already ended instead of guessing", async () => {
  boundary.hasMarker = true;
  boundary.capture = {
    ...unstartedScript(),
    endedAt: "2026-11-15T15:04:45.000Z",
    failure: "cancelled",
    closeout: "confirmed",
  };
  const updates = await stop();
  expect(updates.at(-1)?.steps[1].script).toMatchObject({
    endedAt: "2026-11-15T15:04:45.000Z",
    closeout: "confirmed",
  });
  expect(boundary.remove).not.toHaveBeenCalled();
});

it("stops following a stopped attempt whose owner unit ended before the spawn", async () => {
  boundary.hasMarker = true;
  boundary.capture = unstartedScript();
  const save = vi.fn();
  const record = await executeOwnedScript({
    runId: "run",
    record: unstartedScript(),
    program: "/usr/bin/node",
    resources: "/synthetic/resources",
    sharedEnvironment: "/synthetic/shared",
    input: "{}",
    timeoutSeconds: 60,
    signal: AbortSignal.abort(),
    claimStart: vi.fn(),
    save,
  });
  expect(record).toMatchObject({ closeout: "confirmed", failure: "cancelled" });
  expect(save).toHaveBeenCalledTimes(1);
  expect(boundary.remove).toHaveBeenCalledWith(INSTANCE, undefined);
});

it("lets restart and recovery confirm an already stopped attempt that never got a process", async () => {
  const failures: unknown[] = [];
  const checked = await endInterruptedScriptWithFailure(
    await unstartedStep(),
    (failure) => failures.push(failure),
  );
  expect(failures).toEqual([]);
  expect(checked.script).toMatchObject({
    closeout: "confirmed",
    failure: "interrupted",
  });
  expect(boundary.remove).toHaveBeenCalledWith(INSTANCE, undefined);
});

it("still refuses recovery while the owner of the attempt is live", async () => {
  boundary.hasMarker = true;
  boundary.capture = { ...unstartedScript(), processId: 4242 };
  const failures: unknown[] = [];
  const checked = await endInterruptedScriptWithFailure(
    await unstartedStep(),
    (failure) => failures.push(failure),
  );
  expect(failures).toHaveLength(1);
  expect(checked.script?.closeout).not.toBe("confirmed");
  expect(boundary.remove).not.toHaveBeenCalled();
});
