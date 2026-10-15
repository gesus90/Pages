import { vi } from "vitest";

import { WikiAnchorRepository } from "@/backend/database/repositories/wiki/WikiAnchorRepository";
import { WikiPageRepository } from "@/backend/database/repositories/wiki/WikiPageRepository";
import { WikiPageWriteRepository } from "@/backend/database/repositories/wiki/WikiPageWriteRepository";

import { parseWikiCover } from "@/definition/Wiki";

import { subtreeOf, visibleRow } from "./wiki-state";

import type { WikiNodeRecord } from "@/backend/database/repositories/WikiRepository";
import type { WikiPageLink, WikiPageSummary } from "@/definition/Wiki";
import type { PageRow, WikiState } from "./wiki-state";

/** The timestamp every stored page carries. */
export const WIKI_NOW = "2026-10-15 10:00:00";

function link(row: PageRow): WikiPageLink {
  const { id, title, icon } = row.page;
  return { id, title, icon };
}

function summary({ page }: PageRow): WikiPageSummary {
  return {
    createdAt: page.createdAt,
    currentUntil: page.currentUntil,
    icon: page.icon,
    id: page.id,
    ownerId: page.ownerId,
    ownerName: page.ownerName,
    parentId: page.parentId,
    projectId: page.projectId,
    projectName: page.projectName,
    scope: page.scope,
    title: page.title,
    updatedAt: page.updatedAt,
  };
}

function nodeOf(row: PageRow): WikiNodeRecord {
  const { page } = row;
  return {
    deletedAt: row.deletedAt,
    deletedRootId: row.deletedRootId,
    id: page.id,
    isTemplate: page.isTemplate,
    ownerId: page.ownerId,
    parentId: page.parentId,
    projectId: page.projectId,
    revision: page.revision,
    scope: page.scope,
  };
}

function ancestors(state: WikiState, id: string): PageRow[] {
  const chain: PageRow[] = [];
  let parentId = state.data.pages.get(id)?.page.parentId ?? null;
  while (parentId !== null) {
    const parent = state.data.pages.get(parentId);
    if (parent === undefined) break;
    chain.unshift(parent);
    parentId = parent.page.parentId;
  }
  return chain;
}

function sortedSiblings(state: WikiState): PageRow[] {
  return [...state.data.pages.values()].sort(
    (left, right) => left.position - right.position,
  );
}

/** Replaces the reads of pages by the in-memory rows. */
function installPageReads(state: WikiState): void {
  vi.spyOn(WikiPageRepository.prototype, "findVisible").mockImplementation(
    async (scope, id, options) =>
      visibleRow(state, scope, id, options?.includeDeleted === true)?.page ??
      null,
  );
  vi.spyOn(WikiPageRepository.prototype, "findNode").mockImplementation(
    async (id) => {
      const row = state.data.pages.get(id);
      return row === undefined ? null : nodeOf(row);
    },
  );
  vi.spyOn(WikiPageRepository.prototype, "findBreadcrumb").mockImplementation(
    async (id) => ancestors(state, id).map(link),
  );
  vi.spyOn(WikiPageRepository.prototype, "countLevelsAbove").mockImplementation(
    async (id) => ancestors(state, id).length,
  );
  vi.spyOn(WikiPageRepository.prototype, "countLevelsBelow").mockImplementation(
    async (id) => {
      const depthOf = (pageId: string): number =>
        Math.max(
          -1,
          ...sortedSiblings(state)
            .filter((row) => row.page.parentId === pageId)
            .map((row) => depthOf(row.page.id)),
        ) + 1;
      return depthOf(id);
    },
  );
  vi.spyOn(WikiPageRepository.prototype, "findSubtreeIds").mockImplementation(
    async (id) => subtreeOf(state, id),
  );
}

