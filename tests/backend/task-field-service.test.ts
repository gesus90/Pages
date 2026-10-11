import { expect, it } from "vitest";

import { createUser, createWorkItem } from "../helpers/factories";
import { fieldStatus, taskFieldDoubles } from "../helpers/task-fields";

const actor = createUser();

it("trims and changes only the title, records it, invalidates and publishes the stored item", async () => {
  const run = taskFieldDoubles();
  const before = createWorkItem();
  const after = createWorkItem({ title: "New title" });
  run.methods.find.mockResolvedValue(after);
  expect(
    await run.fields.updateTitle(actor, before.id, {
      title: " New title ",
      baseTitle: before.title,
    }),
  ).toBe(after);
  expect(run.methods.title).toHaveBeenCalledExactlyOnceWith(
    before.id,
    "New title",
    before.title,
  );
  expect(run.methods.titleHistory).toHaveBeenCalledExactlyOnceWith(
    actor,
    before,
    "New title",
  );
  expect(run.methods.invalidate).toHaveBeenCalledOnce();
  expect(run.methods.publish).toHaveBeenCalledExactlyOnceWith(actor, after);
  expect(run.methods.status).not.toHaveBeenCalled();
  expect(run.methods.parent).not.toHaveBeenCalled();
});

it.each(["title", "status", "parent"] as const)(
  "keeps an already applied %s silent even with an old base",
  async (field) => {
    const run = taskFieldDoubles();
    const existing = createWorkItem();
    run.methods.findStatus.mockResolvedValue(
      fieldStatus({ id: existing.statusId }),
    );
    const updates = {
      title: () =>
        run.fields.updateTitle(actor, existing.id, {
          title: existing.title,
          baseTitle: "obsolete",
        }),
      status: () =>
        run.fields.updateStatus(actor, existing.id, {
          statusId: existing.statusId,
          baseStatusId: "obsolete",
        }),
      parent: () =>
        run.fields.updateParent(actor, existing.id, {
          parentId: null,
          baseParentId: "obsolete",
        }),
    };
    expect(await updates[field]()).toEqual(existing);
    expect(run.methods[field]).not.toHaveBeenCalled();
    expect(run.methods.invalidate).not.toHaveBeenCalled();
    expect(run.methods.publish).not.toHaveBeenCalled();
  },
);

it.each(["title", "status", "parent"] as const)(
  "rejects stale %s and a race at the conditional write",
  async (field) => {
    const run = taskFieldDoubles();
    const existing = createWorkItem();
    const updates = {
      title: (base: string) =>
        run.fields.updateTitle(actor, existing.id, {
          title: "New",
          baseTitle: base,
        }),
      status: (base: string) =>
        run.fields.updateStatus(actor, existing.id, {
          statusId: "status-done",
          baseStatusId: base,
        }),
      parent: (base: string | null) =>
        run.fields.updateParent(actor, existing.id, {
          parentId: "epic",
          baseParentId: base,
        }),
    };
    await expect(updates[field]("obsolete")).rejects.toMatchObject({ field });
    expect(run.methods[field]).not.toHaveBeenCalled();
    run.methods[field].mockResolvedValue(false);
    const base = {
      title: existing.title,
      status: existing.statusId,
      parent: "",
    }[field];
    await expect(updates[field](base)).rejects.toMatchObject({ field });
    expect(run.methods[field]).toHaveBeenCalledOnce();
    expect(run.methods.invalidate).not.toHaveBeenCalled();
    expect(run.methods.publish).not.toHaveBeenCalled();
  },
);

it.each(["title", "status", "parent"] as const)(
  "rejects archived tickets before changing %s",
  async (field) => {
    const run = taskFieldDoubles();
    run.methods.writable.mockResolvedValue(
      createWorkItem({ archivedAt: "2026-01-01" }),
    );
    const updates = {
      title: () =>
        run.fields.updateTitle(actor, "item", {
          title: "New",
          baseTitle: "Old",
        }),
      status: () =>
        run.fields.updateStatus(actor, "item", {
          statusId: "status-done",
          baseStatusId: "old",
        }),
      parent: () =>
        run.fields.updateParent(actor, "item", {
          parentId: "epic",
          baseParentId: null,
        }),
    };
    await expect(updates[field]()).rejects.toMatchObject({
      code: "ticketArchived",
    });
    expect(run.methods[field]).not.toHaveBeenCalled();
  },
);

it.each([null, fieldStatus({ projectId: "other" })])(
  "rejects missing or foreign statuses %j",
  async (status) => {
    const run = taskFieldDoubles();
    run.methods.findStatus.mockResolvedValue(status);
    await expect(
      run.fields.updateStatus(actor, "item", {
        statusId: "status-done",
        baseStatusId: "status-todo",
      }),
    ).rejects.toMatchObject({ code: "targetStatusNotFound" });
    expect(run.methods.status).not.toHaveBeenCalled();
  },
);

it.each([null, "project-1"])(
  "changes a global or project status (%s) without specifying sort order",
  async (projectId) => {
    const run = taskFieldDoubles();
    const status = fieldStatus({ projectId });
    run.methods.findStatus.mockResolvedValue(status);
    await run.fields.updateStatus(actor, "item", {
      statusId: status.id,
      baseStatusId: "status-todo",
    });
    expect(run.methods.status).toHaveBeenCalledExactlyOnceWith(
      "item",
      status,
      "status-todo",
    );
    expect(run.methods.statusHistory).toHaveBeenCalledExactlyOnceWith(
      actor,
      createWorkItem(),
      status,
    );
    expect(run.methods.publish).toHaveBeenCalledOnce();
  },
);

it("preserves a parent hidden from the actor when no parent is requested", async () => {
  const run = taskFieldDoubles();
  run.methods.hiddenParent.mockResolvedValue(
    createWorkItem({ id: "hidden", type: "epic" }),
  );
  expect(
    await run.fields.updateParent(actor, "item", {
      parentId: null,
      baseParentId: null,
    }),
  ).toEqual(createWorkItem());
  expect(run.methods.parent).not.toHaveBeenCalled();
  expect(run.methods.hierarchy).not.toHaveBeenCalled();
});

it.each([null, "new-parent"])(
  "changes or removes a visible parent (%s) without publishing to GitHub",
  async (parentId) => {
    const run = taskFieldDoubles();
    run.methods.writable.mockResolvedValue(
      createWorkItem({ parentId: "old-parent", parentKey: "PAGE-2" }),
    );
    await run.fields.updateParent(actor, "item", {
      parentId,
      baseParentId: " old-parent ",
    });
    expect(run.methods.parent).toHaveBeenCalledExactlyOnceWith(
      "item",
      parentId,
      "old-parent",
    );
    expect(run.methods.hierarchy).toHaveBeenCalledWith(
      expect.objectContaining({ parentId, storedParentId: "old-parent" }),
    );
    expect(run.methods.parentHistory).toHaveBeenCalledExactlyOnceWith(actor, {
      workItemId: "item",
      newParentId: parentId,
      oldParentKey: "PAGE-2",
    });
    expect(run.methods.publish).not.toHaveBeenCalled();
  },
);

it("reports a stored item that disappears after the write", async () => {
  const run = taskFieldDoubles();
  run.methods.find.mockResolvedValue(null);
  await expect(
    run.fields.updateTitle(actor, "item", {
      title: "New",
      baseTitle: createWorkItem().title,
    }),
  ).rejects.toThrow("Work item could not be retrieved after its change.");
  expect(run.methods.publish).not.toHaveBeenCalled();
});
