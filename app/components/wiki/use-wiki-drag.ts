import { useRef, useState } from "react";

import { findSubtreeIds } from "@/app/lib/wiki-tree";

import type {
  WikiPlacementScope,
  WikiScope,
  WikiTreeNode,
} from "@/definition/Wiki";

/** Where on a page row something is dropped. */
export type WikiDropZone = "before" | "inside" | "after";

/** A requested move of a page. */
export interface WikiMoveRequest {
  readonly pageId: string;
  /** Scope and project the page has now, to tell if the audience changes. */
  readonly from: WikiPlacementScope;
  readonly parentId: string | null;
  readonly scope: WikiScope;
  readonly projectId: string | null;
  readonly beforeId: string | null;
}

/** An area of the navigation that accepts dropped pages. */
export interface WikiDropArea {
  readonly scope: WikiScope;
  readonly projectId: string | null;
}

/** Event handlers and marker state of the drag and drop in the tree. */
export interface WikiDragHandlers {
  readonly dropTargetId: string | null;
  readonly dropZone: WikiDropZone | null;
  readonly onDragStart: (event: React.DragEvent, node: WikiTreeNode) => void;
  readonly onDragOver: (event: React.DragEvent, node: WikiTreeNode) => void;
  readonly onDrop: (event: React.DragEvent, node: WikiTreeNode) => void;
  readonly onDragEnd: () => void;
  readonly onAreaDragOver: (event: React.DragEvent) => void;
  readonly onAreaDrop: (event: React.DragEvent, area: WikiDropArea) => void;
}

/**
 * Tells where in a row the pointer is.
 *
 * @param offset - Distance from the top of the row.
 * @param height - Height of the row.
 * @returns The upper quarter is before, the lower quarter after.
 */
export function resolveDropZone(offset: number, height: number): WikiDropZone {
  const ratio = height > 0 ? offset / height : 0.5;

  if (ratio < 0.25) {
    return "before";
  }

  return ratio > 0.75 ? "after" : "inside";
}

/**
 * Turns a drop on a page row into a move request.
 *
 * @param nodes - Visible pages in sibling order.
 * @param drop - The dragged page, the page the drop landed on and the zone.
 * @returns The request.
 */
export function createMoveRequest(
  nodes: readonly WikiTreeNode[],
  drop: {
    readonly dragged: WikiTreeNode;
    readonly target: WikiTreeNode;
    readonly zone: WikiDropZone;
  },
): WikiMoveRequest {
  const { dragged, target, zone } = drop;
  const request = {
    from: { projectId: dragged.projectId, scope: dragged.scope },
    pageId: dragged.id,
    projectId: target.projectId,
    scope: target.scope,
  };

  if (zone === "inside") {
    return { ...request, beforeId: null, parentId: target.id };
  }

  if (zone === "before") {
    return { ...request, beforeId: target.id, parentId: target.parentId };
  }

  const siblings = nodes.filter(
    (node) =>
      node.parentId === target.parentId &&
      node.scope === target.scope &&
      node.projectId === target.projectId,
  );
  const next = siblings[siblings.indexOf(target) + 1];

  return {
    ...request,
    beforeId: next && next.id !== dragged.id ? next.id : null,
    parentId: target.parentId,
  };
}

/**
 * Drag and drop of pages in the navigation tree.
 *
 * @param nodes - Visible pages in sibling order.
 * @param onMove - Called with the move that a drop asks for.
 * @returns The handlers for rows and areas, and the marker state.
 */
export function useWikiDrag(
  nodes: readonly WikiTreeNode[],
  onMove: (request: WikiMoveRequest) => void,
): WikiDragHandlers {
  const draggedNode = useRef<WikiTreeNode | null>(null);
  const [marker, setMarker] = useState<{
    id: string;
    zone: WikiDropZone;
  } | null>(null);

  function acceptsDrop(target: WikiTreeNode): boolean {
    const dragged = draggedNode.current;

    return (
      dragged !== null && !findSubtreeIds(nodes, dragged.id).includes(target.id)
    );
  }

  return {
    dropTargetId: marker?.id ?? null,
    dropZone: marker?.zone ?? null,
    onAreaDragOver: (event) => {
      if (draggedNode.current !== null) {
        event.preventDefault();
      }
    },
    onAreaDrop: (event, area) => {
      event.preventDefault();

      const dragged = draggedNode.current;

      draggedNode.current = null;

      if (dragged !== null) {
        onMove({
          ...area,
          beforeId: null,
          from: { projectId: dragged.projectId, scope: dragged.scope },
          pageId: dragged.id,
          parentId: null,
        });
      }
    },
    onDragEnd: () => {
      draggedNode.current = null;
      setMarker(null);
    },
    onDragOver: (event, target) => {
      if (!acceptsDrop(target)) {
        return;
      }

      event.preventDefault();

      const rect = event.currentTarget.getBoundingClientRect();

      setMarker({
        id: target.id,
        zone: resolveDropZone(event.clientY - rect.top, rect.height),
      });
    },
    onDragStart: (event, node) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", node.id);
      draggedNode.current = node;
    },
    onDrop: (event, target) => {
      event.preventDefault();

      const dragged = draggedNode.current;
      const zone = marker?.zone ?? "inside";

      draggedNode.current = null;
      setMarker(null);

      if (dragged !== null && acceptsDropFor(nodes, dragged.id, target.id)) {
        onMove(createMoveRequest(nodes, { dragged, target, zone }));
      }
    },
  };
}

function acceptsDropFor(
  nodes: readonly WikiTreeNode[],
  pageId: string,
  targetId: string,
): boolean {
  return !findSubtreeIds(nodes, pageId).includes(targetId);
}
