import { expect, it, vi } from "vitest";

import { AgentOperationKeyRepository } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";

import { pageInput } from "../helpers/wiki-harness";
import { IMPORT_IDENTITY } from "../helpers/wiki-import-apply";
import {
  persistedPage,
  useWikiFieldHarness,
  wikiFieldState,
} from "../helpers/wiki-fields";

const setup = useWikiFieldHarness();

it("reorders roots and reports an unchanged location without an event or text revision", async () => {
  const harness = await setup();
  const sibling = await harness.service.create(
    harness.actor,
    pageInput({ title: "Sibling", scope: "project", projectId: "alpha" }),
  );
  const versions = await harness.repository.versions.list(harness.page.id);
  const events = vi.fn();
  harness.dependencies.events.subscribe(events);
  const input = {
    operationId: "append",
    pageId: harness.page.id,
    expectedRevision: 1,
    projectId: "alpha",
    parentId: null,
    beforeId: null,
  };
  expect(
    await harness.fields.apply(IMPORT_IDENTITY, "wiki.page.move", input),
  ).toMatchObject({
    result: {
      field: "location",
      revision: 1,
      changed: true,
      parentId: null,
      projectId: "alpha",
      visibility: "same",
    },
  });
  expect(
    await harness.repository.writes.findSiblingIds(
      { scope: "project", projectId: "alpha", parentId: null },
      "writer",
    ),
  ).toEqual([sibling.id, harness.page.id]);
  expect(
    await harness.fields.apply(IMPORT_IDENTITY, "wiki.page.move", {
      ...input,
      operationId: "unchanged",
    }),
  ).toMatchObject({ result: { changed: false, revision: 1 } });
  expect(events).toHaveBeenCalledExactlyOnceWith({
    type: "wiki.page.updated",
    id: harness.page.id,
  });
  expect(await harness.repository.versions.list(harness.page.id)).toEqual(
    versions,
  );
});

it("transfers the subtree to a project and moves below an explicit parent without text revisions", async () => {
  const harness = await setup();
  await harness.addProject("gamma", ["alpha"]);
  const child = await harness.service.create(
    harness.actor,
    pageInput({ title: "Child", parentId: harness.page.id }),
  );
  const parent = await harness.service.create(
    harness.actor,
    pageInput({ title: "Parent", scope: "project", projectId: "gamma" }),
  );
  await harness.addMilestone("milestone", "alpha");
  await harness.service.setAnchors(harness.actor, child.id, [
    { kind: "milestone", targetId: "milestone" },
  ]);
  const before = await persistedPage(harness.database, harness.page.id);
  const versions = await harness.database.query(
    "SELECT TO_JSON(wiki_page_versions) FROM wiki_page_versions ORDER BY 1;",
  );
  const events = vi.fn();
  harness.dependencies.events.subscribe(events);
  const input = {
    operationId: "append",
    pageId: harness.page.id,
    expectedRevision: 1,
    projectId: "alpha",
    parentId: null,
    beforeId: null,
  };
  const transferred = await harness.fields.apply(
    IMPORT_IDENTITY,
    "wiki.page.move",
    { ...input, operationId: "transfer", projectId: "gamma" },
  );
  expect(transferred).toMatchObject({
    result: {
      changed: true,
      projectId: "gamma",
      visibility: "different",
      revision: 1,
    },
  });
  expect(await harness.repository.pages.findNode(child.id)).toMatchObject({
    parentId: harness.page.id,
    projectId: "gamma",
    revision: 1,
  });
  expect(await harness.repository.anchors.findAnchors(child.id)).toEqual([]);
  const destination = {
    ...input,
    operationId: "parent",
    projectId: "gamma",
    parentId: `/wiki/${parent.id}`,
    beforeId: null,
  };
  const response = await harness.fields.apply(
    IMPORT_IDENTITY,
    "wiki.page.move",
    destination,
  );
  expect(response).toMatchObject({
    result: {
      changed: true,
      parentId: parent.id,
      projectId: "gamma",
      visibility: "same",
    },
  });
  expect(await persistedPage(harness.database, harness.page.id)).toEqual({
    ...before,
    parent_id: parent.id,
    project_id: "gamma",
    position: 1,
    updated_at: expect.any(String),
  });
  const state = await wikiFieldState(harness.database, {
    includeOperationKeys: true,
  });
  expect(
    await harness.fields.apply(IMPORT_IDENTITY, "wiki.page.move", destination),
  ).toEqual(response);
  expect(
    await wikiFieldState(harness.database, { includeOperationKeys: true }),
  ).toEqual(state);
  expect(
    await harness.fields.apply(IMPORT_IDENTITY, "wiki.page.move", {
      ...destination,
      operationId: "unchanged",
    }),
  ).toMatchObject({ result: { changed: false, revision: 1 } });
  expect(events).toHaveBeenCalledTimes(2);
  expect(
    await harness.database.query(
      "SELECT TO_JSON(wiki_page_versions) FROM wiki_page_versions ORDER BY 1;",
    ),
  ).toEqual(versions);
});

