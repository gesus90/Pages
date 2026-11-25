import { expect, it, vi } from "vitest";

import {
  WikiAccessDeniedError,
  WikiPageNotFoundError,
  WikiValidationError,
} from "@/backend/error/WikiErrors";

import { WikiTrashService } from "./WikiTrashService";

import { ROLE } from "@/definition/Role";

import type { WikiRepository } from "@/backend/database/repositories/WikiRepository";
import type { User } from "@/definition/User";

const actor: User = {
  displayName: "U",
  id: "u",
  isActive: true,
  mustChangePassword: false,
  role: ROLE.EMPLOYEE,
  username: "u",
};

interface Facts {
  readonly isAdmin?: boolean;
  readonly canManageProjects?: boolean;
  readonly page?: object | null;
  readonly node?: object | null;
  readonly nodes?: Record<string, object | null>;
}

function setup(facts: Facts = {}): {
  readonly service: WikiTrashService;
  readonly repository: Record<string, Record<string, ReturnType<typeof vi.fn>>>;
} {
  const page = facts.page === undefined ? ownPage() : facts.page;
  const repository: Record<
    string,
    Record<string, ReturnType<typeof vi.fn>> | ReturnType<typeof vi.fn>
  > = {
    activity: { insert: vi.fn(async () => {}) },
    attachments: { countByDeletionGroup: vi.fn(async () => 3) },
    lookups: { findUserName: vi.fn(async () => "Owner") },
    pages: {
      countPrivateByOwner: vi.fn(async () => new Map([["o1", 2]])),
      findExpiredTrashRoots: vi.fn(async () => ["r1", "r2"]),
      findNode: vi.fn(async (id: string) =>
        facts.nodes ? (facts.nodes[id] ?? null) : (facts.node ?? null),
      ),
      findPrivateIds: vi.fn(async () => ["a", "b"]),
      findSubtreeIds: vi.fn(async () => ["p", "c", "hidden"]),
      findTitles: vi.fn(async () => [
        { id: "p", title: "Page" },
        { id: "c", title: "Child" },
      ]),
      findVisible: vi.fn(async () => page),
      listDeletionGroup: vi.fn(async () => [
        { id: "p", title: "Page", extra: 1 },
      ]),
      listTrash: vi.fn(async () => [{ id: "t" }]),
    },
    writes: {
      clearDeleted: vi.fn(async () => {}),
      markDeleted: vi.fn(async () => {}),
      nextPosition: vi.fn(async () => 7),
      place: vi.fn(async () => {}),
    },
    deletePages: vi.fn(async () => ["file"]),
  };

  repository.transaction = vi.fn(
    async (work: (inner: unknown) => Promise<unknown>) => work(repository),
  );

  const access = {
    resolve: vi.fn(async () => ({
      canManageProjects: facts.canManageProjects ?? false,
      scope: {
        isAdmin: facts.isAdmin ?? false,
        userId: "u",
      },
    })),
  };
  const service = new WikiTrashService(
    repository as unknown as WikiRepository,
    access as never,
  );

  return {
    repository: repository as Record<
      string,
      Record<string, ReturnType<typeof vi.fn>>
    >,
    service,
  };
}

function ownPage(): object {
  return {
    id: "p",
    ownerId: "u",
    parentId: "parent",
    projectId: "project",
    scope: "project",
    title: "Page",
  };
}

it("deletes a managed page and records the activity", async () => {
  const { repository, service } = setup();

  await service.delete(actor, "p");

  expect(repository.writes.markDeleted).toHaveBeenCalledWith("p", "u");
  expect(repository.activity.insert).toHaveBeenCalledTimes(1);
});

it("refuses to delete a page of somebody else", async () => {
  const { service } = setup({ page: { ...ownPage(), ownerId: "x" } });

  await expect(service.delete(actor, "p")).rejects.toThrow(
    WikiAccessDeniedError,
  );
});

it("previews a deletion with the visible subtree", async () => {
  const { service } = setup();

  await expect(service.previewDelete(actor, "p")).resolves.toEqual({
    affected: [
      { id: "p", title: "Page" },
      { id: "c", title: "Child" },
    ],
    page: { id: "p", title: "Page" },
  });
});

it("refuses to preview the deletion of a foreign page", async () => {
  const { service } = setup({ page: { ...ownPage(), ownerId: "x" } });

  await expect(service.previewDelete(actor, "p")).rejects.toThrow(
    WikiAccessDeniedError,
  );
});

it("previews a purge", async () => {
  const { service } = setup({ node: { deletedRootId: "p" } });

  await expect(service.previewPurge(actor, "p")).resolves.toEqual({
    affected: [{ id: "p", title: "Page" }],
    attachmentCount: 3,
    page: { id: "p", title: "Page" },
  });
});

it("rejects a purge preview of a hidden page", async () => {
  const { service } = setup({ page: null });

  await expect(service.previewPurge(actor, "p")).rejects.toThrow(
    WikiPageNotFoundError,
  );
});

it("rejects a purge preview of a page outside the trash", async () => {
  const { service } = setup({ node: { deletedRootId: "other" } });

  await expect(service.previewPurge(actor, "p")).rejects.toThrow(
    WikiValidationError,
  );
});

it("rejects a purge preview of a missing node", async () => {
  const { service } = setup();

  await expect(service.previewPurge(actor, "p")).rejects.toThrow(
    WikiValidationError,
  );
});

