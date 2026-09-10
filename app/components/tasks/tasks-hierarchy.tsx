import { CheckCircle2, ChevronDown, ChevronRight, Circle } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  TaskPriorityBadge,
  TaskStatusBadge,
  TaskTypeBadge,
} from "@/app/components/tasks/task-badges";
import { WORK_ITEM_TYPE } from "@/definition/Task";

import type { WorkItemDetail } from "@/definition/Task";

interface HierarchyNode {
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

interface TasksHierarchyProps {
  readonly workItems: readonly WorkItemDetail[];
  readonly selectedTaskId: string | null;
  readonly onSelectTask: (key: string) => void;
  readonly onOpenTask: (key: string) => void;
}

function HierarchyRow({
  node,
  depth,
  selectedTaskId,
  collapsedIds,
  onToggle,
  onSelectTask,
  onOpenTask,
}: {
  readonly node: HierarchyNode;
  readonly depth: number;
  readonly selectedTaskId: string | null;
  readonly collapsedIds: ReadonlySet<string>;
  readonly onToggle: (id: string) => void;
  readonly onSelectTask: (key: string) => void;
  readonly onOpenTask: (key: string) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { item, children, progress } = node;
  const isExpanded = !collapsedIds.has(item.id);
  const isSelected = item.key === selectedTaskId;
  const typeLabel =
    item.type === WORK_ITEM_TYPE.INITIATIVE
      ? t("tasks.type.initiative")
      : item.type === WORK_ITEM_TYPE.EPIC
        ? t("tasks.type.epic")
        : item.type === WORK_ITEM_TYPE.SUBTASK
          ? t("tasks.type.subtask")
          : t("tasks.type.task");

  return (
    <li>
      <div
        className={`flex items-center gap-2 rounded-xl bg-surface px-2 py-2 text-sm shadow-card transition-shadow hover:shadow-floating ${
          isSelected ? "bg-primary-subtle/60 ring-2 ring-primary" : ""
        }`}
        style={{ marginLeft: `${Math.min(depth, 4) * 1.25}rem` }}
      >
        {children.length > 0 ? (
          <button
            aria-expanded={isExpanded}
            aria-label={`${item.key} ${item.title}`}
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => onToggle(item.id)}
            type="button"
          >
            {isExpanded ? (
              <ChevronDown className="size-4" aria-hidden="true" />
            ) : (
              <ChevronRight className="size-4" aria-hidden="true" />
            )}
          </button>
        ) : (
          <span
            className="inline-flex size-6 shrink-0 items-center justify-center"
            aria-hidden="true"
          >
            {item.isDone ? (
              <CheckCircle2 className="size-4 text-emerald-500" />
            ) : (
              <Circle className="size-4 text-muted-foreground/50" />
            )}
          </span>
        )}
        <TaskTypeBadge type={item.type} />
        <button
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => onSelectTask(item.key)}
          onDoubleClick={() => onOpenTask(item.key)}
          type="button"
        >
          <span className="shrink-0 font-mono text-xs font-semibold text-muted-foreground">
            {item.key}
          </span>
          <span className="min-w-0 flex-1 truncate font-medium text-foreground">
            {item.title}
          </span>
          <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
            {typeLabel}
          </span>
        </button>
        <span className="hidden w-28 shrink-0 md:inline">
          <span className="block h-1.5 overflow-hidden rounded-full bg-muted">
            <span
              className="block h-full rounded-full bg-primary"
              style={{ width: `${progress}%` }}
            />
          </span>
        </span>
        <span className="hidden w-12 shrink-0 text-right text-xs font-medium text-foreground sm:inline">
          {progress} %
        </span>
        <TaskStatusBadge
          statusKey={item.statusKey}
          statusName={item.statusName}
        />
        <TaskPriorityBadge priority={item.priority} />
      </div>
      {children.length > 0 && isExpanded ? (
        <ul className="mt-1 flex flex-col gap-1">
          {children.map((child) => (
            <HierarchyRow
              key={child.item.id}
              node={child}
              depth={depth + 1}
              selectedTaskId={selectedTaskId}
              collapsedIds={collapsedIds}
              onToggle={onToggle}
              onSelectTask={onSelectTask}
              onOpenTask={onOpenTask}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
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
