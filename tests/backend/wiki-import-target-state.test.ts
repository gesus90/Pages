import { rmSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { useMigratedDatabase } from "../helpers/test-database";
import { pageInput } from "../helpers/wiki-harness";
import {
  createWikiImportHarness,
  importPlan,
  importRequest,
} from "../helpers/wiki-import";

import type { WikiVisibilityScope } from "@/definition/Wiki";
import type { WikiImportHarness } from "../helpers/wiki-import";

describe("wiki import previews of current target state", () => {
  const getDatabase = useMigratedDatabase();
  const directories = new Set<string>();

  afterEach(() => {
    for (const directory of directories)
      rmSync(directory, { recursive: true, force: true });
    directories.clear();
  });

  async function setup(): Promise<WikiImportHarness> {
    const harness = await createWikiImportHarness(getDatabase());
    directories.add(harness.filesDirectory);
    return harness;
  }

  it("lists only visible direct project children for roots and existing parents", async () => {
    const { actor, owner, service, repository } = await setup();
    const scope: WikiVisibilityScope = {
      userId: actor.id,
      isAdmin: false,
      departmentIds: ["alpha"],
      projectIds: ["alpha"],
    };
    const root = await service.create(
      owner,
      pageInput({ scope: "project", projectId: "alpha", title: "Root" }),
    );
    const child = await service.create(
      owner,
      pageInput({ parentId: root.id, title: "Child", icon: "📄" }),
    );
    await service.create(owner, pageInput({ title: "Instance" }));
    await service.create(
      owner,
      pageInput({ scope: "private", title: "Private" }),
    );
    await service.create(
      owner,
      pageInput({ scope: "project", projectId: "beta", title: "Foreign" }),
    );
    await service.create(
      owner,
      pageInput({
        scope: "project",
        projectId: "alpha",
        title: "Template",
        isTemplate: true,
      }),
    );
    const hidden = await service.create(
      owner,
      pageInput({
        scope: "project",
        projectId: "alpha",
        title: "Hidden",
        anchors: [{ kind: "department", targetId: "beta" }],
      }),
    );
    await service.create(
      owner,
      pageInput({ parentId: hidden.id, title: "Hidden descendant" }),
    );
    const deleted = await service.create(
      owner,
      pageInput({ scope: "project", projectId: "alpha", title: "Deleted" }),
    );
    await service.delete(owner, deleted.id);

    expect(
      await repository.pages.listProjectChildren(scope, "alpha", null),
    ).toEqual([{ id: root.id, title: "Root", icon: null }]);
    expect(
      await repository.pages.listProjectChildren(scope, "alpha", root.id),
    ).toEqual([{ id: child.id, title: "Child", icon: "📄" }]);
    expect(
      await repository.pages.listProjectChildren(scope, "alpha", hidden.id),
    ).toEqual([]);
    expect(
      await repository.pages.listProjectChildren(scope, "beta", null),
    ).toEqual([]);
  });

  it("changes the fingerprint when an existing ancestor revision changes", async () => {
    const { actor, owner, service, planner, repository } = await setup();
    const ancestor = await service.create(
      owner,
      pageInput({ scope: "project", projectId: "alpha", title: "Ancestor" }),
    );
    const parent = await service.create(
      owner,
      pageInput({ parentId: ancestor.id, title: "Parent" }),
    );
    const input = importRequest(undefined, { parentId: parent.id });
    const before = importPlan(await planner.plan(actor, input));

    await service.update(owner, ancestor.id, {
      title: "Ancestor",
      content: "Changed ancestor content",
      icon: null,
      expectedRevision: ancestor.revision,
    });

    const after = importPlan(await planner.plan(actor, input));
    expect(after.fingerprint).not.toBe(before.fingerprint);
    expect(after.valid).toBe(true);
    expect(after.pages).toEqual(before.pages);
    expect(after.edges).toEqual(before.edges);
    expect(await repository.pages.findNode(parent.id)).toMatchObject({
      revision: parent.revision,
    });
    expect(await repository.pages.findNode(ancestor.id)).toMatchObject({
      revision: ancestor.revision + 1,
    });
    expect(importPlan(await planner.plan(actor, input))).toEqual(after);
  });

  it("ignores hidden sibling changes and refreshes visible conflicts after deletion", async () => {
    const { actor, owner, service, planner } = await setup();
    const input = importRequest();
    const before = importPlan(await planner.plan(actor, input));
    const hidden = await service.create(
      owner,
      pageInput({
        scope: "project",
        projectId: "alpha",
        title: "new",
        anchors: [{ kind: "department", targetId: "beta" }],
      }),
    );
    expect(importPlan(await planner.plan(actor, input))).toEqual(before);
    await service.update(owner, hidden.id, {
      title: "Hidden changed",
      content: "Hidden bytes",
      icon: null,
      expectedRevision: hidden.revision,
    });
    expect(importPlan(await planner.plan(actor, input))).toEqual(before);

    const visible = await service.create(
      owner,
      pageInput({ scope: "project", projectId: "alpha", title: "new" }),
    );
    const conflict = importPlan(await planner.plan(actor, input));
    expect(conflict.fingerprint).not.toBe(before.fingerprint);
    expect(conflict.valid).toBe(false);
    expect(conflict.pages).toMatchObject([{ action: "conflict" }]);
    expect(conflict.conflicts).toEqual([
      {
        code: "CONFLICT",
        reason: "title_conflict",
        sourceKeys: ["new.md"],
        targetKey: "file:new.md",
        existingPageIds: [visible.id],
      },
    ]);

    await service.delete(owner, visible.id);
    expect(importPlan(await planner.plan(actor, input))).toEqual(before);
  });

  it("refreshes write availability in the fingerprint without hiding the preview", async () => {
    const { actor, database, planner } = await setup();
    const input = importRequest();
    const before = importPlan(await planner.plan(actor, input));
    expect(before.valid).toBe(true);

    await database.execute(
      `
        DELETE FROM role_permissions
        WHERE role_id = $role_id;
      `,
      { role_id: `role-${actor.id}` },
    );

    const after = importPlan(await planner.plan(actor, input));
    expect(after.fingerprint).not.toBe(before.fingerprint);
    expect(after.valid).toBe(false);
    expect(after.contentComplete).toBe(true);
    expect(after.pages).toEqual(
      before.pages.map((page) => ({ ...page, action: "invalid" })),
    );
    expect(after.edges).toEqual(before.edges);
    expect(after.conflicts).toEqual([]);
    expect(after.errors).toEqual([
      {
        code: "FORBIDDEN",
        reason: "write_permission_required",
        sourceKeys: [],
      },
    ]);
    expect(importPlan(await planner.plan(actor, input))).toEqual(after);
  });
});
