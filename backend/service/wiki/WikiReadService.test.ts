import { expect, it, vi } from "vitest";

import { WikiPageNotFoundError } from "@/backend/error/WikiErrors";

import { WikiReadService } from "./WikiReadService";

import type { WikiRepository } from "@/backend/database/repositories/WikiRepository";
import type { User } from "@/definition/User";
import type { WikiAccess } from "./WikiAccess";
import type { WikiTrashService } from "./WikiTrashService";

const actor = { id: "u1" } as unknown as User;
const scope = { projectIds: ["pr"], userId: "u1" };
const viewer = { canManageProjects: false, canWrite: true, scope, user: actor };
const record = { id: "p", ownerId: "u1", scope: "instance" };

function serviceOf(
  repository: object,
  findPlaceholder: unknown = null,
): WikiReadService {
  return new WikiReadService(
    repository as WikiRepository,
    { resolve: vi.fn(async () => viewer) } as unknown as WikiAccess,
    {
      findPlaceholder: vi.fn(async () => findPlaceholder),
    } as unknown as WikiTrashService,
  );
}

function viewRepository(found: unknown): object {
  return {
    anchors: { findAnchors: vi.fn(async () => []) },
    pages: {
      findBreadcrumb: vi.fn(async () => []),
      findVisible: vi.fn(async () => found),
      listChildren: vi.fn(async () => []),
    },
    state: {
      listFavoriteIds: vi.fn(async () => ["p"]),
      recordVisit: vi.fn(async () => {}),
    },
  };
}

it("tells whether a page is viewable", async () => {
  await expect(
    serviceOf(viewRepository(record)).canView(actor, "p"),
  ).resolves.toBe(true);
  await expect(
    serviceOf(viewRepository(null)).canView(actor, "p"),
  ).resolves.toBe(false);
});

it("reads a page and records the visit", async () => {
  const repository = viewRepository(record);
  const result = await serviceOf(repository).read(actor, "p");

  expect(result).toMatchObject({
    kind: "page",
    view: { isFavorite: true, permissions: { canManage: true } },
  });
});

it("returns a placeholder or fails for a hidden page", async () => {
  const placeholder = { id: "p" };

  await expect(
    serviceOf(viewRepository(null), placeholder).read(actor, "p"),
  ).resolves.toEqual({ kind: "placeholder", placeholder });
  await expect(
    serviceOf(viewRepository(null)).read(actor, "p"),
  ).rejects.toThrow(WikiPageNotFoundError);
});

it("views and reads a page without a visit", async () => {
  const service = serviceOf(viewRepository(record));

  await expect(service.view(actor, "p")).resolves.toMatchObject({
    page: { id: "p" },
  });
  await expect(service.readWithoutVisit(actor, "p")).resolves.toBe(record);
});

it("lists visible nodes and templates", async () => {
  const repository = {
    pages: {
      listNodes: vi.fn(async () => [{ id: "n" }]),
      listTemplates: vi.fn(async () => [
        { extra: 1, icon: null, id: "t", title: "T" },
      ]),
    },
  };
  const service = serviceOf(repository);

  await expect(service.visibleNodes(actor)).resolves.toEqual([{ id: "n" }]);
  await expect(service.templates(actor)).resolves.toEqual([
    { icon: null, id: "t", title: "T" },
  ]);
});

it("builds the navigation from still visible pages", async () => {
  const repository = {
    lookups: { findProjectNames: vi.fn(async () => [{ id: "pr" }]) },
    pages: {
      listNodes: vi.fn(async () => [{ icon: "i", id: "a", title: "A" }]),
    },
    state: {
      listExpandedIds: vi.fn(async () => ["a", "gone"]),
      listFavoriteIds: vi.fn(async () => ["a", "gone"]),
      listRecentIds: vi.fn(async () => ["a", "gone"]),
    },
  };

  await expect(serviceOf(repository).navigation(actor)).resolves.toEqual({
    canCreate: true,
    expandedIds: ["a"],
    favoriteIds: ["a"],
    nodes: [{ icon: "i", id: "a", title: "A" }],
    projects: [{ id: "pr" }],
    recent: [{ icon: "i", id: "a", title: "A" }],
  });
});

it("builds the start page lists", async () => {
  const pages = [
    { id: "a", ownerId: "u1" },
    { id: "b", ownerId: "x" },
  ];
  const repository = {
    pages: { listSummaries: vi.fn(async () => pages) },
    state: { listFavoriteIds: vi.fn(async () => ["b"]) },
  };

  await expect(serviceOf(repository).home(actor)).resolves.toEqual({
    all: pages,
    favorites: [pages[1]],
    mine: [pages[0]],
    recentlyEdited: pages,
  });
});

it("marks favorites and open branches", async () => {
  const repository = {
    pages: { findVisible: vi.fn(async () => record) },
    state: {
      setExpanded: vi.fn(async () => {}),
      setFavorite: vi.fn(async () => {}),
    },
  };
  const service = serviceOf(repository);

  await service.setFavorite(actor, "p", true);
  await service.setExpanded(actor, "p", false);

  expect(repository).toMatchObject({});
  const { state } = repository;

  expect(state.setFavorite).toHaveBeenCalledWith("u1", "p", true);
  expect(state.setExpanded).toHaveBeenCalledWith("u1", "p", false);
});