it("resolves sibling addresses, reports inherited visibility changes and rolls a moved subtree back on key failure", async () => {
  const harness = await setup();
  const parent = await harness.service.create(
    harness.actor,
    pageInput({
      title: "Parent",
      scope: "project",
      projectId: "alpha",
      anchors: [{ kind: "department", targetId: "alpha" }],
    }),
  );
  const sibling = await harness.service.create(
    harness.actor,
    pageInput({ title: "Sibling", parentId: parent.id }),
  );
  await harness.service.create(
    harness.actor,
    pageInput({ title: "Child", parentId: harness.page.id }),
  );
  const before = await wikiFieldState(harness.database, {
    includeOperationKeys: true,
  });
  const input = {
    operationId: "move",
    pageId: harness.page.id,
    expectedRevision: 1,
    projectId: "alpha",
    parentId: parent.id,
    beforeId: `https://pages.invalid/wiki/${sibling.id}#top`,
  };
  const events = vi.fn();
  harness.dependencies.events.subscribe(events);
  const failure = new Error("Operation storage unavailable");
  vi.spyOn(
    AgentOperationKeyRepository.prototype,
    "insert",
  ).mockRejectedValueOnce(failure);
  await expect(
    harness.fields.apply(IMPORT_IDENTITY, "wiki.page.move", input),
  ).rejects.toBe(failure);
  expect(
    await wikiFieldState(harness.database, { includeOperationKeys: true }),
  ).toEqual(before);
  expect(events).not.toHaveBeenCalled();
  expect(
    await harness.fields.apply(IMPORT_IDENTITY, "wiki.page.move", input),
  ).toMatchObject({ result: { changed: true, visibility: "narrower" } });
  expect(
    await harness.repository.writes.findSiblingIds(
      { scope: "project", projectId: "alpha", parentId: parent.id },
      "writer",
    ),
  ).toEqual([harness.page.id, sibling.id]);
  expect(
    await harness.fields.apply(IMPORT_IDENTITY, "wiki.page.move", {
      ...input,
      operationId: "widen",
      parentId: null,
      beforeId: null,
    }),
  ).toMatchObject({ result: { changed: true, visibility: "wider" } });
  expect(events).toHaveBeenCalledTimes(2);
});

