import { describe, expect, it, vi } from "vitest";

import { AgentImportRepository } from "@/backend/database/repositories/agents/AgentImportRepository";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { StructuredImportStepService } from "@/backend/service/agents/StructuredImportStepService";
import { planStructuredImport } from "@/backend/service/agents/StructuredImportPlanner";

import { planningIdentity } from "../helpers/agent-planning";
import {
  applyStructured,
  structuredManifest,
  useStructuredImportHarness,
} from "../helpers/structured-import";

import type { StructuredImportGraph } from "@/backend/service/agents/StructuredImportPlanner";

const setup = useStructuredImportHarness();
const verify = async () => planningIdentity;

async function stepRun(
  graph: StructuredImportGraph = planStructuredImport(structuredManifest()),
) {
  const harness = await setup();
  const run = {
    id: "run",
    userId: "owner",
    graph,
    projectIds: new Map([["project", "p1"]]),
  };
  await harness.environment.imports.insertRun({
    id: run.id,
    userId: run.userId,
    projectId: "p1",
    status: "running",
    snapshotJson: "{}",
  });
  const service = new StructuredImportStepService({
    database: harness.database,
    tickets: harness.planning.tickets,
    milestones: harness.planning.milestones,
    announcer: harness.planning.announcer,
  });
  return { harness, run, service };
}

