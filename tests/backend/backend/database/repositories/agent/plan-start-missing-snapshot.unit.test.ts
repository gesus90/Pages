import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { AgentPlanStartResourceRepository } from "@/backend/database/repositories/agent/AgentPlanStartResourceRepository";
import { AgentError } from "@/backend/error/AgentErrors";
import { logEvent } from "@/backend/logging/Logger";
import { AgentPayloadFileStore } from "@/backend/storage/AgentPayloadFileStore";

import { recoveryFixture } from "../../../service/agents/page84-recovery-fixture";

import type { DatabaseValue } from "@/backend/database/Database";
import type * as LoggerModule from "@/backend/logging/Logger";
import type * as WriterResourcesModule from "@/backend/service/agents/AgentPlanWriterResources";
import type { AgentPlanRun } from "@/definition/AgentPlan";

vi.mock("@/backend/logging/Logger", async (importOriginal) => ({
  ...(await importOriginal<typeof LoggerModule>()),
  logEvent: vi.fn(),
}));

// Local directories would ask Git for their branch; these tests name remote workspaces only.
vi.mock(
  "@/backend/service/agents/AgentPlanWriterResources",
  async (importOriginal) => ({
    ...(await importOriginal<typeof WriterResourcesModule>()),
    expandedPlanWriteResources: async (keys: readonly string[]) => [...keys],
  }),
);

const DELETED_PLAN = "deleted-plan";
const STARTING_PLAN = "starting-plan";
const HELD = "remote-workspace:held";

let directory: string;
let store: AgentPayloadFileStore;

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "pages-start-snapshot-"));
  store = new AgentPayloadFileStore(directory);
  vi.mocked(logEvent).mockClear();
});

afterEach(async () => {
  await store.close();
  await rm(directory, { recursive: true, force: true });
});

/** A failed run of a plan whose payload directory is gone, as left by deleting that plan. */
async function orphanedRun(): Promise<{
  readonly run: AgentPlanRun;
  readonly snapshot: string;
}> {
  const fixture = await recoveryFixture();
  const snapshot = await store.write(
    DELETED_PLAN,
    JSON.stringify(fixture.snapshot),
  );
  await rm(path.join(directory, "agent-payloads"), {
    recursive: true,
    force: true,
  });
  await store.write("unrelated-plan", "{}");
  return {
    run: { ...fixture.failed, id: "orphan-run", planId: DELETED_PLAN },
    snapshot,
  };
}

/** Answers the start query with one row per lock of the run, or one row without a lock. */
function repository(
  run: AgentPlanRun,
  snapshot: string,
  locks: readonly string[],
): AgentPlanStartResourceRepository {
  const rows: DatabaseValue[][] = (locks.length ? locks : [null]).map(
    (lock) => [JSON.stringify(run), snapshot, lock],
  );
  return new AgentPlanStartResourceRepository({
    agentFiles: store,
    query: async () => rows,
    transaction: async () => {
      throw new Error("No transaction expected");
    },
  });
}

it("does not let an unreleased owner of a deleted plan block the start of another plan", async () => {
  const { run, snapshot } = await orphanedRun();
  const conflicts = await repository(run, snapshot, []).conflicts(
    STARTING_PLAN,
    [HELD],
  );
  expect(conflicts).toEqual([]);
  expect(logEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      level: "warn",
      event: "agent.plan.start.owner_snapshot_missing",
      metadata: { runId: "orphan-run", planId: DELETED_PLAN, lockCount: 0 },
    }),
  );
});

it("keeps the lock rows of a run without snapshot as its resources", async () => {
  const { run, snapshot } = await orphanedRun();
  const legacy = "workspace-registration-id";
  const conflicts = await repository(run, snapshot, [legacy, HELD]).conflicts(
    STARTING_PLAN,
    [HELD],
  );
  expect(
    conflicts.map((owner) => ({
      id: owner.run.id,
      resources: owner.resources,
    })),
  ).toEqual([{ id: run.id, resources: [legacy, HELD] }]);
  expect(logEvent).toHaveBeenCalledOnce();
});

it("ignores a run without snapshot whose locks do not collide with the start", async () => {
  const { run, snapshot } = await orphanedRun();
  const conflicts = await repository(run, snapshot, [
    "workspace-registration-id",
  ]).conflicts(STARTING_PLAN, [HELD]);
  expect(conflicts).toEqual([]);
});

it("still refuses the start when a snapshot exists but is damaged", async () => {
  const fixture = await recoveryFixture();
  const snapshot = await store.write(
    DELETED_PLAN,
    JSON.stringify(fixture.snapshot),
  );
  const reference: unknown = JSON.parse(snapshot);
  if (
    typeof reference !== "object" ||
    reference === null ||
    !("path" in reference) ||
    typeof reference.path !== "string"
  )
    throw new Error("Unexpected payload reference");
  await writeFile(path.join(directory, reference.path), "damaged");
  const run = { ...fixture.failed, id: "damaged-run", planId: DELETED_PLAN };
  await expect(
    repository(run, snapshot, []).conflicts(STARTING_PLAN, [HELD]),
  ).rejects.toEqual(new AgentError("plan_payload_corrupt"));
  expect(logEvent).not.toHaveBeenCalled();
});
