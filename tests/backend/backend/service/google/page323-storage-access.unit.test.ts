import { expect, it } from "vitest";

import { browseAccountStorage } from "@/backend/service/google/StorageAccountBrowse";

import { storageWorld } from "./page323-storage-fixture";
import { makeEntry } from "./storage-file-writer-harness";

it("lets an agent without admin mode create a folder and upload Markdown, attributing both actions to its own name", async () => {
  const world = storageWorld();
  const files = world.files.forAccount("Ed");
  const folder = await files.writer.createFolder({
    parentRef: "pages",
    name: "Reports",
    onConflict: "fail",
    userId: "Igor",
  });
  expect(folder).toMatchObject({
    ok: true,
    value: { name: "Reports", parentRef: "pages" },
  });
  if (!folder.ok) throw new Error("folder missing");
  world.drive.entries.set(folder.value.ref, folder.value);
  const bytes = new TextEncoder().encode("# Changelog\nPAGE-323");
  expect(
    await files.writer.upload({
      parentRef: folder.value.ref,
      name: "report.md",
      mimeType: "text/markdown",
      bytes,
      confirmation: null,
      onConflict: "fail",
      userId: "Igor",
    }),
  ).toMatchObject({
    ok: true,
    value: { name: "report.md", parentRef: folder.value.ref },
  });
  expect(
    world.repository.record.mock.calls.map(([activity]) => activity),
  ).toEqual([
    {
      actorId: "Ed",
      actorName: "Ed Agent",
      operation: "create_folder",
      ref: "pages",
    },
    {
      actorId: "Ed",
      actorName: "Ed Agent",
      operation: "upload",
      ref: folder.value.ref,
    },
  ]);
  expect(world.repository.grants).toHaveBeenCalledWith("Ed", "permission");
});

it("refuses folders outside the grant before reading content or changing anything", async () => {
  const world = storageWorld();
  const files = world.files.forAccount("Ed");
  expect(
    await files.writer.createFolder({
      parentRef: "private",
      name: "Denied",
      onConflict: "fail",
      userId: "Ed",
    }),
  ).toEqual({ ok: false, error: { code: "forbidden" } });
  expect(
    await files.writer.upload({
      parentRef: "private",
      name: "denied.md",
      bytes: new Uint8Array(),
      mimeType: "text/markdown",
      onConflict: "fail",
      confirmation: null,
      userId: "Ed",
    }),
  ).toEqual({ ok: false, error: { code: "forbidden" } });
  expect(await files.reader.read("private", null)).toEqual({
    ok: false,
    error: { code: "forbidden" },
  });
  expect(world.drive.calls.createFolder).not.toHaveBeenCalled();
  expect(world.drive.calls.upload).not.toHaveBeenCalled();
  expect(world.repository.record).not.toHaveBeenCalled();
});

it("rechecks revocation on every call of an already created facade", async () => {
  const world = storageWorld();
  const files = world.files.forAccount("Ed");
  expect(
    await files.reader.list({
      ref: "pages",
      isTrash: false,
      pageSize: null,
      pageToken: null,
    }),
  ).toMatchObject({ ok: true });
  world.grants.splice(0);
  expect(
    await files.writer.createFolder({
      parentRef: "pages",
      name: "Denied",
      onConflict: "fail",
      userId: "Ed",
    }),
  ).toEqual({ ok: false, error: { code: "forbidden" } });
  expect(await files.capabilities()).toEqual({
    ok: false,
    error: { code: "forbidden" },
  });
  expect(world.drive.calls.createFolder).not.toHaveBeenCalled();
});

