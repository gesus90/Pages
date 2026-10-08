import { useState } from "react";
import { useFetcher, useParams } from "react-router";

import { useWikiDrag } from "@/app/components/wiki/use-wiki-drag";
import { findAncestorIds } from "@/app/lib/wiki-tree";
import { compareAudience } from "@/definition/Wiki";

import type {
  WikiDragHandlers,
  WikiMoveRequest,
} from "@/app/components/wiki/use-wiki-drag";
import type { WikiNavigation } from "@/definition/Wiki";

/** State and handlers the navigation tree needs. */
export interface WikiNavigationState {
  readonly currentId: string | null;
  readonly expandedIds: ReadonlySet<string>;
  readonly onToggle: (id: string) => void;
  readonly drag: WikiDragHandlers;
  /** A move that needs a confirmation because it changes who sees the page. */
  readonly pendingMove: WikiMoveRequest | null;
  readonly closeMove: () => void;
}

/**
 * Keeps which branches are open and carries out drops in the tree.
 *
 * @param navigation - The visible pages and the stored open branches.
 * @returns State and handlers for the tree.
 *
 * @remarks
 * Branches that hold the open page stay open. Opening and closing is stored
 * for the person; a drop that does not change the audience moves at once,
 * every other drop first asks in the move dialog (T4.4.3).
 */
export function useWikiNavigation(
  navigation: WikiNavigation,
): WikiNavigationState {
  const { pageId = null } = useParams();
  const fetcher = useFetcher();
  const [openedIds, setOpenedIds] = useState(
    () => new Set(navigation.expandedIds),
  );
  const [pendingMove, setPendingMove] = useState<WikiMoveRequest | null>(null);
  const expandedIds = new Set([
    ...openedIds,
    ...(pageId === null ? [] : findAncestorIds(navigation.nodes, pageId)),
  ]);

  function handleToggle(id: string): void {
    const isOpen = !openedIds.has(id);
    const next = new Set(openedIds);

    if (isOpen) {
      next.add(id);
    } else {
      next.delete(id);
    }

    setOpenedIds(next);
    void fetcher.submit(
      { expanded: isOpen ? "1" : "0", intent: "set-expanded", pageId: id },
      { action: "/wiki", method: "post" },
    );
  }

  function handleMove(request: WikiMoveRequest): void {
    const change = compareAudience(request.from, {
      projectId: request.projectId,
      scope: request.scope,
    });

    if (change !== "same") {
      setPendingMove(request);

      return;
    }

    void fetcher.submit(
      {
        beforeId: request.beforeId ?? "",
        intent: "move-page",
        pageId: request.pageId,
        parentId: request.parentId ?? "",
        projectId: request.projectId ?? "",
        scope: request.scope,
      },
      { action: "/wiki", method: "post" },
    );
  }

  return {
    closeMove: () => setPendingMove(null),
    currentId: pageId,
    drag: useWikiDrag(navigation.nodes, handleMove),
    expandedIds,
    onToggle: handleToggle,
    pendingMove,
  };
}