/** Replaces the list reads of the navigation, the start page and the trash. */
function installPageLists(state: WikiState): void {
  const visibleRows = (
    scope: Parameters<typeof visibleRow>[1],
    isTemplate: boolean,
  ): PageRow[] =>
    sortedSiblings(state).filter(
      (row) =>
        row.page.isTemplate === isTemplate &&
        visibleRow(state, scope, row.page.id) !== null,
    );
  vi.spyOn(WikiPageRepository.prototype, "listNodes").mockImplementation(
    async (scope) =>
      visibleRows(scope, false).map(({ page, position }) => ({
        currentUntil: page.currentUntil,
        icon: page.icon,
        id: page.id,
        parentId: page.parentId,
        position,
        projectId: page.projectId,
        scope: page.scope,
        title: page.title,
      })),
  );
  vi.spyOn(WikiPageRepository.prototype, "listChildren").mockImplementation(
    async (scope, parentId) =>
      visibleRows(scope, false)
        .filter((row) => row.page.parentId === parentId)
        .map(link),
  );
  vi.spyOn(WikiPageRepository.prototype, "listSummaries").mockImplementation(
    async (scope) => visibleRows(scope, false).map(summary),
  );
  vi.spyOn(WikiPageRepository.prototype, "listTemplates").mockImplementation(
    async (scope) => visibleRows(scope, true).map((row) => row.page),
  );
  vi.spyOn(WikiPageRepository.prototype, "findTitles").mockImplementation(
    async (scope, ids) =>
      ids.flatMap((id) => {
        const row = visibleRow(state, scope, id);
        return row === null ? [] : [{ id, title: row.page.title }];
      }),
  );
}

/** Replaces the trash and private-page reads. */
function installTrashReads(state: WikiState): void {
  vi.spyOn(WikiPageRepository.prototype, "listTrash").mockImplementation(
    async (scope, ownedOnly) =>
      sortedSiblings(state)
        .filter(
          (row) =>
            row.deletedRootId === row.page.id &&
            visibleRow(state, scope, row.page.id, true) !== null &&
            (!ownedOnly || row.page.ownerId === scope.userId),
        )
        .map((row) => ({
          ...link(row),
          deletedAt: row.deletedAt ?? WIKI_NOW,
          deletedByName: row.deletedBy,
          ownerId: row.page.ownerId,
          ownerName: row.page.ownerName,
          parentTitle:
            state.data.pages.get(row.page.parentId ?? "")?.page.title ?? null,
          projectName: row.page.projectName,
          scope: row.page.scope,
        })),
  );
  vi.spyOn(
    WikiPageRepository.prototype,
    "findExpiredTrashRoots",
  ).mockImplementation(async () => [...state.expiredRoots]);
  vi.spyOn(
    WikiPageRepository.prototype,
    "countPrivateByOwner",
  ).mockImplementation(async () => {
    const counts = new Map<string, number>();
    for (const { page, deletedAt } of state.data.pages.values()) {
      if (page.scope === "private" && deletedAt === null)
        counts.set(page.ownerId, (counts.get(page.ownerId) ?? 0) + 1);
    }
    return counts;
  });
  vi.spyOn(WikiPageRepository.prototype, "findPrivateIds").mockImplementation(
    async (ownerId) =>
      sortedSiblings(state)
        .filter(
          (row) =>
            row.page.scope === "private" &&
            row.page.ownerId === ownerId &&
            row.deletedAt === null,
        )
        .map((row) => row.page.id),
  );
}

/** Replaces the page writes, so the in-memory rows change like database rows. */
function installPageWrites(state: WikiState): void {
  const proto = WikiPageWriteRepository.prototype;
  vi.spyOn(proto, "nextPosition").mockImplementation(
    async (placement, ownerId) =>
      1 +
      [...state.data.pages.values()].filter(
        ({ page, deletedAt }) =>
          deletedAt === null &&
          page.parentId === placement.parentId &&
          page.scope === placement.scope &&
          page.projectId === placement.projectId &&
          (page.scope !== "private" || page.ownerId === ownerId),
      ).length,
  );
  vi.spyOn(proto, "insert").mockImplementation(async (page, position) => {
    const author = state.users.get(page.authorId)?.displayName ?? page.authorId;
    state.data.pages.set(page.id, {
      deletedAt: null,
      deletedBy: null,
      deletedRootId: null,
      page: {
        content: page.content,
        cover: null,
        createdAt: WIKI_NOW,
        currentUntil: null,
        icon: page.icon,
        id: page.id,
        isTemplate: page.isTemplate,
        ownerId: page.ownerId,
        ownerName: state.users.get(page.ownerId)?.displayName ?? page.ownerId,
        parentId: page.parentId,
        projectId: page.projectId,
        projectName: page.projectId,
        revision: 1,
        scope: page.scope,
        title: page.title,
        updatedAt: WIKI_NOW,
        updatedByName: author,
      },
      position,
    });
  });
  vi.spyOn(proto, "saveEdit").mockImplementation(async (id, edit) => {
    const row = state.data.pages.get(id);
    if (row === undefined) return 0;
    row.page = {
      ...row.page,
      content: edit.content,
      icon: edit.icon,
      revision: row.page.revision + 1,
      title: edit.title,
      updatedByName: state.users.get(edit.editorId)?.displayName ?? null,
    };
    return row.page.revision;
  });
}