it("rejects a purge preview of a foreign trashed page", async () => {
  const { service } = setup({
    node: { deletedRootId: "p" },
    page: { ...ownPage(), ownerId: "x" },
  });

  await expect(service.previewPurge(actor, "p")).rejects.toThrow(
    WikiAccessDeniedError,
  );
});

it("shows no placeholder to non-administrators", async () => {
  const { service } = setup();

  await expect(service.findPlaceholder(actor, "p")).resolves.toBeNull();
});

it("shows a placeholder of a live private page to administrators", async () => {
  const { service } = setup({
    isAdmin: true,
    node: { deletedAt: null, id: "p", ownerId: "o", scope: "private" },
  });

  await expect(service.findPlaceholder(actor, "p")).resolves.toEqual({
    id: "p",
    ownerId: "o",
    ownerName: "Owner",
  });
});

it("shows no placeholder for missing, public or deleted pages", async () => {
  const missing = setup({ isAdmin: true });
  const open = setup({
    isAdmin: true,
    node: { deletedAt: null, scope: "instance" },
  });
  const deleted = setup({
    isAdmin: true,
    node: { deletedAt: "now", scope: "private" },
  });

  await expect(missing.service.findPlaceholder(actor, "p")).resolves.toBeNull();
  await expect(open.service.findPlaceholder(actor, "p")).resolves.toBeNull();
  await expect(deleted.service.findPlaceholder(actor, "p")).resolves.toBeNull();
});

it("lists placeholders only for administrators", async () => {
  const plain = setup();
  const admin = setup({ isAdmin: true });

  await expect(plain.service.listPlaceholders(actor, "o")).resolves.toEqual([]);
  await expect(admin.service.listPlaceholders(actor, "o")).resolves.toEqual([
    { id: "a", ownerId: "o", ownerName: "Owner" },
    { id: "b", ownerId: "o", ownerName: "Owner" },
  ]);
});

it("counts private pages only for administrators", async () => {
  const plain = setup();
  const admin = setup({ isAdmin: true });

  await expect(plain.service.countPrivatePages(actor)).resolves.toEqual(
    new Map(),
  );
  await expect(admin.service.countPrivatePages(actor)).resolves.toEqual(
    new Map([["o1", 2]]),
  );
});

it("lists the placeholders of every account", async () => {
  const { service } = setup({ isAdmin: true });

  await expect(service.listAllPlaceholders(actor)).resolves.toEqual({
    o1: [
      { id: "a", ownerId: "o1", ownerName: "Owner" },
      { id: "b", ownerId: "o1", ownerName: "Owner" },
    ],
  });
});

it("deletes a private page as an administrator", async () => {
  const { repository, service } = setup({
    isAdmin: true,
    node: { deletedAt: null, id: "p", ownerId: "o", scope: "private" },
  });

  await service.deletePrivateAsAdministrator(actor, "p");

  expect(repository.writes.markDeleted).toHaveBeenCalledWith("p", "u");
});

it("refuses to delete without a placeholder", async () => {
  const { service } = setup();

  await expect(
    service.deletePrivateAsAdministrator(actor, "p"),
  ).rejects.toThrow(WikiPageNotFoundError);
});

it("restricts the trash list to own pages for plain users", async () => {
  const plain = setup();
  const manager = setup({ canManageProjects: true });
  const admin = setup({ isAdmin: true });

  await plain.service.list(actor);
  await manager.service.list(actor);
  await admin.service.list(actor);

  expect(plain.repository.pages.listTrash).toHaveBeenCalledWith(
    expect.anything(),
    true,
  );
  expect(manager.repository.pages.listTrash).toHaveBeenCalledWith(
    expect.anything(),
    false,
  );
  expect(admin.repository.pages.listTrash).toHaveBeenCalledWith(
    expect.anything(),
    false,
  );
});

it("restores a page below a live parent in place", async () => {
  const { repository, service } = setup({
    nodes: {
      p: { deletedRootId: "p" },
      parent: { deletedAt: null },
    },
  });

  await service.restore(actor, "p");

  expect(repository.writes.place).toHaveBeenCalledWith(
    "p",
    { parentId: "parent", projectId: "project", scope: "project" },
    7,
    "u",
  );
});

it("restores a page whose parent is deleted or gone as a root page", async () => {
  const deleted = setup({
    nodes: { p: { deletedRootId: "p" }, parent: { deletedAt: "now" } },
  });
  const gone = setup({ nodes: { p: { deletedRootId: "p" } } });
  const root = setup({
    nodes: { p: { deletedRootId: "p" } },
    page: { ...ownPage(), parentId: null },
  });

  await deleted.service.restore(actor, "p");
  await gone.service.restore(actor, "p");
  await root.service.restore(actor, "p");

  for (const { repository } of [deleted, gone, root]) {
    expect(repository.writes.place).toHaveBeenCalledWith(
      "p",
      { parentId: null, projectId: "project", scope: "project" },
      7,
      "u",
    );
  }
});

it("purges a trashed page and returns its files", async () => {
  const { repository, service } = setup({ node: { deletedRootId: "p" } });

  await expect(service.purge(actor, "p")).resolves.toEqual(["file"]);
  expect(repository.deletePages).toHaveBeenCalledWith(
    expect.objectContaining({ parameters: { root_id: "p" } }),
  );
});

it("purges every expired trash root", async () => {
  const { service } = setup();

  await expect(service.purgeExpired(30)).resolves.toEqual({
    files: ["file", "file"],
    rootIds: ["r1", "r2"],
  });
});