describe("structured steps commit and recover", () => {
  it("records blocked dependencies and children and never replaces an already recorded result on failed verification", async () => {
    const { harness, run, service } = await stepRun();
    const child = run.graph.steps.find((step) => step.name === "child");
    const dependency = run.graph.steps.find(
      (step) => step.kind === "dependency",
    );
    if (!child || !dependency) throw new Error("Expected dependent steps.");
    await service.apply(run, child, 0, verify);
    await service.apply(run, dependency, 1, verify);
    const items = await harness.environment.imports.listStoredItems(run.id);
    expect(items).toMatchObject([
      { action: "conflict", reason: "blocked", targetId: null },
      { action: "conflict", reason: "blocked", targetId: null },
    ]);
    await service.apply(run, child, 0, async () => ({
      ...planningIdentity,
      userId: "other",
    }));
    expect(await harness.environment.imports.listStoredItems(run.id)).toEqual(
      items,
    );
    expect(harness.listener).not.toHaveBeenCalled();
  });

  it("records revoked credentials as a failure before looking at any source", async () => {
    const { harness, run, service } = await stepRun();
    const step = run.graph.steps[0];
    if (!step) throw new Error("Expected milestone.");
    await service.apply(run, step, 0, async () => ({
      ...planningIdentity,
      userId: "other",
    }));
    expect(
      await harness.environment.imports.findStoredItem(run.id, step.key),
    ).toMatchObject({ action: "failed", errorCode: "AUTH_INVALID" });
    expect(await harness.database.query("SELECT id FROM milestones;")).toEqual(
      [],
    );
  });

  it("records invalid project and absent milestone or ticket sources without creating objects", async () => {
    const { harness, run, service } = await stepRun();
    const milestone = run.graph.steps[0];
    const ticket = run.graph.steps.find((step) => step.name === "parent");
    if (!milestone || !ticket) throw new Error("Expected source steps.");
    await service.apply(
      { ...run, projectIds: new Map() },
      milestone,
      0,
      verify,
    );
    const graph = {
      ...run.graph,
      sources: {
        ...run.graph.sources,
        milestones: new Map(),
        tickets: new Map(),
      },
      parents: new Map(),
      milestones: new Map(),
    };
    const next = run.graph.steps[1];
    if (!next) throw new Error("Expected second milestone.");
    await service.apply({ ...run, graph }, next, 1, verify);
    await service.apply({ ...run, graph }, ticket, 2, verify);
    expect(
      await harness.environment.imports.listStoredItems(run.id),
    ).toMatchObject([
      { errorCode: "INVALID_REQUEST" },
      { errorCode: "INVALID_REQUEST" },
      { errorCode: "INVALID_REQUEST" },
    ]);
    expect(await harness.database.query("SELECT id FROM milestones;")).toEqual(
      [],
    );
    expect(await harness.database.query("SELECT id FROM work_items;")).toEqual(
      [],
    );
  });

  it("rolls back the object and baseline on a storage failure, then resumes once", async () => {
    const { harness, run, service } = await stepRun();
    const step = run.graph.steps[0];
    if (!step) throw new Error("Expected milestone.");
    const failure = new Error("result store unavailable");
    vi.spyOn(
      AgentImportRepository.prototype,
      "recordStructuredItem",
    ).mockRejectedValueOnce(failure);
    await expect(service.apply(run, step, 0, verify)).rejects.toBe(failure);
    expect(await harness.database.query("SELECT id FROM milestones;")).toEqual(
      [],
    );
    expect(
      await harness.database.query(
        "SELECT source_key FROM agent_import_sources;",
      ),
    ).toEqual([]);
    expect(harness.listener).not.toHaveBeenCalled();
    await service.apply(run, step, 0, verify);
    await service.apply(run, step, 0, verify);
    expect(
      await harness.database.query("SELECT COUNT(*) FROM milestones;"),
    ).toEqual([[1]]);
    expect(harness.listener).toHaveBeenCalledOnce();
  });

  it.each(["null", '{"key":42,"link":false}'])(
    "retains a mapped target when stored creation metadata is %s",
    async (resultJson) => {
      const harness = await setup();
      await applyStructured(harness);
      await harness.database.execute(
        "UPDATE agent_import_sources SET result_json = $json WHERE target_kind = 'ticket';",
        { json: resultJson },
      );
      const result = await applyStructured(
        harness,
        structuredManifest(),
        "repeat",
      );
      expect(
        result.items.filter((item) => item.kind === "ticket"),
      ).toMatchObject([
        { action: "skipped", key: null, link: null },
        { action: "skipped", key: null, link: null },
      ]);
    },
  );

  it("refreshes converged milestone and dependency baselines and does not build on removed targets", async () => {
    const harness = await setup();
    await applyStructured(harness);
    await harness.database.execute(
      "UPDATE agent_import_sources SET content_hash = 'old' WHERE target_kind IN ('milestone', 'dependency');",
    );
    expect(
      (await applyStructured(harness, structuredManifest(), "refresh")).counts
        .skipped,
    ).toBe(7);
    expect(
      await harness.database.query(
        "SELECT source_key FROM agent_import_sources WHERE content_hash = 'old';",
      ),
    ).toEqual([]);
    await harness.database.execute(
      "UPDATE agent_import_sources SET target_id = 'missing' WHERE target_kind = 'milestone';",
    );
    const result = await applyStructured(
      harness,
      structuredManifest(),
      "removed",
    );
    expect(result.status).toBe("partial");
    expect(
      result.items.filter((item) => item.kind === "milestone"),
    ).toMatchObject([
      { action: "conflict", targetId: null, reason: "target_removed" },
      { action: "conflict", targetId: null, reason: "target_removed" },
    ]);
    expect(
      result.items.find((item) => item.kind === "dependency"),
    ).toMatchObject({ reason: "blocked" });
    expect(
      result.items.find((item) => item.sourceKey === "ticket:parent"),
    ).toMatchObject({ reason: "blocked" });
  });

  it("records known creation failures independently while later sources remain applicable", async () => {
    const { harness, run, service } = await stepRun();
    const first = run.graph.steps[0];
    const next = run.graph.steps[1];
    if (!first || !next) throw new Error("Expected milestones.");
    vi.spyOn(harness.planning.milestones, "createWithin").mockRejectedValueOnce(
      new AgentOperationError("FORBIDDEN"),
    );
    await service.apply(run, first, 0, verify);
    await service.apply(run, next, 1, verify);
    expect(
      await harness.environment.imports.listStoredItems(run.id),
    ).toMatchObject([
      { action: "failed", errorCode: "FORBIDDEN" },
      { action: "created" },
    ]);
    expect(harness.listener).toHaveBeenCalledOnce();
  });
});
