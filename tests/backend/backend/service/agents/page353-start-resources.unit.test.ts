import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { readPlanRun } from "@/backend/agents/AgentPlanRunInput";
import { settleManagedLocalOwner } from "@/backend/agents/local/LocalOwnerControl";
import { endTaggedProcesses } from "@/backend/agents/cli/CliProcessScan";
import { planWriterResourcesCollide } from "@/backend/service/agents/AgentPlanWriterResources";
import { logEvent } from "@/backend/logging/Logger";
import { reservePlanResources } from "@/backend/database/repositories/agent/AgentPlanResourceReservation";
import { forceOwnedNamespace } from "@/backend/agents/cli/CliOwnedNamespace";
import { removeScriptResources } from "@/backend/service/agents/AgentPlanScriptResources";

import { BRANCH, DIRECTORY, startResourceWorld } from "./page353-start-fixture";

import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { DatabaseTransaction } from "@/backend/database/Database";

vi.mock("@/backend/agents/local/LocalOwnerControl", () => ({ settleManagedLocalOwner: vi.fn() }));
vi.mock("@/backend/logging/Logger", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/backend/logging/Logger")>(), logEvent: vi.fn(),
}));
vi.mock("@/backend/agents/cli/CliProcessScan", () => ({ endTaggedProcesses: vi.fn(), readScopeSince: vi.fn(), findTaggedProcesses: vi.fn() }));
vi.mock("@/backend/agents/cli/CliOwnedNamespace", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/backend/agents/cli/CliOwnedNamespace")>(),
  forceOwnedNamespace: vi.fn(async () => true), hasEndedOwnedNamespace: vi.fn(async () => true),
}));
vi.mock("@/backend/service/agents/AgentPlanScriptResources", () => ({ removeScriptResources: vi.fn(async () => undefined) }));
vi.mock("@/backend/service/agents/AgentPlanWriterResources", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/backend/service/agents/AgentPlanWriterResources")>(),
  expandedPlanWriteResources: vi.fn(async (keys: readonly string[]) => keys.some((key) => key.startsWith("local-directory:")) ? [...keys, "local-git-branch:synthetic-branch"] : keys),
}));

beforeEach(() => { vi.mocked(settleManagedLocalOwner).mockResolvedValue(true); });
afterEach(() => { vi.useRealTimers(); });

it.each(["failed", "cancelled", "succeeded"] as const)("Play frees all directory, branch and session owners of a %s run before reservation", async (status) => {
  const world = await startResourceWorld({ status });
  const next = await world.engine.start("starting-user", world.snapshot);
  expect(next.isWaitingForWorkspace).not.toBe(true);
  expect(next.workspaceWait).toBeUndefined();
  expect(world.create).toHaveBeenCalledOnce();
  expect(world.blocker).not.toHaveBeenCalled();
  expect([...world.database.locks.values()]).not.toContain(world.old.id);
  expect([...world.database.owners.values()].every((owner) => owner.isReleased)).toBe(true);
  expect(settleManagedLocalOwner).toHaveBeenCalledWith("owned-instance");
  expect(settleManagedLocalOwner).toHaveBeenCalledWith("orphan-owner");
  expect(world.localSessions.forgetForcedRun).toHaveBeenCalledWith(world.old.id);
  expect(world.resources.forceReleaseRun).toHaveBeenCalledWith(world.old.id);
  expect(world.database.statements.some((entry) => entry.statement.includes("DELETE FROM acp_resource_leases") && entry.parameters?.run_id === world.old.id)).toBe(true);
  expect(world.database.runs.get(world.old.id)?.status).toBe(status);
  await world.engine.shutdown();
});

it("unconfirmed legacy process end becomes a hint while the new run obtains the writers", async () => {
  vi.mocked(settleManagedLocalOwner).mockResolvedValue(null);
  vi.mocked(endTaggedProcesses).mockRejectedValue(new Error("Unverified legacy process"));
  const world = await startResourceWorld();
  const next = await world.engine.start("starting-user", world.snapshot);
  expect(next.startCleanupUnconfirmed).toEqual([world.old.id]);
  expect(next.workspaceWait).toBeUndefined();
  expect(world.database.runs.get(world.old.id)?.resourceReleases?.[0]?.confirmed).toBe(false);
  expect(world.create).toHaveBeenCalledOnce();
  await world.engine.shutdown();
});