/** Replaces placement, ordering, ownership, cover and trash writes. */
function installPageMoves(state: WikiState): void {
  const proto = WikiPageWriteRepository.prototype;
  const update = (id: string, change: Partial<PageRow["page"]>): void => {
    const row = state.data.pages.get(id);
    if (row !== undefined) row.page = { ...row.page, ...change };
  };
  vi.spyOn(proto, "place").mockImplementation(
    async (id, placement, position) => {
      update(id, {
        parentId: placement.parentId,
        projectId: placement.projectId,
        scope: placement.scope,
      });
      const row = state.data.pages.get(id);
      if (row !== undefined) row.position = position;
    },
  );
  vi.spyOn(proto, "applyScopeToDescendants").mockImplementation(
    async (id, placement) => {
      for (const below of subtreeOf(state, id).slice(1))
        update(below, {
          projectId: placement.projectId,
          scope: placement.scope,
        });
    },
  );
  vi.spyOn(proto, "writePositions").mockImplementation(async (ids) => {
    for (const [index, id] of ids.entries()) {
      const row = state.data.pages.get(id);
      if (row !== undefined) row.position = index + 1;
    }
  });
  vi.spyOn(proto, "findSiblingIds").mockImplementation(
    async (placement, ownerId) =>
      sortedSiblings(state)
        .filter(
          ({ page, deletedAt }) =>
            deletedAt === null &&
            page.parentId === placement.parentId &&
            page.scope === placement.scope &&
            page.projectId === placement.projectId &&
            (page.scope !== "private" || page.ownerId === ownerId),
        )
        .map(({ page }) => page.id),
  );
  vi.spyOn(proto, "setCurrentUntil").mockImplementation(
    async (id, currentUntil) => update(id, { currentUntil }),
  );
  vi.spyOn(proto, "setCover").mockImplementation(async (id, cover) =>
    update(id, { cover: parseWikiCover(cover) }),
  );
  vi.spyOn(proto, "setOwner").mockImplementation(async (id, ownerId) =>
    update(id, { ownerId }),
  );
}

/** Replaces trash writes and anchors. */
function installTrashWrites(state: WikiState): void {
  const proto = WikiPageWriteRepository.prototype;
  vi.spyOn(proto, "markDeleted").mockImplementation(async (id, userId) => {
    const marked = [id];
    for (const current of marked) {
      for (const [childId, row] of state.data.pages) {
        if (row.page.parentId === current && row.deletedAt === null)
          marked.push(childId);
      }
    }
    for (const markedId of marked) {
      const row = state.data.pages.get(markedId);
      if (row === undefined) continue;
      row.deletedAt = WIKI_NOW;
      row.deletedBy = userId;
      row.deletedRootId = id;
    }
  });
  vi.spyOn(proto, "clearDeleted").mockImplementation(async (id) => {
    for (const row of state.data.pages.values()) {
      if (row.deletedRootId !== id) continue;
      row.deletedAt = null;
      row.deletedBy = null;
      row.deletedRootId = null;
    }
  });
}

/** Replaces the anchor repository by in-memory anchors and targets. */
function installAnchors(state: WikiState): void {
  const proto = WikiAnchorRepository.prototype;
  vi.spyOn(proto, "replaceAnchors").mockImplementation(async (id, anchors) => {
    state.data.anchors.set(
      id,
      anchors.map(({ kind, targetId }) => ({ kind, targetId })),
    );
  });
  vi.spyOn(proto, "findAnchors").mockImplementation(async (id) =>
    (state.data.anchors.get(id) ?? []).map(({ kind, targetId }) => ({
      kind,
      label: state.targets.has(`${kind}:${targetId}`) ? targetId : null,
      targetId,
    })),
  );
  vi.spyOn(proto, "removeAnchorsOfSubtree").mockImplementation(
    async (id, kinds) => {
      for (const pageId of subtreeOf(state, id)) {
        const kept = (state.data.anchors.get(pageId) ?? []).filter(
          (anchor) => !kinds.includes(anchor.kind),
        );
        state.data.anchors.set(pageId, kept);
      }
    },
  );
  vi.spyOn(proto, "findAnchorTarget").mockImplementation(
    async (kind, targetId) => state.targets.get(`${kind}:${targetId}`) ?? null,
  );
}

/**
 * Installs the in-memory page, write and anchor repositories.
 *
 * @param state - The rows they read and change.
 */
export function installPageFakes(state: WikiState): void {
  installPageReads(state);
  installPageLists(state);
  installTrashReads(state);
  installPageWrites(state);
  installPageMoves(state);
  installTrashWrites(state);
  installAnchors(state);
}
