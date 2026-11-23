import { beforeEach, expect, it, vi } from "vitest";

import type { Mock } from "vitest";

import {
  findPlanResourceBlocker,
  reservePlanResources,
  retireRestartSource,
} from "./AgentPlanResourceReservation";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { AgentPlanWriterWait } from "@/definition/AgentPlanExecution";
import type { AgentPlanRun } from "@/definition/AgentPlan";

const payloads = vi.hoisted(() => ({ read: vi.fn() }));

vi.mock("@/backend/storage/AgentPayloadFileStore", () => ({
  readStoredAgentPayload: payloads.read,
}));
vi.mock("@/backend/agents/AgentPlanRunInput", () => ({
  readPlanRun: (input: unknown) => input,
}));
vi.mock("@/backend/service/agents/AgentPlanSnapshot", () => ({
  readPlanSnapshot: (input: unknown) => input,
}));
vi.mock("@/backend/service/agents/AgentPlanContinuation", () => ({
  planWritingWorkspaces: (snapshot: { resources: string[] }) =>
    snapshot.resources,
}));
vi.mock("@/backend/service/agents/AgentPlanWriterResources", () => ({
  expandedPlanWriteResources: async (keys: readonly string[]) => keys,
  planWriterResourcesCollide: (a: string, b: string) => a === b,
  isConcretePlanWriterResource: (key: string) => key.startsWith("c:"),
}));
vi.mock("@/definition/AgentPlanLoopResults", () => ({
  allPlanRunResults: (owner: { results?: unknown[] }) => owner.results ?? [],
}));
vi.mock("@/backend/service/agents/AgentPlanRunState", () => ({
  hasUnconfirmedRunCloseout: (owner: { unconfirmed?: boolean }) =>
    owner.unconfirmed === true,
}));

beforeEach(() => {
  payloads.read.mockReset();
});

function run(fields: Record<string, unknown> = {}): AgentPlanRun {
  return {
    id: "r1",
    planId: "p1",
    userId: "u1",
    status: "running",
    steps: [],
    ...fields,
  } as unknown as AgentPlanRun;
}

interface FakeTransaction extends DatabaseTransaction {
  readonly query: Mock;
  readonly execute: Mock;
}

interface ViewParams {
  readonly view_json: string;
}

interface SavedRun {
  readonly status: string;
  readonly endedAt: string;
  readonly steps: readonly { readonly status: string }[];
}

function transactionOf(handler: (sql: string) => unknown[][]): FakeTransaction {
  const fake = {
    query: vi.fn(async (sql: string) => handler(sql)),
    execute: vi.fn(async () => undefined),
  };
  return fake;
}

function reservation(
  current: unknown[][],
  locks: unknown[][],
): FakeTransaction {
  return transactionOf((sql) => (sql.includes("view_json") ? current : locks));
}

it("refuses a reservation while a release is pending", async () => {
  const transaction = reservation(
    [[JSON.stringify(run({ resourceReleases: [{}] }))]],
    [],
  );

  expect(await reservePlanResources(transaction, "r1", ["c:a"])).toBe(false);
  expect(transaction.execute).not.toHaveBeenCalled();
});

it("reserves every key when no other holder collides", async () => {
  const transaction = reservation([], [["c:b", null]]);

  expect(await reservePlanResources(transaction, "r1", ["c:a", "c:c"])).toBe(
    true,
  );
  expect(transaction.execute).toHaveBeenCalledTimes(2);
});

it("reserves for a run without release evidence", async () => {
  const transaction = reservation([[JSON.stringify(run())]], []);

  expect(await reservePlanResources(transaction, "r1", ["c:a"])).toBe(true);
});

it("queues behind a concrete holder of the same resource", async () => {
  const transaction = reservation([], [["c:a", null]]);

  expect(await reservePlanResources(transaction, "r1", ["c:a"])).toBe(false);
});

it("compares a legacy holder through its stored snapshot", async () => {
  payloads.read.mockResolvedValue(JSON.stringify({ resources: ["c:a"] }));
  const colliding = reservation([], [["legacy", "snap"]]);
  const apart = reservation([], [["legacy", "snap"]]);

  expect(await reservePlanResources(colliding, "r1", ["c:a"])).toBe(false);
  expect(await reservePlanResources(apart, "r1", ["c:z"])).toBe(true);
});

it("fails when a legacy holder has no snapshot", async () => {
  const transaction = reservation([], [["legacy", null]]);

  await expect(
    reservePlanResources(transaction, "r1", ["c:a"]),
  ).rejects.toThrow("Legacy writer snapshot missing");
});

it("does nothing to a restart-free run", async () => {
  const transaction = transactionOf(() => []);

  await retireRestartSource(transaction, run());

  expect(transaction.query).not.toHaveBeenCalled();
});