it("keeps deletion, moving, copying, renaming, restore, quota and global search administrative", async () => {
  const world = storageWorld();
  const files = world.files.forAccount("Ed");
  const actor = { ref: "report", userId: "Ed", confirmation: null };
  const results = await Promise.all([
    files.writer.trash(actor),
    files.writer.deletePermanently(actor),
    files.writer.restore(actor),
    files.writer.move({
      ...actor,
      targetParentRef: "pages",
      onConflict: "fail",
    }),
    files.writer.copy({
      ...actor,
      targetParentRef: "pages",
      onConflict: "fail",
      name: null,
    }),
    files.writer.rename({ ...actor, name: "other", onConflict: "fail" }),
    files.reader.quota(),
    files.reader.search({
      text: "report",
      folderRef: null,
      pageSize: null,
      pageToken: null,
    }),
    files.reader.list({
      ref: "pages",
      isTrash: true,
      pageSize: null,
      pageToken: null,
    }),
    files.writer.confirm({ ...actor, action: "delete" }),
    files.batch.run({
      action: "delete",
      refs: ["report"],
      sourceRef: "reports",
      targetParentRef: null,
      userId: "Ed",
    }),
  ]);
  expect(
    results.every((result) => !result.ok && result.error.code === "forbidden"),
  ).toBe(true);
  expect(world.drive.calls.change).not.toHaveBeenCalled();
  expect(world.drive.calls.remove).not.toHaveBeenCalled();
});

it("saves a new version using the existing account-bound confirmation, and denies it after revocation", async () => {
  const world = storageWorld();
  const files = world.files.forAccount("Ed");
  const input = {
    ref: "report",
    userId: "forged",
    confirmation: null,
    mimeType: "text/markdown",
    bytes: new TextEncoder().encode("# New"),
  };
  const confirmation = await files.writer.update(input);
  expect(confirmation).toMatchObject({
    ok: false,
    error: { code: "confirmation_required" },
  });
  if (confirmation.ok || !confirmation.error.confirmation)
    throw new Error("confirmation missing");
  const approved = {
    ...input,
    confirmation: confirmation.error.confirmation.token,
  };
  expect(await files.writer.update(approved)).toMatchObject({
    ok: true,
    value: { version: "2" },
  });
  expect(world.repository.record).toHaveBeenCalledWith(
    expect.objectContaining({ actorId: "Ed", operation: "update" }),
    "permission",
  );
  world.grants.splice(0);
  expect(await files.writer.update(approved)).toEqual({
    ok: false,
    error: { code: "forbidden" },
  });
  expect(world.drive.calls.replaceContent).toHaveBeenCalledTimes(1);
});

it("fails closed for inactive, mismatched and unknown accounts, cycles, missing and trashed ancestry", async () => {
  const world = storageWorld();
  const files = world.files.forAccount("Ed");
  world.readAccount.mockResolvedValueOnce({
    ...world.account,
    isActive: false,
  });
  expect(await files.capabilities()).toMatchObject({ ok: false });
  world.readAccount.mockResolvedValueOnce({
    ...world.account,
    userId: "Conan",
  });
  expect(await files.capabilities()).toMatchObject({ ok: false });
  world.readAccount.mockResolvedValueOnce(null);
  expect(await files.capabilities()).toMatchObject({ ok: false });
  world.drive.entries.set("loop", makeEntry("loop", { parentRef: "loop" }));
  world.drive.entries.set(
    "trashed",
    makeEntry("trashed", { parentRef: "pages", isTrashed: true }),
  );
  for (const ref of ["loop", "trashed", "missing"])
    expect(await files.reader.stat(ref)).toEqual({
      ok: false,
      error: { code: "forbidden" },
    });
});

it("offers only granted operations and checks the requested folder capabilities", async () => {
  const world = storageWorld();
  const files = world.files.forAccount("Ed");
  expect(await files.capabilities("reports")).toMatchObject({
    ok: true,
    value: {
      canWrite: true,
      grantedFolders: [{ ref: "pages", name: "Pages" }],
    },
  });
  const result = await files.capabilities();
  if (!result.ok) throw new Error("capabilities missing");
  expect(result.value.operations).toContain("update");
  expect(result.value.operations).not.toContain("delete");
  expect(result.value.operations).not.toContain("move");
  expect(await files.capabilities("private")).toEqual({
    ok: false,
    error: { code: "forbidden" },
  });
});

