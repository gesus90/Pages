import { describe, expect, it, vi } from "vitest";

import { TaskService } from "@/backend/service/TaskService";
import { WorkItemNotFoundError } from "@/backend/error/WorkItemErrors";
import {
  compareDependencyTarget,
  compareMilestoneTarget,
  compareTicketTarget,
  structuredStepHash,
} from "@/backend/service/agents/StructuredImportDecision";
import { planStructuredImport } from "@/backend/service/agents/StructuredImportPlanner";

import {
  applyStructured,
  structuredManifest,
  useStructuredImportHarness,
} from "../helpers/structured-import";

const setup = useStructuredImportHarness();
const projectIds = new Map([["project", "p1"]]);

async function setupTarget(kind: "ticket" | "milestone" | "dependency") {
  const harness = await setup();
  await applyStructured(harness);
  const graph = planStructuredImport(structuredManifest());
  const step = graph.steps.find((entry) => entry.kind === kind);
  if (!step) throw new Error("Expected step.");
  const mapping = await harness.environment.imports.findSource("p1", step.key);
  if (!mapping) throw new Error("Expected source mapping.");
  return {
    harness,
    graph,
    step,
    mapping,
    hash: structuredStepHash(step, graph, projectIds),
  };
}

describe("structured source and target comparison", () => {
  it("hashes trimmed fields, nullable dates and keyed links without requiring existing targets", () => {
    const original = structuredManifest();
    const graph = planStructuredImport(original);
    const step = graph.steps.find((entry) => entry.kind === "milestone");
    if (!step) throw new Error("Expected milestone.");
    const hash = structuredStepHash(step, graph, projectIds);
    const spaces = planStructuredImport({
      ...original,
      sources: original.sources.map((source) =>
        source.kind === "milestone"
          ? {
              ...source,
              name: ` ${source.name} `,
              description: " ",
              startAt: " ",
              dueAt: " ",
            }
          : source,
      ),
    });
    expect(structuredStepHash(step, spaces, projectIds)).toBe(hash);
    const dates = planStructuredImport({
      ...original,
      sources: original.sources.map((source) =>
        source.kind === "milestone"
          ? { ...source, startAt: "2026-10-11", dueAt: "2026-10-12" }
          : source,
      ),
    });
    expect(structuredStepHash(step, dates, projectIds)).not.toBe(hash);
    for (const entry of graph.steps) {
      expect(structuredStepHash(entry, graph, new Map())).not.toBe(
        structuredStepHash(entry, graph, projectIds),
      );
      if (entry.kind === "dependency") continue;
      const empty = {
        ...graph,
        sources: {
          ...graph.sources,
          tickets: new Map(),
          milestones: new Map(),
        },
      };
      expect(structuredStepHash(entry, empty, projectIds)).not.toBe(
        structuredStepHash(entry, graph, projectIds),
      );
    }
  });

  it("compares every imported ticket field and distinguishes source changes from target changes", async () => {
    const { harness, graph, step, mapping, hash } = await setupTarget("ticket");
    if (step.kind !== "ticket") throw new Error("Expected ticket step.");
    const ticket = await harness.environment.tasks.tasks.getById(
      harness.owner,
      mapping.targetId,
    );
    const input = {
      step,
      graph,
      hash,
      resolved: { parentId: ticket.parentId, milestoneId: ticket.milestoneId },
    };
    const compare = () =>
      compareTicketTarget(harness.environment, mapping, input);
    expect(await compare()).toEqual({
      action: "unchanged",
      reason: null,
      shouldRefresh: false,
    });
    expect(
      await compareTicketTarget(harness.environment, mapping, {
        ...input,
        hash: "new",
      }),
    ).toEqual({ action: "unchanged", reason: null, shouldRefresh: true });
    for (const changed of [
      { type: "initiative" as const },
      { title: "manual" },
      { description: "manual" },
      { parentId: "different" },
      { milestoneId: "different" },
    ]) {
      vi.spyOn(TaskService.prototype, "getById").mockResolvedValueOnce({
        ...ticket,
        ...changed,
      });
      expect(await compare()).toEqual({
        action: "conflict",
        reason: "target_changed",
        shouldRefresh: false,
      });
    }
    vi.spyOn(TaskService.prototype, "getById").mockResolvedValueOnce({
      ...ticket,
      title: "manual",
    });
    expect(
      await compareTicketTarget(harness.environment, mapping, {
        ...input,
        hash: "new",
      }),
    ).toMatchObject({ reason: "source_changed" });
    expect(
      await compareTicketTarget(
        harness.environment,
        { ...mapping, targetKind: "wiki" },
        input,
      ),
    ).toMatchObject({ reason: "target_removed" });
    expect(
      await compareTicketTarget(harness.environment, mapping, {
        ...input,
        graph: { ...graph, sources: { ...graph.sources, tickets: new Map() } },
      }),
    ).toMatchObject({ reason: "target_removed" });
    vi.spyOn(TaskService.prototype, "getById").mockRejectedValueOnce(
      new WorkItemNotFoundError(),
    );
    expect(await compare()).toMatchObject({ reason: "target_removed" });
    const failure = new Error("database unavailable");
    vi.spyOn(TaskService.prototype, "getById").mockRejectedValueOnce(failure);
    await expect(compare()).rejects.toBe(failure);
  });

  it("compares all milestone fields and detects removed or mismatched targets", async () => {
    const { harness, graph, step, mapping, hash } =
      await setupTarget("milestone");
    if (step.kind !== "milestone") throw new Error("Expected milestone step.");
    const stored = await harness.repository.findMilestoneById(mapping.targetId);
    if (!stored) throw new Error("Expected milestone.");
    const input = { step, graph, hash, projectId: "p1" };
    expect(
      await compareMilestoneTarget(harness.environment, mapping, input),
    ).toMatchObject({ action: "unchanged" });
    for (const changed of [
      { name: "manual" },
      { description: "manual" },
      { startAt: "2026-10-11" },
      { dueAt: "2026-10-12" },
    ]) {
      vi.spyOn(TaskService.prototype, "findMilestones").mockResolvedValueOnce([
        { ...stored, ...changed },
      ]);
      expect(
        await compareMilestoneTarget(harness.environment, mapping, input),
      ).toMatchObject({ reason: "target_changed" });
    }
    expect(
      await compareMilestoneTarget(
        harness.environment,
        { ...mapping, targetKind: "ticket" },
        input,
      ),
    ).toMatchObject({ reason: "target_removed" });
    expect(
      await compareMilestoneTarget(harness.environment, mapping, {
        ...input,
        graph: {
          ...graph,
          sources: { ...graph.sources, milestones: new Map() },
        },
      }),
    ).toMatchObject({ reason: "target_removed" });
    vi.spyOn(TaskService.prototype, "findMilestones").mockResolvedValueOnce([]);
    expect(
      await compareMilestoneTarget(harness.environment, mapping, input),
    ).toMatchObject({ reason: "target_removed" });
  });

  it("compares dependency identity and refreshes a converged baseline", async () => {
    const { harness, step, mapping, hash } = await setupTarget("dependency");
    if (step.kind !== "dependency") throw new Error("Expected dependency.");
    const input = { step, hash, projectId: "p1" };
    expect(
      await compareDependencyTarget(harness.environment, mapping, input),
    ).toMatchObject({ action: "unchanged", shouldRefresh: false });
    expect(
      await compareDependencyTarget(harness.environment, mapping, {
        ...input,
        hash: "new",
      }),
    ).toMatchObject({ action: "unchanged", shouldRefresh: true });
    expect(
      await compareDependencyTarget(
        harness.environment,
        { ...mapping, targetKind: "ticket" },
        input,
      ),
    ).toMatchObject({ reason: "target_removed" });
    vi.spyOn(TaskService.prototype, "findDependencies").mockResolvedValueOnce(
      [],
    );
    expect(
      await compareDependencyTarget(harness.environment, mapping, input),
    ).toMatchObject({ reason: "target_removed" });
  });
});
