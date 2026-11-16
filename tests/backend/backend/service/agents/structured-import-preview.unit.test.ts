import { expect, it, vi } from "vitest";

import { previewStructuredImport } from "@/backend/service/agents/StructuredImportPreview";

import { partial } from "../../../app/lib/service-wiring-fakes";
import {
  manifestOf,
  milestoneSource,
  projectSource,
  ticketSource,
} from "../agents-import/structured-manifest-fixture";

import type { StructuredImportEnvironment } from "@/backend/service/agents/StructuredImportEnvironment";

function environment(
  options: { visible?: boolean; write?: boolean; manage?: boolean } = {},
): StructuredImportEnvironment {
  return partial<StructuredImportEnvironment>({
    actor: { id: "actor" },
    viewer: {
      scope: { projectIds: options.visible === false ? [] : ["project-1"] },
    },
    tasks: {
      projects: {
        canWriteProject: vi.fn(async () => options.manage !== false),
      },
      permissions: {
        hasCapability: vi.fn(async () => options.write !== false),
      },
    },
    imports: { findSource: vi.fn(async () => null) },
    projects: { findIntegration: vi.fn(async () => ({ syncEnabled: true })) },
    assets: {
      find: vi.fn(async (id: string) =>
        id === "ready"
          ? {
              userId: "actor",
              status: "staged",
              expiresAt: Date.now() + 60_000,
            }
          : null,
      ),
    },
  });
}

it("previews creation and publication effects without writing", async () => {
  const manifest = manifestOf([
    projectSource(),
    ticketSource("one"),
    ticketSource("two"),
    milestoneSource("m"),
  ]);
  const result = await previewStructuredImport(environment(), { manifest });
  expect(result.plan.valid).toBe(true);
  expect(result.plan.objects.map(({ key, action }) => [key, action])).toEqual([
    ["project:main", "reference"],
    ["milestone:m", "create"],
    ["ticket:one", "create"],
    ["ticket:two", "create"],
  ]);
  expect(result.plan.externalEffects).toEqual([
    {
      kind: "github_publication",
      project: "main",
      projectId: "project-1",
      syncEnabled: true,
      tickets: 2,
    },
  ]);
  expect(result.plan.fingerprint).toHaveLength(64);
  expect(
    (await previewStructuredImport(environment(), { manifest })).plan
      .fingerprint,
  ).toBe(result.plan.fingerprint);
});

it("refuses hidden projects and flags missing write permissions", async () => {
  const manifest = manifestOf([
    projectSource(),
    ticketSource("one"),
    milestoneSource("m"),
  ]);
  await expect(
    previewStructuredImport(environment({ visible: false }), { manifest }),
  ).rejects.toThrow();
  const result = await previewStructuredImport(
    environment({ write: false, manage: false }),
    { manifest },
  );
  expect(result.plan.valid).toBe(false);
  expect(result.plan.errors).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: "FORBIDDEN", keys: ["ticket:one"] }),
      expect.objectContaining({ code: "FORBIDDEN", keys: ["milestone:m"] }),
    ]),
  );
  expect(result.plan.externalEffects).toEqual([]);
});

it("checks asset ownership and availability in the plan", async () => {
  const manifest = manifestOf([projectSource()], {
    assets: [
      { path: "a.png", assetId: "ready" },
      { path: "b.png", assetId: "missing" },
    ],
  });
  const result = await previewStructuredImport(environment(), { manifest });
  expect(result.plan.assets).toMatchObject([
    { assetId: "ready", state: "staged" },
    { assetId: "missing", state: "unavailable" },
  ]);
  expect(result.plan.errors).toContainEqual({
    code: "NOT_FOUND",
    reason: "asset_unavailable",
    keys: ["asset:missing"],
  });
});
