import { createHash } from "node:crypto";
import { buffer } from "node:stream/consumers";

import { describe, expect, it, vi } from "vitest";

import { AgentImportRepository } from "@/backend/database/repositories/agents/AgentImportRepository";
import { AgentOperationKeyRepository } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import { WorkItemNotFoundError } from "@/backend/error/WorkItemErrors";
import { WikiPageNotFoundError } from "@/backend/error/WikiErrors";
import { AgentAssetService } from "@/backend/service/agents/AgentAssetService";
import { WikiPageReader } from "@/backend/service/wiki/WikiPageReader";
import * as structuredPreview from "@/backend/service/agents/StructuredImportPreview";

import { planningIdentity } from "../helpers/agent-planning";
import { pageInput } from "../helpers/wiki-harness";
import {
  applyStructured,
  confirmedStructuredImport,
  stageStructuredAsset,
  structuredManifest,
  structuredResult,
  useStructuredImportHarness,
} from "../helpers/structured-import";

import type { StructuredHarness } from "../helpers/structured-import";
import type {
  AgentStructuredImportApplied,
  AgentStructuredManifest,
} from "@/definition/AgentStructuredImportManifest";

const verify = async () => planningIdentity;
const setup = useStructuredImportHarness();

async function counts(harness: StructuredHarness): Promise<unknown[]> {
  const totals: unknown[] = [];
  for (const table of [
    "projects",
    "milestones",
    "work_items",
    "milestone_dependencies",
    "wiki_pages",
    "wiki_recent_pages",
    "wiki_attachments",
    "agent_assets",
    "agent_import_sources",
    "work_item_history",
    "project_activity",
  ])
    totals.push(await harness.database.query(`SELECT COUNT(*) FROM ${table};`));
  return totals;
}

function changedManifest(): AgentStructuredManifest {
  const manifest = structuredManifest();
  return {
    ...manifest,
    sources: manifest.sources.map((source) =>
      source.kind === "ticket" && source.key === "parent"
        ? { ...source, title: "Changed" }
        : source,
    ),
  };
}

async function verifyImportedTargets(
  harness: StructuredHarness,
  outcome: AgentStructuredImportApplied,
): Promise<void> {
  const parent = outcome.items.find(
    (item) => item.sourceKey === "ticket:parent",
  );
  const milestone = outcome.items.find(
    (item) => item.sourceKey === "milestone:release",
  );
  expect(
    outcome.items.find((item) => item.sourceKey === "ticket:child"),
  ).toMatchObject({ parentId: parent?.targetId });
  expect(parent).toMatchObject({
    milestoneId: milestone?.targetId,
    key: "PAGE-1",
  });
  const page = outcome.items.find(
    (item) => item.sourceKey === "guide/start.md",
  );
  if (!page?.targetId) throw new Error("Expected imported page.");
  const view = await harness.service.read(harness.owner, page.targetId);
  if (view.kind !== "page") throw new Error("Expected page view.");
  expect(view.view.page.content).toContain("/agent-assets/asset#top");
  expect(page.assets).toEqual([expect.objectContaining({ assetId: "asset" })]);

  const assets = new AgentAssetService({
    repository: harness.environment.assets,
    files: harness.creation.staging,
    wiki: harness.service,
  });
  const opened = await assets.open(harness.reader, "asset");
  const downloaded = await buffer(opened.stream);
  expect(opened.contentType).toBe("image/png");
  expect(createHash("sha256").update(downloaded).digest("hex")).toBe(
    (await harness.environment.assets.find("asset"))?.checksum,
  );
  const foreign = await harness.addUser("foreign", { departments: ["beta"] });
  await expect(assets.open(foreign, "asset")).rejects.toBeInstanceOf(
    WikiPageNotFoundError,
  );
}

