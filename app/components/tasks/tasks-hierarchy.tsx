import { useState } from "react";
import { useTranslation } from "react-i18next";

import { buildHierarchy } from "./hierarchy/build-hierarchy";
import { HierarchyRow } from "./hierarchy/hierarchy-row";

import type { WorkItemDetail } from "@/definition/Task";
import type { HierarchyNode } from "./hierarchy/build-hierarchy";

export { buildHierarchy } from "./hierarchy/build-hierarchy";

interface TasksHierarchyProps {
  readonly workItems: readonly WorkItemDetail[];
  readonly selectedTaskId: string | null;
  readonly onSelectTask: (key: string) => void;
  readonly onOpenTask: (key: string) => void;
}

// Root nodes rendered before progressive disclosure; children of a visible
// node always render fully so subtrees never dangle.
const HIERARCHY_ROOT_PAGE_SIZE = 50;

/** Renders the collapsible Initiative/Epic/Task/Subtask planning hierarchy. */
export function TasksHierarchy({
  workItems,
  selectedTaskId,
  onSelectTask,
  onOpenTask,
}: TasksHierarchyProps): React.ReactElement {
  const { t } = useTranslation();
  const nodes = buildHierarchy(workItems);
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [visibleRootCount, setVisibleRootCount] = useState<number>(
    HIERARCHY_ROOT_PAGE_SIZE,
  );
  const visibleRoots = nodes.slice(0, visibleRootCount);
  const hiddenCount = nodes.length - visibleRoots.length;

  function handleShowMore(): void {
    setVisibleRootCount((count) => count + HIERARCHY_ROOT_PAGE_SIZE);
  }

  function handleToggle(id: string): void {
    setCollapsedIds((previous) => {
      const next = new Set(previous);

      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      return next;
    });
  }

  function handleExpandAll(): void {
    setCollapsedIds(new Set());
  }

  function handleCollapseAll(): void {
    const allIds = new Set<string>();

    function collect(current: readonly HierarchyNode[]): void {
      for (const node of current) {
        if (node.children.length > 0) {
          allIds.add(node.item.id);
        }

        collect(node.children);
      }
    }

    collect(nodes);
    setCollapsedIds(allIds);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-end gap-2">
        <button
          className="rounded-xl bg-surface px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-xs hover:bg-surface-hover hover:text-foreground"
          onClick={handleExpandAll}
          type="button"
        >
          {t("tasks.hierarchy.expandAll")}
        </button>
        <button
          className="rounded-xl bg-surface px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-xs hover:bg-surface-hover hover:text-foreground"
          onClick={handleCollapseAll}
          type="button"
        >
          {t("tasks.hierarchy.collapseAll")}
        </button>
      </div>
      <ul className="flex flex-col gap-1">
        {visibleRoots.map((node) => (
          <HierarchyRow
            key={node.item.id}
            node={node}
            depth={0}
            selectedTaskId={selectedTaskId}
            collapsedIds={collapsedIds}
            onToggle={handleToggle}
            onSelectTask={onSelectTask}
            onOpenTask={onOpenTask}
          />
        ))}
      </ul>
      {hiddenCount > 0 ? (
        <button
          className="inline-flex min-h-9 items-center justify-center rounded-xl bg-surface px-3 text-sm font-semibold text-muted-foreground shadow-xs transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
          onClick={handleShowMore}
          type="button"
        >
          {t("tasks.view.showMore", { count: hiddenCount })}
        </button>
      ) : null}
    </div>
  );
}