function restartRun(fields: Record<string, unknown> = {}): AgentPlanRun {
  return run({
    id: "r2",
    startedAt: "T",
    origin: { kind: "restart", runId: "r1" },
    ...fields,
  });
}

it("refuses a restart whose source run is gone", async () => {
  const transaction = transactionOf(() => []);

  await expect(
    retireRestartSource(transaction, restartRun()),
  ).rejects.toMatchObject({ code: "plan_run_unavailable" });
});

it("refuses a restart across plans", async () => {
  const transaction = transactionOf(() => [
    [JSON.stringify(run({ planId: "other" }))],
  ]);

  await expect(
    retireRestartSource(transaction, restartRun()),
  ).rejects.toMatchObject({ code: "plan_access_denied" });
});

it("leaves an already ended source alone", async () => {
  const transaction = transactionOf(() => [
    [JSON.stringify(run({ status: "failed" }))],
  ]);

  await retireRestartSource(transaction, restartRun());

  expect(transaction.execute).not.toHaveBeenCalled();
});

it("cancels an active source and its unstarted steps", async () => {
  const steps = [
    { id: "a", status: "waiting" },
    { id: "b", status: "paused" },
    { id: "c", status: "succeeded" },
  ];
  const transaction = transactionOf(() => [[JSON.stringify(run({ steps }))]]);

  await retireRestartSource(transaction, restartRun());

  const params = transaction.execute.mock.calls[0]?.[1] as ViewParams;
  const saved = JSON.parse(params.view_json) as SavedRun;
  expect(saved.status).toBe("cancelled");
  expect(saved.endedAt).toBe("T");
  expect(saved.steps.map((step) => step.status)).toEqual([
    "cancelled",
    "cancelled",
    "succeeded",
  ]);
});

function blockerTransaction(rows: unknown[][]): FakeTransaction {
  return transactionOf(() => rows);
}

it("reports no blocker without keys and without holders", async () => {
  const transaction = blockerTransaction([]);

  expect(await findPlanResourceBlocker(transaction, run(), [])).toBeNull();
});

it("falls back to a legacy blocker when no holder matches", async () => {
  const transaction = blockerTransaction([["c:other", null, null]]);

  expect(
    await findPlanResourceBlocker(transaction, run(), ["c:a", "c:b"]),
  ).toEqual({
    resource: "c:a, c:b",
    reason: "legacy_owner_cleanup_required",
    runId: null,
    jobId: null,
    attemptId: null,
  });
});

it("reports missing owner evidence for a holder without a run", async () => {
  const transaction = blockerTransaction([["c:a", null, null]]);

  expect(
    await findPlanResourceBlocker(transaction, run({ id: "r9" }), ["c:a"]),
  ).toMatchObject({ reason: "owner_evidence_unavailable", runId: null });
});

function blockerFor(
  owner: Record<string, unknown>,
  userId = "u1",
): Promise<AgentPlanWriterWait | null> {
  const transaction = blockerTransaction([
    ["c:a", JSON.stringify(run({ id: "o1", ...owner })), null],
  ]);
  return findPlanResourceBlocker(transaction, run({ userId }), ["c:a"]);
}

it("names an active own run as the writer reservation", async () => {
  expect(await blockerFor({})).toEqual({
    resource: "c:a",
    reason: "writer_reserved",
    runId: "o1",
    jobId: null,
    attemptId: null,
  });
});

it("hides run, job and attempt of a foreign owner", async () => {
  const blocked = await blockerFor({}, "u2");

  expect(blocked).toMatchObject({ runId: null, jobId: null });
});

it("takes job and attempt from an open closeout of an own run", async () => {
  const results = [
    { remote: { closeout: "confirmed" } },
    {
      remote: { closeout: "pending", jobId: "j1" },
      execution: { attemptId: "a1" },
    },
  ];

  expect(await blockerFor({ status: "failed", results })).toMatchObject({
    reason: "reserved_for_resume",
    jobId: "j1",
    attemptId: "a1",
  });
});

it("falls back to null job and attempt for a bare open closeout", async () => {
  const results = [{ remote: { closeout: "failed" } }];

  expect(await blockerFor({ status: "failed", results })).toMatchObject({
    jobId: null,
    attemptId: null,
  });
});

it("names the cancellation failure of a failed closeout", async () => {
  const results = [
    {
      remote: { closeout: "failed", cancellation: { failure: "kill_failed" } },
    },
  ];

  expect(await blockerFor({ results })).toMatchObject({
    reason: "kill_failed",
  });
});

it("distinguishes unconfirmed, resumable and pending releases", async () => {
  expect(
    await blockerFor({ status: "cancelled", unconfirmed: true }),
  ).toMatchObject({ reason: "process_end_unconfirmed" });
  expect(await blockerFor({ status: "failed" })).toMatchObject({
    reason: "reserved_for_resume",
  });
  expect(await blockerFor({ status: "succeeded" })).toMatchObject({
    reason: "release_pending",
  });
});