it("rejects path resolution outside grants without disclosing ambiguous candidates", async () => {
  const world = storageWorld();
  const files = world.files.forAccount("Ed");
  expect(
    await files.reader.resolvePath("/Pages/reports/report.md"),
  ).toMatchObject({ ok: true, value: { entry: { ref: "report" } } });
  expect(await files.reader.resolvePath("/Private")).toEqual({
    ok: false,
    error: { code: "forbidden" },
  });
  expect(await files.reader.resolvePath("/missing")).toEqual({
    ok: false,
    error: { code: "forbidden" },
  });
});

it("lists only shared roots and checks an explicit UI target", async () => {
  const world = storageWorld();
  const context = await world.access.context("Ed");
  if (!context) throw new Error("context missing");
  const input = { folderId: null, pageToken: null, isFoldersOnly: false };
  const files = world.files.forAccount("Ed");
  expect(await browseAccountStorage(files, context, input)).toMatchObject({
    ok: true,
    value: { folder: { items: [{ id: "pages" }] } },
  });
  expect(
    await browseAccountStorage(files, context, {
      ...input,
      folderId: "private",
    }),
  ).toEqual({ ok: false, error: { code: "forbidden" } });
  expect(
    await browseAccountStorage(files, context, {
      ...input,
      folderId: "reports",
    }),
  ).toMatchObject({
    ok: true,
    value: { folder: { items: [{ id: "report" }] } },
  });
});

it("allows grant administration only in active human admin mode and validates recipients and folders", async () => {
  const world = storageWorld();
  const grant = {
    folderRef: "pages",
    targetKind: "group",
    targetId: "a-team",
  } as const;
  expect(await world.access.setGrant("Ed", grant, true)).toEqual({
    ok: false,
    error: { code: "forbidden" },
  });
  world.readAccount.mockResolvedValue({
    ...world.account,
    isAdmin: true,
    isAgent: false,
    mode: "admin",
  });
  expect(await world.access.settings("Ed")).toMatchObject({
    ok: true,
    value: { targets: [{ name: "A-Team" }] },
  });
  expect(await world.access.setGrant("Ed", grant, true)).toMatchObject({
    ok: true,
  });
  expect(world.repository.setGrant).toHaveBeenCalledWith(
    { ...grant, permissionId: "permission", folderName: "Pages" },
    true,
  );
  expect(await world.access.setGrant("Ed", grant, false)).toMatchObject({
    ok: true,
  });
  expect(
    await world.access.setGrant("Ed", { ...grant, targetId: "missing" }, true),
  ).toMatchObject({ ok: false, error: { code: "invalid_request" } });
  expect(
    await world.access.setGrant("Ed", { ...grant, folderRef: "report" }, true),
  ).toMatchObject({ ok: false, error: { code: "not_folder" } });
  expect(world.repository.setGrant).toHaveBeenCalledTimes(2);
});

it("restricts history to the acting account, with complete history reserved to administrators", async () => {
  const world = storageWorld();
  expect(await world.access.history("Ed")).toEqual({ ok: true, value: [] });
  expect(world.repository.history).toHaveBeenLastCalledWith("Ed", "permission");
  world.readAccount.mockResolvedValue({
    ...world.account,
    isAdmin: true,
    isAgent: false,
    mode: "admin",
  });
  await world.access.history("Ed");
  expect(world.repository.history).toHaveBeenLastCalledWith(null, "permission");
});

it("does not turn an agent into an administrator and denies a human account without a folder grant", async () => {
  const world = storageWorld();
  world.readAccount.mockResolvedValueOnce({
    ...world.account,
    isAdmin: true,
    mode: "admin",
  });
  expect(
    await world.access.setGrant(
      "Ed",
      { folderRef: "pages", targetKind: "group", targetId: "a-team" },
      true,
    ),
  ).toEqual({ ok: false, error: { code: "forbidden" } });
  world.grants.splice(0);
  world.readAccount.mockResolvedValue({ ...world.account, isAgent: false });
  expect(
    await world.files.forAccount("Ed").writer.createFolder({
      parentRef: "pages",
      name: "Denied",
      onConflict: "fail",
      userId: "Ed",
    }),
  ).toEqual({ ok: false, error: { code: "forbidden" } });
  expect(world.drive.calls.createFolder).not.toHaveBeenCalled();
});
