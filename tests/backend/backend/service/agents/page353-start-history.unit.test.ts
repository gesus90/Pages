import { expect, it, vi } from "vitest";

import { AgentPlanProgressRepository } from "@/backend/database/repositories/agent/AgentPlanProgressRepository";
import { purgeAllPlanRuns, purgeEarlierPlanRuns } from "@/backend/database/repositories/agent/AgentPlanRunPurge";
import { forgetForcedLocalRun } from "@/backend/agents/local/LocalSessionForcedRelease";

import { recoveryFixture } from "./page84-recovery-fixture";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { AgentPlanResourceRelease } from "@/definition/AgentPlanResourceRelease";
import type { LocalSessionEntry } from "@/backend/database/repositories/agent/LocalSessionRepository";

vi.mock("@/backend/service/agents/diagnosis/AgentRunFailureIndexer", () => ({ indexRunFailures: vi.fn() }));

const RELEASE: AgentPlanResourceRelease = {
  id: "875af1ac-cab5-4358-a523-ed9251b6ca10", userId: "starting-user", targetRunId: "new-run",
  createdAt: "2026-11-13T13:29:00Z", resources: ["local-directory:/synthetic"], processes: [], confirmed: false,
};

it("late local and remote progress cannot overwrite a forced release or the previous results", async () => {
  const fixture = await recoveryFixture();
  const retired = { ...fixture.failed, stopRequested: true, resourceReleases: [RELEASE] };
  const transaction: DatabaseTransaction = {
    query: vi.fn(async () => [[JSON.stringify(retired), 5, JSON.stringify(fixture.snapshot)]]),
    execute: vi.fn(),
  };
  const repository = new AgentPlanProgressRepository({
    query: transaction.query,
    transaction: async (work) => work(transaction),
  });
  await repository.update({ ...fixture.initial, status: "running" });
  await repository.persist(transaction, { ...fixture.initial, status: "running" });
  expect(transaction.execute).not.toHaveBeenCalled();
});

it("a Play purge already in progress preserves a newly force-released run; explicit plan deletion can still delete it", async () => {
  let isDeleted = false;
  const transaction: DatabaseTransaction = {
    query: vi.fn(async (statement, parameters) => {
      if (statement.includes("FOR UPDATE")) return parameters?.preserve_released ? [] : [["old-run"]];
      return [["old-run"]];
    }),
    execute: vi.fn(async (statement) => {
      if (statement === "DELETE FROM agent_plan_runs WHERE id = $run_id;") isDeleted = true;
    }),
  };
  const database = { query: transaction.query, transaction: async <Result,>(work: (current: DatabaseTransaction) => Promise<Result>): Promise<Result> => work(transaction) };
  await purgeEarlierPlanRuns(database, "new-run");
  expect(isDeleted).toBe(false);
  await purgeAllPlanRuns(database, "plan");
  expect(isDeleted).toBe(true);
});

it("retires stale native observers even when their owner no longer accepts release commands", async () => {
  const entry: LocalSessionEntry = {
    instanceId: "old-instance", instanceKey: "instance", runId: "old-run", stepId: "step",
    attemptId: "attempt", manifestDigest: "digest", proof: null,
    acknowledgedSequence: 0, acknowledgedDigest: "digest", checkpointFile: null, releasedAt: null,
  };
  const entries = new Map([[entry.instanceId, entry], ["other-instance", { ...entry, instanceId: "other-instance", runId: "other-run" }]]);
  const detach = vi.fn();
  const attached = new Map([[entry.instanceId, { session: { detach } }]]);
  const proven = new Set([entry.instanceId]);
  const uncertain = new Set([entry.instanceId]);
  await forgetForcedLocalRun(entry.runId, { entries, attached, proven, uncertain,
    release: async () => { throw new Error("Original owner unavailable"); },
  });
  expect(detach).toHaveBeenCalledOnce();
  expect(entries.get(entry.instanceId)?.releasedAt).toBeTruthy();
  expect(entries.get("other-instance")?.releasedAt).toBeNull();
  expect(attached.has(entry.instanceId)).toBe(false);
  expect(proven.has(entry.instanceId)).toBe(false);
  expect(uncertain.has(entry.instanceId)).toBe(false);
});