describe("structured import durable application", () => {
  it("previews without writes, imports real objects and PNG, then repeats and replays without new objects or events", async () => {
    const harness = await setup();
    await stageStructuredAsset(harness);
    const original = structuredManifest();
    const manifest = {
      ...original,
      sources: original.sources.map((source) =>
        source.kind === "wiki"
          ? { ...source, content: "# Guide\n\n![image](../image.png#top)" }
          : source,
      ),
      assets: [{ path: "image.png", assetId: "asset" }],
    };
    const before = await counts(harness);
    const writes = vi.spyOn(harness.database, "execute");
    const input = await confirmedStructuredImport(harness, manifest);
    expect(writes).not.toHaveBeenCalled();
    writes.mockRestore();
    expect(await counts(harness)).toEqual(before);
    expect(harness.listener).not.toHaveBeenCalled();
    const first = structuredResult(
      await harness.structured.apply(planningIdentity, input, verify),
    );
    expect(first.status).toBe("complete");
    expect(first.counts).toEqual({
      created: 7,
      skipped: 0,
      conflict: 0,
      failed: 0,
    });
    await verifyImportedTargets(harness, first);
    expect(
      await harness.database.query(
        "SELECT source, COUNT(*) FROM project_activity WHERE category = 'wiki' GROUP BY source;",
      ),
    ).toEqual([["mcp", 2]]);
    const preview = await harness.structured.plan(planningIdentity, {
      manifest,
    });
    expect(preview.result).toMatchObject({
      valid: true,
      conflicts: [],
      assets: [{ state: "linked" }],
      externalEffects: [],
    });
    const storedCounts = await counts(harness);
    harness.listener.mockClear();
    harness.publish.mockClear();
    const second = await applyStructured(harness, manifest, "second");
    expect(second.counts).toEqual({
      created: 0,
      skipped: 7,
      conflict: 0,
      failed: 0,
    });
    expect(await counts(harness)).toEqual(storedCounts);
    expect(harness.listener).not.toHaveBeenCalled();
    expect(harness.publish).not.toHaveBeenCalled();
    expect(
      structuredResult(
        await harness.structured.apply(
          planningIdentity,
          {
            ...input,
            manifest: {
              ...manifest,
              sources: [...manifest.sources].reverse(),
              links: [...manifest.links].reverse(),
            },
          },
          verify,
        ),
      ),
    ).toEqual(first);
  });

  it("keeps changed sources and targets untouched while resolving children through the current run", async () => {
    const harness = await setup();
    const first = await applyStructured(harness);
    const before = await counts(harness);
    const changed = changedManifest();
    const preview = await harness.structured.plan(planningIdentity, {
      manifest: changed,
    });
    expect(preview.result.conflicts).toContainEqual({
      code: "CONFLICT",
      reason: "source_changed",
      keys: ["ticket:parent"],
    });
    const repeat = await applyStructured(harness, changed, "changed");
    expect(repeat.status).toBe("partial");
    expect(
      repeat.items.find((item) => item.sourceKey === "ticket:parent"),
    ).toMatchObject({ action: "conflict", reason: "source_changed" });
    expect(await counts(harness)).toEqual(before);
    const target = first.items.find(
      (item) => item.sourceKey === "ticket:parent",
    )?.targetId;
    if (!target) throw new Error("Expected parent.");
    await harness.database.execute(
      "UPDATE work_items SET title = 'Changed' WHERE id = $id;",
      { id: target },
    );
    expect(
      (await applyStructured(harness, changed, "converged")).counts.conflict,
    ).toBe(0);
    await harness.database.execute(
      "UPDATE work_items SET description = 'Manual' WHERE id = $id;",
      { id: target },
    );
    expect(
      (await applyStructured(harness, changed, "manual")).items.find(
        (item) => item.targetId === target,
      ),
    ).toMatchObject({ reason: "target_changed" });
  });

  it("recovers an interrupted run exactly once and rejects reuse with other input or operation", async () => {
    const harness = await setup();
    const input = await confirmedStructuredImport(harness);
    const failure = new Error("interrupted after first source");
    const interrupted = vi
      .fn()
      .mockResolvedValueOnce(planningIdentity)
      .mockRejectedValueOnce(failure);
    await expect(
      harness.structured.apply(planningIdentity, input, interrupted),
    ).rejects.toBe(failure);
    expect(
      await harness.database.query("SELECT COUNT(*) FROM milestones;"),
    ).toEqual([[1]]);
    const recovered = structuredResult(
      await harness.structured.apply(planningIdentity, input, verify),
    );
    expect(recovered.counts.created).toBe(7);
    expect(
      await harness.database.query("SELECT COUNT(*) FROM milestones;"),
    ).toEqual([[2]]);
    await expect(
      harness.structured.apply(
        planningIdentity,
        { ...input, fingerprint: "b".repeat(64) },
        verify,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await harness.database.execute(
      "UPDATE agent_operation_keys SET operation = 'other' WHERE operation_id = $id;",
      { id: input.operationId },
    );
    await expect(
      harness.structured.apply(planningIdentity, input, verify),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("refuses invalid, forbidden, unavailable-asset and stale plans without starting a run", async () => {
    const harness = await setup();
    for (const [manifest, code] of [
      [
        structuredManifest({
          links: [{ type: "parent", from: "missing", to: "parent" }],
        }),
        "INVALID_REQUEST",
      ],
      [
        structuredManifest({
          assets: [{ path: "unused.png", assetId: "missing" }],
        }),
        "NOT_FOUND",
      ],
    ] as const) {
      const input = await confirmedStructuredImport(harness, manifest);
      await expect(
        harness.structured.apply(planningIdentity, input, verify),
      ).rejects.toMatchObject({ code });
    }
    const input = await confirmedStructuredImport(harness);
    await expect(
      harness.structured.apply(
        planningIdentity,
        { ...input, fingerprint: "0".repeat(64) },
        verify,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await harness.database.execute(
      "UPDATE user_authorization SET is_admin = 0 WHERE user_id = 'owner';",
    );
    await expect(
      harness.structured.apply(planningIdentity, input, verify),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(
      await harness.database.query("SELECT id FROM agent_import_runs;"),
    ).toEqual([]);
  });

  it("allows empty manifests, a project reference only and explicit wiki parents", async () => {
    const harness = await setup();
    for (const sources of [
      [],
      [{ kind: "project", key: "project", projectId: "p1" }],
    ] as const)
      expect(
        (
          await applyStructured(
            harness,
            structuredManifest({ sources, wiki: null, links: [] }),
            `empty-${sources.length}`,
          )
        ).counts.created,
      ).toBe(0);
    const parent = await harness.service.create(
      harness.owner,
      pageInput({ scope: "project", projectId: "p1", title: "Existing" }),
    );
    const outcome = await applyStructured(
      harness,
      structuredManifest({ wiki: { project: "project", parentId: parent.id } }),
      "under-parent",
    );
    const directory = outcome.items.find(
      (item) => item.sourceKey === "directory:guide",
    )?.targetId;
    if (!directory) throw new Error("Expected directory.");
    const view = await harness.service.read(harness.owner, directory);
    if (view.kind !== "page") throw new Error("Expected page view.");
    expect(view.view.page.parentId).toBe(parent.id);
  });

  it.each(["missing", "inactive", "password"])(
    "rejects a %s persisted account",
    async (state) => {
      const harness = await setup();
      if (state === "inactive")
        await harness.database.execute(
          "UPDATE users SET is_active = 0 WHERE id = 'owner';",
        );
      if (state === "password")
        await harness.database.execute(
          "UPDATE users SET must_change_password = 1 WHERE id = 'owner';",
        );
      await expect(
        harness.structured.plan(
          {
            ...planningIdentity,
            userId: state === "missing" ? "missing" : "owner",
          },
          { manifest: structuredManifest() },
        ),
      ).rejects.toMatchObject({ status: 401 });
    },
  );

  it("rechecks the finishing identity and visibility on every replay", async () => {
    const harness = await setup();
    const input = await confirmedStructuredImport(harness);
    await harness.structured.apply(planningIdentity, input, verify);
    await expect(
      harness.structured.apply(planningIdentity, input, async () => ({
        ...planningIdentity,
        userId: "other",
      })),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    vi.spyOn(WikiPageReader.prototype, "require").mockRejectedValueOnce(
      new Error("reader unavailable"),
    );
    await expect(
      harness.structured.apply(planningIdentity, input, verify),
    ).rejects.toThrow("reader unavailable");
    await harness.database.execute(
      "UPDATE wiki_pages SET deleted_at = '2026-10-11', deleted_root_id = id;",
    );
    await expect(
      harness.structured.apply(planningIdentity, input, verify),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it.each([
    new WorkItemNotFoundError(),
    new McpAuthorizationError("invalid_token", 401),
    new McpAuthorizationError("unavailable", 503),
    new Error("unexpected"),
  ])("translates only business failures: %s", async (failure) => {
    const harness = await setup();
    vi.spyOn(
      AgentOperationKeyRepository.prototype,
      "find",
    ).mockRejectedValueOnce(failure);
    const input = await confirmedStructuredImport(harness);
    const call = harness.structured.apply(planningIdentity, input, verify);
    if (failure instanceof WorkItemNotFoundError)
      await expect(call).rejects.toMatchObject({ code: "NOT_FOUND" });
    else await expect(call).rejects.toBe(failure);
  });

  it("does not fabricate a missing persisted run and bounds both response envelopes", async () => {
    const harness = await setup();
    const input = await confirmedStructuredImport(harness);
    await harness.structured.apply(planningIdentity, input, verify);
    vi.spyOn(AgentImportRepository.prototype, "findRun").mockResolvedValueOnce(
      null,
    );
    await expect(
      harness.structured.apply(planningIdentity, input, verify),
    ).rejects.toThrow("Import run unavailable.");
    const preview = await structuredPreview.previewStructuredImport(
      harness.environment,
      input,
    );
    const oversized = "x".repeat(1048577);
    const previewSpy = vi
      .spyOn(structuredPreview, "previewStructuredImport")
      .mockResolvedValueOnce({
        ...preview,
        plan: {
          ...preview.plan,
          objects: preview.plan.objects.map((entry) => ({
            ...entry,
            label: oversized,
          })),
        },
      });
    await expect(
      harness.structured.plan(planningIdentity, { manifest: input.manifest }),
    ).rejects.toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
      details: { constraint: "responseBytes", limit: 1048576 },
    });
    previewSpy.mockRestore();
    const replay = structuredResult(
      await harness.structured.apply(planningIdentity, input, verify),
    );
    const items = await harness.environment.imports.listStoredItems(
      replay.runId,
    );
    vi.spyOn(
      AgentImportRepository.prototype,
      "listStoredItems",
    ).mockResolvedValueOnce(
      items.map((entry) => ({ ...entry, link: oversized })),
    );
    await expect(
      harness.structured.apply(planningIdentity, input, verify),
    ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
  });
});

it("does not create wiki pages from a persisted snapshot when the accepted manifest contains no wiki source", async () => {
  const harness = await setup();
  const first = await applyStructured(harness);
  const stored = await harness.environment.imports.findRun(
    first.runId,
    "owner",
    "p1",
  );
  if (!stored) throw new Error("Expected run snapshot.");
  const original = structuredManifest();
  const manifest = {
    ...original,
    sources: original.sources.filter((source) => source.kind !== "wiki"),
    wiki: null,
  };
  const input = await confirmedStructuredImport(
    harness,
    manifest,
    "without-wiki",
  );
  const completed = structuredResult(
    await harness.structured.apply(planningIdentity, input, verify),
  );
  vi.spyOn(AgentImportRepository.prototype, "findRun").mockResolvedValueOnce({
    ...stored,
    id: completed.runId,
    status: "running",
  });
  expect(
    structuredResult(
      await harness.structured.apply(planningIdentity, input, verify),
    ),
  ).toEqual(completed);
  expect(
    await harness.database.query("SELECT COUNT(*) FROM wiki_pages;"),
  ).toEqual([[2]]);
});

it("does not expose replayed wiki identifiers after their project or scope changes", async () => {
  const harness = await setup();
  const input = await confirmedStructuredImport(harness);
  const completed = structuredResult(
    await harness.structured.apply(planningIdentity, input, verify),
  );
  const id = completed.items.find((item) => item.kind === "wiki")?.targetId;
  if (!id) throw new Error("Expected page identifier.");
  const page = await new WikiPageReader(harness.environment.wiki).require(
    harness.environment.viewer.scope,
    id,
  );
  for (const changed of [{ projectId: "p2" }, { scope: "instance" as const }]) {
    vi.spyOn(WikiPageReader.prototype, "require").mockResolvedValueOnce({
      ...page,
      ...changed,
    });
    await expect(
      harness.structured.apply(planningIdentity, input, verify),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  }
});
