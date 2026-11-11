import { beforeEach, describe, expect, it, vi } from "vitest";

import { PermissionService } from "@/backend/auth/PermissionService";
import { WikiRepository } from "@/backend/database/repositories/WikiRepository";
import { WikiImportPlanner } from "@/backend/service/agents/WikiImportPlanner";
import { WikiAccess } from "@/backend/service/wiki/WikiAccess";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { AgentImportPlanInput } from "@/definition/AgentImportManifest";
import type { User } from "@/definition/User";

const actor: User = {
  id: "user",
  username: "user",
  displayName: "User",
  role: "employee",
  isActive: true,
  mustChangePassword: false,
};
const boundary: DatabaseTransaction = { execute: vi.fn(), query: vi.fn() };
const repository = new WikiRepository({
  ...boundary,
  transaction: async <Result>(
    work: (transaction: DatabaseTransaction) => Promise<Result>,
  ): Promise<Result> => work(boundary),
});
const access = new WikiAccess(
  { workItemVisibility: vi.fn() },
  new PermissionService(),
);
const planner = new WikiImportPlanner(repository, access);
const scope = {
  userId: actor.id,
  isAdmin: false,
  departmentIds: [],
  projectIds: ["project"],
};
const input: AgentImportPlanInput = {
  projectId: "project",
  parentId: null,
  manifest: {
    version: "1",
    index: [
      { sourceKey: "guide/README.md", title: "Guide", titleSource: "h1" },
      {
        sourceKey: "guide/install.md",
        title: "install",
        titleSource: "filename",
      },
    ],
    files: [
      {
        sourceKey: "guide/README.md",
        content: "# Guide\n![diagram](image.png)",
      },
      { sourceKey: "guide/install.md", content: "Install" },
    ],
  },
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(access, "resolve").mockResolvedValue({
    user: actor,
    scope,
    canWrite: true,
    canManageProjects: false,
  });
  vi.spyOn(repository.pages, "listProjectChildren").mockResolvedValue([]);
});

describe("wiki import planning", () => {
  it("builds a directory hierarchy and scans relative assets without writes", async () => {
    const response = await planner.plan(actor, input);
    expect(response.result).toMatchObject({
      valid: true,
      contentComplete: true,
      errors: [],
      conflicts: [],
      externalEffects: [],
      pages: [
        {
          key: "directory:guide",
          title: "Guide",
          action: "create",
          contentBytes: 29,
        },
        { key: "file:guide/install.md", title: "install", action: "create" },
      ],
      edges: [
        {
          childKey: "directory:guide",
          parent: { kind: "existing", pageId: null },
        },
        {
          childKey: "file:guide/install.md",
          parent: { kind: "planned", key: "directory:guide" },
        },
      ],
      assets: [
        { sourceKey: "guide/README.md", url: "image.png", kind: "image" },
      ],
    });
    expect(boundary.execute).not.toHaveBeenCalled();
    expect(await planner.plan(actor, input)).toEqual(response);
  });

  it("marks a conflicting parent and blocks its child", async () => {
    vi.spyOn(repository.pages, "listProjectChildren").mockResolvedValue([
      { id: "existing", title: "Guide", icon: null },
    ]);
    const response = await planner.plan(actor, input);
    expect(response.result).toMatchObject({
      valid: false,
      conflicts: [{ reason: "title_conflict", existingPageIds: ["existing"] }],
      pages: [{ action: "conflict" }, { action: "blocked" }],
    });
  });

  it("reports invalid paths, missing index entries and mismatched titles", async () => {
    const response = await planner.plan(actor, {
      ...input,
      manifest: {
        version: "1",
        index: [
          { sourceKey: "../bad.md", title: "Wrong", titleSource: "filename" },
        ],
        files: [{ sourceKey: "extra.md", content: "text" }],
      },
    });
    expect(response.result).toMatchObject({
      valid: false,
      errors: expect.arrayContaining([
        expect.objectContaining({
          reason: "invalid_path",
          sourceKeys: ["../bad.md"],
        }),
        expect.objectContaining({
          reason: "missing_index_entry",
          sourceKeys: ["extra.md"],
        }),
        expect.objectContaining({
          reason: "index_mismatch",
          sourceKeys: ["../bad.md"],
        }),
      ]),
      contentComplete: false,
    });
  });

  it("rejects hidden projects and marks all pages invalid without write access", async () => {
    vi.spyOn(access, "resolve").mockResolvedValue({
      user: actor,
      scope,
      canWrite: false,
      canManageProjects: false,
    });
    expect((await planner.plan(actor, input)).result).toMatchObject({
      valid: false,
      errors: [{ reason: "write_permission_required" }],
      pages: [{ action: "invalid" }, { action: "invalid" }],
    });
    await expect(
      planner.plan(actor, { ...input, projectId: "hidden" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