it.each(["instance", "private"] as const)(
  "rejects moving a %s page",
  async (scope) => {
    const harness = await setup();
    const page = await harness.service.create(
      harness.actor,
      pageInput({ scope }),
    );
    const before = await wikiFieldState(harness.database, {
      includeOperationKeys: true,
    });
    await expect(
      harness.fields.apply(IMPORT_IDENTITY, "wiki.page.move", {
        operationId: "move",
        pageId: page.id,
        expectedRevision: 1,
        projectId: "alpha",
        parentId: null,
        beforeId: null,
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(
      await wikiFieldState(harness.database, { includeOperationKeys: true }),
    ).toEqual(before);
  },
);

it("rejects missing and hidden projects, parents and siblings and visible parents of the wrong scope or project", async () => {
  const harness = await setup();
  await harness.addProject("gamma", ["alpha"]);
  const hidden = await harness.service.create(
    harness.owner,
    pageInput({ scope: "project", projectId: "beta" }),
  );
  const instance = await harness.service.create(
    harness.actor,
    pageInput({ scope: "instance" }),
  );
  const wrongProject = await harness.service.create(
    harness.actor,
    pageInput({ scope: "project", projectId: "gamma" }),
  );
  const input = {
    operationId: "target",
    pageId: harness.page.id,
    expectedRevision: 1,
    projectId: "alpha",
    parentId: null,
    beforeId: null,
  };
  const before = await wikiFieldState(harness.database, {
    includeOperationKeys: true,
  });
  for (const overrides of [
    { projectId: "missing" },
    { projectId: "beta" },
    { parentId: "missing" },
    { parentId: hidden.id },
    { parentId: instance.id },
    { parentId: wrongProject.id },
    { beforeId: "missing" },
    { beforeId: hidden.id },
  ])
    await expect(
      harness.fields.apply(IMPORT_IDENTITY, "wiki.page.move", {
        ...input,
        ...overrides,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(
    await wikiFieldState(harness.database, { includeOperationKeys: true }),
  ).toEqual(before);
});

it("rejects cycles, template parents, non-siblings and trees deeper than ten levels", async () => {
  const harness = await setup();
  const child = await harness.service.create(
    harness.actor,
    pageInput({ title: "Child", parentId: harness.page.id }),
  );
  const template = await harness.service.create(
    harness.actor,
    pageInput({
      title: "Template",
      scope: "project",
      projectId: "alpha",
      isTemplate: true,
    }),
  );
  let parentId: string | null = null;
  for (let level = 1; level <= 10; level++) {
    const page = await harness.service.create(
      harness.actor,
      pageInput({
        title: `Level ${level}`,
        parentId,
        scope: "project",
        projectId: "alpha",
      }),
    );
    parentId = page.id;
  }
  const input = {
    operationId: "invalid",
    pageId: harness.page.id,
    expectedRevision: 1,
    projectId: "alpha",
    parentId: null,
    beforeId: null,
  };
  const before = await wikiFieldState(harness.database, {
    includeOperationKeys: true,
  });
  for (const overrides of [
    { parentId: harness.page.id },
    { parentId: child.id },
    { parentId: template.id },
    { parentId },
    { beforeId: child.id },
  ])
    await expect(
      harness.fields.apply(IMPORT_IDENTITY, "wiki.page.move", {
        ...input,
        ...overrides,
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  expect(
    await wikiFieldState(harness.database, { includeOperationKeys: true }),
  ).toEqual(before);
});

it("requires management rights in addition to write and checks stale revisions before the target", async () => {
  const harness = await setup();
  const foreign = await harness.service.create(
    harness.owner,
    pageInput({ scope: "project", projectId: "alpha", title: "Foreign" }),
  );
  const input = {
    operationId: "move",
    pageId: foreign.id,
    expectedRevision: 1,
    projectId: "alpha",
    parentId: null,
    beforeId: null,
  };
  const before = await wikiFieldState(harness.database, {
    includeOperationKeys: true,
  });
  await expect(
    harness.fields.apply(IMPORT_IDENTITY, "wiki.page.move", input),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    harness.fields.apply(IMPORT_IDENTITY, "wiki.page.move", {
      ...input,
      pageId: harness.page.id,
      expectedRevision: 2,
      projectId: "missing",
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await harness.database.execute(
    "DELETE FROM role_permissions WHERE role_id = 'role-writer';",
  );
  await expect(
    harness.fields.apply(IMPORT_IDENTITY, "wiki.page.move", {
      ...input,
      pageId: "missing",
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(
    await wikiFieldState(harness.database, { includeOperationKeys: true }),
  ).toEqual(before);
});