it.each([false, true])("fences and aborts a genuinely running owner, including another plan (%s)", async (otherPlan) => {
  const world = await startResourceWorld({ seed: false });
  let wasAborted = false;
  world.execute.mockImplementationOnce(async (_run, _snapshot, _step, control) => new Promise((resolve) => {
    control.signal.addEventListener("abort", () => {
      wasAborted = true;
      resolve({ status: "cancelled", cancellation: "confirmed" });
    }, { once: true });
  }));
  const first = await world.engine.start("owner", world.snapshot);
  world.database.seed({ ...first, planName: "Running Plan" });
  const snapshot = otherPlan ? { ...world.snapshot, plan: { ...world.snapshot.plan, id: "new-plan" } } : world.snapshot;
  expect(await world.service.owners(snapshot)).toEqual([{ runId: first.id, planName: "Running Plan", startedAt: first.startedAt }]);
  const next = await world.engine.start("starting-user", snapshot);
  expect(wasAborted).toBe(true);
  expect(world.engine.isActive(first.id)).toBe(false);
  expect(world.database.runs.get(first.id)?.status).toBe("cancelled");
  expect(world.database.runs.get(first.id)?.stopRequested).toBe(true);
  expect(next.id).not.toBe(first.id);
  expect(next.workspaceWait).toBeUndefined();
  await world.engine.shutdown();
});

