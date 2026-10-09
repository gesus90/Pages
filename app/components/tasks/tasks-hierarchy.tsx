import { useState } from "react";
import { useTranslation } from "react-i18next";

import { buildHierarchy } from "./hierarchy/build-hierarchy";
import { HierarchyRow } from "./hierarchy/hierarchy-row";

import type { WorkItemDetail } from "@/definition/Task";
import type {
  HierarchyNode,
  HierarchySection,
} from "./hierarchy/build-hierarchy";

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

interface SectionProps {
  readonly section: HierarchySection;
  readonly selectedTaskId: string | null;
  readonly collapsedIds: ReadonlySet<string>;
  readonly onToggle: (id: string) => void;
  readonly onSelectTask: (key: string) => void;
  readonly onOpenTask: (key: string) => void;
}

/** One part of the hierarchy with its heading and progressive disclosure. */
function HierarchySectionView({
  section,
  ...rows
}: SectionProps): React.ReactElement {
  const { t } = useTranslation();
  const [visibleRootCount, setVisibleRootCount] = useState<number>(
    HIERARCHY_ROOT_PAGE_SIZE,
  );
  const visibleRoots = section.nodes.slice(0, visibleRootCount);
  const hiddenCount = section.nodes.length - visibleRoots.length;
  const heading = [
    section.projectName,
    section.group ? t(`tasks.tree.group.${section.group}`) : null,
  ]
    .filter((part) => part !== null)
    .join(" · ");

  return (
    <section className="flex flex-col gap-1">
      {heading ? (
        <h3 className="mt-3 text-xs font-semibold text-muted-foreground">
          {heading}
        </h3>
      ) : null}
      <ul className="flex flex-col gap-1">
        {visibleRoots.map((node) => (
          <HierarchyRow key={node.item.id} depth={0} node={node} {...rows} />
        ))}
      </ul>
      {hiddenCount > 0 ? (
        <button
          className="inline-flex min-h-9 items-center justify-center rounded-xl bg-surface px-3 text-sm font-semibold text-muted-foreground shadow-xs transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
          onClick={() =>
            setVisibleRootCount((count) => count + HIERARCHY_ROOT_PAGE_SIZE)
          }
          type="button"
        >
          {t("tasks.view.showMore", { count: hiddenCount })}
        </button>
      ) : null}
    </section>
  );
}

/** Renders the collapsible Initiative/Epic/Task/Subtask planning hierarchy. */
export function TasksHierarchy({
  workItems,
  selectedTaskId,
  onSelectTask,
  onOpenTask,
}: TasksHierarchyProps): React.ReactElement {
  const { t } = useTranslation();
  const sections = buildHierarchy(workItems);
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

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

    for (const section of sections) {
      collect(section.nodes);
    }

    setCollapsedIds(allIds);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-end gap-2">
        <button
          className="rounded-xl bg-surface px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-xs hover:bg-surface-hover hover:text-foreground"
          onClick={() => setCollapsedIds(new Set())}
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
      {sections.map((section) => (
        <HierarchySectionView
          key={section.key}
          collapsedIds={collapsedIds}
          onOpenTask={onOpenTask}
          onSelectTask={onSelectTask}
          onToggle={handleToggle}
          section={section}
          selectedTaskId={selectedTaskId}
        />
      ))}
    </div>
  );
}
