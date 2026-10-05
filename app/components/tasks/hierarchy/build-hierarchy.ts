import type { WorkItemDetail } from "@/definition/Task";

/** A work item together with its nested children and rolled-up progress. */
export interface HierarchyNode {
  readonly item: WorkItemDetail;
  readonly children: readonly HierarchyNode[];
  readonly progress: number;
}

/**
 * Groups work items into a parent-child tree.
 *
 * @param workItems - Flat work items, already filtered by the task filters.
 * @returns Root nodes with nested children; orphans attach at the root.
 */
export function buildHierarchy(
  workItems: readonly WorkItemDetail[],
): HierarchyNode[] {
  const childrenByParent = new Map<string, WorkItemDetail[]>();

  for (const item of workItems) {
    if (item.parentId === null) {
      continue;
    }

    const siblings = childrenByParent.get(item.parentId);

    if (siblings) {
      siblings.push(item);
    } else {
      childrenByParent.set(item.parentId, [item]);
    }
  }

  const knownIds = new Set(workItems.map((item) => item.id));
  const roots = workItems.filter(
    (item) => item.parentId === null || !knownIds.has(item.parentId),
  );

  function toNode(item: WorkItemDetail): HierarchyNode {
    const children = (childrenByParent.get(item.id) ?? []).map(toNode);
    const progress =
      children.length === 0
        ? item.progressPercentage
        : Math.round(
            children.reduce((total, child) => total + child.progress, 0) /
              children.length,
          );

    return { children, item, progress };
  }

  return roots.map(toNode);
}