it("keeps old results and a parseable release journal with actor, time, resources and process evidence", async () => {
  const world = await startResourceWorld();
  await world.engine.start("starting-user", world.snapshot);
  const stored = world.database.runs.get(world.old.id);
  expect(stored?.steps).toEqual(readPlanRun(world.old).steps);
  const release = stored?.resourceReleases?.[0];
  expect(release).toMatchObject({ userId: "starting-user", resources: [DIRECTORY, BRANCH], confirmed: true });
  expect(release?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
  expect(release?.processes).toContainEqual({ instanceId: "owned-instance", processId: 4321, kind: "local_session", confirmed: true });
  expect(logEvent).toHaveBeenCalledWith(expect.objectContaining({ event: "agent.run.resource_force_released", metadata: expect.objectContaining({ userId: "starting-user", reason: DIRECTORY }) }));
  expect(logEvent).toHaveBeenCalledWith(expect.objectContaining({ event: "agent.run.process_force_ended", metadata: expect.objectContaining({ sessionId: "owned-instance", pid: 4321, isConfirmed: true }) }));
  expect(readPlanRun(JSON.parse(JSON.stringify(stored))).resourceReleases).toEqual([release]);
  await world.engine.shutdown();
});

it("an old scheduler cannot reacquire resources after its forced-release fence was committed", async () => {
  const world = await startResourceWorld();
  await world.engine.start("starting-user", world.snapshot);
  const retired = world.database.runs.get(world.old.id);
  const transaction: DatabaseTransaction = { query: vi.fn(async () => [[JSON.stringify(retired)]]), execute: vi.fn() };
  expect(await reservePlanResources(transaction, world.old.id, [DIRECTORY])).toBe(false);
  expect(transaction.execute).not.toHaveBeenCalled();
  await world.engine.shutdown();
});

it("restarts with fresh node states and keeps the source revision available for the restart journal", async () => {
  const world = await startResourceWorld();
  const next = await world.engine.startRecovered("starting-user", world.snapshot, {
    origin: { kind: "restart", runId: world.old.id, mode: null, checkpointVersion: null,
      reusedStepIds: [], retriedStepIds: [], reviewedStepIds: [], requestedAt: new Date().toISOString() },
    reused: [], loops: [],
  }, async () => undefined);
  expect(next.id).not.toBe(world.old.id);
  expect(next.origin?.kind).toBe("restart");
  expect(next.workspaceWait).toBeUndefined();
  expect(world.database.statements.filter((entry) => entry.statement.includes("UPDATE agent_plan_runs"))
    .every((entry) => entry.parameters?.advance === 0)).toBe(true);
  await world.engine.shutdown();
});

it("finds all colliding directories, branch-only locks, remote locks and native owners without locks", async () => {
  const world = await startResourceWorld({ otherPlan: true });
  world.database.locks.clear();
  expect(await world.repository.conflicts("new-plan", [DIRECTORY])).toHaveLength(1);
  world.database.locks.set(BRANCH, world.old.id);
  expect(await world.repository.conflicts("new-plan", ["local-directory:/another-worktree"])).toHaveLength(1);
  world.database.locks.clear();
  world.database.locks.set("local-directory:/synthetic/child", world.old.id);
  expect(await world.repository.conflicts("new-plan", [DIRECTORY])).toHaveLength(1);
  world.database.locks.clear();
  world.database.locks.set("remote-workspace:host:path", world.old.id);
  expect(await world.repository.conflicts("new-plan", ["remote-workspace:host:path"])).toHaveLength(1);
  expect(await world.repository.conflicts("new-plan", ["remote-workspace:other:path"])).toEqual([]);
  expect(planWriterResourcesCollide(DIRECTORY, "local-directory:/synthetic-other")).toBe(false);
});

it("an unreachable remote runner cannot block a new run and records unconfirmed remote cleanup", async () => {
  const remote = { stop: vi.fn(async () => { throw new Error("Runner unreachable"); }), withProgress: vi.fn(async (run: AgentPlanRun) => run) };
  const world = await startResourceWorld({ remote });
  const remoteOld: AgentPlanRun = { ...world.old, steps: world.old.steps.map((step, index) => index === 0 ? {
    ...step, execution: {
      schemaVersion: 1, planId: world.old.planId, runId: world.old.id, planRevision: 1,
      stepId: step.id, attemptId: "39260d06-f6c1-43c2-af4e-a301f740541d", target: { kind: "remote", connectionId: "offline", connectionName: "Offline", connectionRevision: 1, workspaceId: "remote-workspace", workspaceName: "Remote", workspaceRevision: 1, path: "/work" },
      workspace: { id: "remote-workspace", path: "/work", revision: 1 },
      modelAccess: { connectionId: null, connectionName: "Offline", provider: "codex_cli", model: "model", reasoningEffort: null },
    },
  } : step) };
  world.database.runs.set(remoteOld.id, remoteOld);
  const next = await world.engine.start("starting-user", world.snapshot);
  expect(remote.stop).toHaveBeenCalledOnce();
  expect(next.startCleanupUnconfirmed).toEqual([world.old.id]);
  expect(world.database.locks.get(DIRECTORY)).toBe(next.id);
  expect(world.database.runs.get(world.old.id)?.resourceReleases?.[0]?.processes.some((process) => process.kind === "remote_attempt" && !process.confirmed)).toBe(true);
  await world.engine.shutdown();
});

it("bounds a hung cleanup operation and still releases the old owner", async () => {
  vi.useFakeTimers();
  vi.mocked(settleManagedLocalOwner).mockImplementation(async () => new Promise<boolean>(() => undefined));
  const world = await startResourceWorld();
  const pending = world.engine.start("starting-user", world.snapshot);
  await vi.advanceTimersByTimeAsync(30_000);
  const next = await pending;
  expect(next.startCleanupUnconfirmed).toEqual([world.old.id]);
  expect([...world.database.owners.values()].every((owner) => owner.isReleased)).toBe(true);
  await world.engine.shutdown();
});

it("forces an old script's owned namespace to end before releasing its write resources", async () => {
  const world = await startResourceWorld();
  const namespace = { pid: 1234, uid: 1000, start: 12345, boot: "1be60ce5-2260-491d-bcec-b25a2b4e380d" };
  const instanceId = "8310be22-b193-41e6-876b-fc1ce7d20e44";
  world.database.runs.set(world.old.id, { ...world.old, steps: world.old.steps.map((step, index) => index === 0 ? {
    ...step, session: null, script: {
      attemptId: "2aa7d334-8760-4199-804d-1bd1fd827143", instanceId, interpreterProfileId: "shell",
      directory: "/synthetic", userId: "owner", uid: 1000, gid: 1000, processId: 1234, namespace,
      startedAt: world.old.startedAt, endedAt: null, exitCode: null, signal: null, failure: "cleanup",
      closeout: "failed", stdout: "old result", stderr: "old diagnostic",
    },
  } : step) });
  const next = await world.engine.start("starting-user", world.snapshot);
  expect(forceOwnedNamespace).toHaveBeenCalledWith(namespace, instanceId);
  expect(removeScriptResources).toHaveBeenCalledWith(instanceId);
  expect(next.workspaceWait).toBeUndefined();
  expect(world.database.runs.get(world.old.id)?.resourceReleases?.[0]?.processes)
    .toContainEqual({ instanceId, processId: 1234, kind: "local_script", confirmed: true });
  await world.engine.shutdown();
});
