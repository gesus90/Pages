import { describe, expect, it, vi } from "vitest";

import * as stepPreview from "@/backend/service/agents/StructuredImportStepPreview";
import * as wikiPreview from "@/backend/service/agents/StructuredImportWikiPreview";
import * as decision from "@/backend/service/agents/StructuredImportDecision";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { WikiImportPlanner } from "@/backend/service/agents/WikiImportPlanner";
import { planStructuredImport } from "@/backend/service/agents/StructuredImportPlanner";
import { previewStructuredImport } from "@/backend/service/agents/StructuredImportPreview";
import {
  firstIssueByKey,
  previewSteps,
} from "@/backend/service/agents/StructuredImportStepPreview";

import {
  applyStructured,
  stageStructuredAsset,
  structuredManifest,
  useStructuredImportHarness,
} from "../helpers/structured-import";

const setup = useStructuredImportHarness();

describe("structured preview policy and assets", () => {
  it("rejects hidden projects and reports missing wiki projects without leaking a target", async () => {
    const harness = await setup();
    await expect(
      previewStructuredImport(harness.environment, {
        manifest: structuredManifest({
          sources: [{ kind: "project", key: "p", projectId: "missing" }],
          wiki: null,
          links: [],
        }),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const preview = await previewStructuredImport(harness.environment, {
      manifest: structuredManifest({
        wiki: { project: "unknown", parentId: null },
      }),
    });
    expect(preview.wiki).toBeNull();
    expect(preview.plan.errors).toContainEqual({
      code: "INVALID_REQUEST",
      reason: "unknown_project",
      keys: ["wiki"],
    });
  });

  it("reports persisted ticket and project management rights and GitHub settings", async () => {
    const harness = await setup();
    for (const syncEnabled of [false, true]) {
      vi.spyOn(
        ProjectRepository.prototype,
        "findIntegration",
      ).mockResolvedValue({
        projectId: "p1",
        repoUrl: "https://github.invalid/example/repo",
        hasToken: false,
        syncIssues: true,
        syncStatus: true,
        syncComments: true,
        syncPullRequests: false,
        syncCommits: false,
        syncDirection: "push",
        syncIntervalMinutes: 15,
        isConnected: false,
        repoName: null,
        lastSyncAt: null,
        nextSyncAt: null,
        updatedAt: "2026-10-11",
        syncEnabled,
      });
      const preview = await previewStructuredImport(harness.environment, {
        manifest: structuredManifest(),
      });
      expect(preview.plan.externalEffects).toEqual([
        {
          kind: "github_publication",
          project: "project",
          projectId: "p1",
          tickets: 2,
          syncEnabled,
        },
      ]);
    }
    await harness.database.execute(
      "UPDATE user_authorization SET is_admin = 0 WHERE user_id = 'owner';",
    );
    await harness.database.execute(
      "DELETE FROM role_permissions WHERE role_id = 'role-owner';",
    );
    const preview = await previewStructuredImport(harness.environment, {
      manifest: structuredManifest(),
    });
    expect(preview.plan.projects).toEqual([
      {
        key: "project",
        projectId: "p1",
        canWriteTickets: false,
        canManageMilestones: false,
      },
    ]);
    expect(
      preview.plan.errors.filter(
        (issue) => issue.reason === "write_permission_required",
      ),
    ).toHaveLength(6);
  });

  it("checks ownership, expiry, linked page identity and unused assets", async () => {
    const harness = await setup();
    await stageStructuredAsset(harness);
    const manifest = structuredManifest({
      assets: [{ path: "image.png", assetId: "asset" }],
    });
    expect(
      (await previewStructuredImport(harness.environment, { manifest })).plan
        .assets,
    ).toEqual([
      { path: "image.png", assetId: "asset", state: "staged", usedBy: [] },
    ]);
    for (const statement of [
      "UPDATE agent_assets SET expires_at = 0 WHERE id = 'asset';",
      "UPDATE agent_assets SET user_id = 'writer' WHERE id = 'asset';",
      "UPDATE agent_assets SET user_id = 'owner', status = 'linked', page_id = NULL WHERE id = 'asset';",
      "UPDATE agent_assets SET page_id = 'wrong' WHERE id = 'asset';",
    ]) {
      await harness.database.execute(statement);
      expect(
        (await previewStructuredImport(harness.environment, { manifest })).plan
          .assets[0]?.state,
      ).toBe("unavailable");
    }
  });

  it("refuses an unexpected wiki planner envelope instead of fabricating a plan", async () => {
    const harness = await setup();
    vi.spyOn(WikiImportPlanner.prototype, "plan").mockResolvedValueOnce({
      apiVersion: "1",
      result: { id: "p1", name: "P" },
    });
    await expect(
      previewStructuredImport(harness.environment, {
        manifest: structuredManifest(),
      }),
    ).rejects.toThrow("Import plan unavailable.");
    const incomplete = {
      id: "p1",
      name: "Project",
      fingerprint: "f".repeat(64),
    };
    vi.spyOn(WikiImportPlanner.prototype, "plan").mockResolvedValueOnce({
      apiVersion: "1",
      result: incomplete,
    });
    await expect(
      previewStructuredImport(harness.environment, {
        manifest: structuredManifest(),
      }),
    ).rejects.toThrow("Import plan unavailable.");
  });
});

describe("structured step preview", () => {
  it("retains the first diagnostic per key and blocks children without a usable target", async () => {
    const issues = [
      {
        code: "INVALID_REQUEST" as const,
        reason: "invalid_field" as const,
        keys: ["ticket:parent"],
      },
      {
        code: "FORBIDDEN" as const,
        reason: "write_permission_required" as const,
        keys: ["ticket:parent"],
      },
    ];
    expect(firstIssueByKey(issues).get("ticket:parent")).toBe(issues[0]);
    const harness = await setup();
    const graph = planStructuredImport(structuredManifest());
    const result = await previewSteps(harness.environment, {
      graph,
      projectIds: new Map([["project", "p1"]]),
      errors: issues,
    });
    expect(
      result.objects.find((entry) => entry.key === "ticket:child"),
    ).toMatchObject({ action: "blocked" });
    const missingProject = await previewSteps(harness.environment, {
      graph,
      projectIds: new Map(),
      errors: [],
    });
    expect(
      missingProject.objects.every(
        (entry) => entry.action === "invalid" && entry.reason === null,
      ),
    ).toBe(true);
    const childFirst = { ...graph, steps: [...graph.steps].reverse() };
    expect(
      (
        await previewSteps(harness.environment, {
          graph: childFirst,
          projectIds: new Map([["project", "p1"]]),
          errors: [],
        })
      ).objects.some((entry) => entry.action === "blocked"),
    ).toBe(true);
  });

  it("resolves mapped parents and milestones, keeps conflicts usable and blocks removed targets", async () => {
    const harness = await setup();
    await applyStructured(harness);
    const manifest = structuredManifest();
    const changed = {
      ...manifest,
      sources: manifest.sources.map((source) =>
        source.kind === "ticket" && source.key === "parent"
          ? { ...source, title: "Changed" }
          : source,
      ),
    };
    expect(
      (
        await previewStructuredImport(harness.environment, {
          manifest: changed,
        })
      ).plan.objects.find((entry) => entry.key === "ticket:child"),
    ).toMatchObject({ action: "unchanged" });
    await harness.database.execute(
      "UPDATE agent_import_sources SET target_id = 'missing' WHERE source_key = 'milestone:release';",
    );
    await harness.database.execute(
      "DELETE FROM agent_import_sources WHERE source_key = 'ticket:parent';",
    );
    const preview = await previewStructuredImport(harness.environment, {
      manifest,
    });
    expect(
      preview.plan.objects.find((entry) => entry.key === "ticket:parent"),
    ).toMatchObject({ action: "blocked" });
    expect(
      preview.plan.objects.find((entry) => entry.key === "milestone:release"),
    ).toMatchObject({ targetId: null, reason: "target_removed" });
  });
});

it("handles contributor objects without a project reference or a matching wiki source", async () => {
  const harness = await setup();
  const empty = stepPreview.emptyContribution();
  vi.spyOn(stepPreview, "previewSteps").mockResolvedValueOnce({
    ...empty,
    objects: [
      {
        kind: "ticket",
        key: "ticket:unknown",
        sourceKey: "ticket:unknown",
        label: "Unknown",
        project: "unknown",
        action: "create",
        reason: null,
        targetId: null,
      },
      {
        kind: "ticket",
        key: "ticket:unbound",
        sourceKey: "ticket:unbound",
        label: "Unbound",
        project: null,
        action: "create",
        reason: null,
        targetId: null,
      },
    ],
  });
  vi.spyOn(wikiPreview, "previewWiki").mockResolvedValueOnce({
    ...empty,
    objects: [
      {
        kind: "wiki",
        key: "unmatched",
        sourceKey: "unmatched",
        label: "Unmatched",
        project: "project",
        action: "create",
        reason: null,
        targetId: null,
      },
    ],
  });
  const result = await previewStructuredImport(harness.environment, {
    manifest: structuredManifest(),
  });
  expect(result.plan.externalEffects).toEqual([]);
  expect(result.plan.objects).toEqual(
    expect.arrayContaining([expect.objectContaining({ key: "unmatched" })]),
  );
});

it("reports asset edges for a wiki source rejected by the wiki path rules", async () => {
  const harness = await setup();
  await stageStructuredAsset(harness);
  const manifest = structuredManifest({
    sources: [
      { kind: "project", key: "project", projectId: "p1" },
      { kind: "wiki", key: "invalid:a.md", content: "![image](image.png)" },
    ],
    links: [],
    assets: [{ path: "image.png", assetId: "asset" }],
  });
  const result = await previewStructuredImport(harness.environment, {
    manifest,
  });
  expect(result.plan.errors).toContainEqual(
    expect.objectContaining({ reason: "invalid_path" }),
  );
  expect(result.plan.edges).toContainEqual({
    type: "asset",
    from: "invalid:a.md",
    to: "asset:asset",
  });
});

it("defaults an unspecified contributor conflict reason and resolves absent preceding targets", async () => {
  const harness = await setup();
  await applyStructured(harness);
  const graph = planStructuredImport(structuredManifest());
  vi.spyOn(decision, "compareTicketTarget").mockResolvedValueOnce({
    action: "conflict",
    reason: null,
    shouldRefresh: false,
  });
  const result = await previewSteps(harness.environment, {
    graph: { ...graph, steps: [...graph.steps].reverse() },
    projectIds: new Map([["project", "p1"]]),
    errors: [],
  });
  expect(result.conflicts).toContainEqual({
    code: "CONFLICT",
    reason: "source_changed",
    keys: ["ticket:child"],
  });
});
