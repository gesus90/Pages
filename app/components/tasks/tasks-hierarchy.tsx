import { CheckCircle2, ChevronDown, ChevronRight, Circle } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  TaskPriorityBadge,
  TaskStatusBadge,
  TaskTypeBadge,
} from "@/app/components/tasks/task-badges";
import { buildTicketTree } from "@/app/lib/ticket-tree";
import { WORK_ITEM_TYPE } from "@/definition/Task";

import type { TicketTreeGroup, TicketTreeTicket } from "@/app/lib/ticket-tree";
import type { WorkItemDetail } from "@/definition/Task";

// Root nodes rendered before progressive disclosure; children of a visible
// node always render fully so subtrees never dangle.
const HIERARCHY_ROOT_PAGE_SIZE = 50;

/** A work item together with its nested children and rolled-up progress. */
interface HierarchyNode {
  readonly item: WorkItemDetail;
  readonly children: readonly HierarchyNode[];
  readonly progress: number;
}

/**
 * A part of the hierarchy view: the initiatives of a project, or one group
 * of tickets without a parent of the level above.
 */
interface HierarchySection {
  readonly key: string;
  readonly projectName: string | null;
  readonly group: TicketTreeGroup | null;
  readonly nodes: readonly HierarchyNode[];
}

interface TasksHierarchyProps {
  readonly workItems: readonly WorkItemDetail[];
  readonly selectedTaskId: string | null;
  readonly onSelectTask: (key: string) => void;
  readonly onOpenTask: (key: string) => void;
}

interface SectionProps {
  readonly section: HierarchySection;
  readonly selectedTaskId: string | null;
  readonly collapsedIds: ReadonlySet<string>;
  readonly onToggle: (id: string) => void;
  readonly onSelectTask: (key: string) => void;
  readonly onOpenTask: (key: string) => void;
}

interface HierarchyRowProps {
  readonly node: HierarchyNode;
  readonly depth: number;
  readonly selectedTaskId: string | null;
  readonly collapsedIds: ReadonlySet<string>;
  readonly onToggle: (id: string) => void;
  readonly onSelectTask: (key: string) => void;
  readonly onOpenTask: (key: string) => void;
}

interface HierarchyRowToggleProps {
  readonly item: WorkItemDetail;
  readonly hasChildren: boolean;
  readonly isExpanded: boolean;
  readonly onToggle: (id: string) => void;
}

interface HierarchyRowTitleProps {
  readonly item: WorkItemDetail;
  readonly onSelectTask: (key: string) => void;
  readonly onOpenTask: (key: string) => void;
}

interface HierarchyRowProgressProps {
  readonly progress: number;
}

function toNode(ticket: TicketTreeTicket<WorkItemDetail>): HierarchyNode {
  const children = ticket.children.map(toNode);
  const progress =
    children.length === 0
      ? ticket.entry.progressPercentage
      : Math.round(
          children.reduce((total, child) => total + child.progress, 0) /
            children.length,
        );

  return { children, item: ticket.entry, progress };
}

/**
 * Groups work items into the four-level tree the sidebar shows as well,
 * with rolled-up progress.
 * @param workItems - Flat work items, already filtered by the task filters.
 * @returns Per project its initiatives, then the groups of tickets without
 * a visible parent; every work item appears exactly once.
 */
export function buildHierarchy(
  workItems: readonly WorkItemDetail[],
): HierarchySection[] {
  const projects = buildTicketTree(workItems);
  const isSeveral = projects.length > 1;

  return projects.flatMap((project) => {
    const projectName = isSeveral ? project.projectName : null;
    const initiatives = project.nodes.flatMap((node) =>
      node.kind === "ticket" ? [toNode(node)] : [],
    );
    const groups = project.nodes.flatMap((node) =>
      node.kind === "group"
        ? [
            {
              group: node.group,
              key: node.key,
              nodes: node.children.map(toNode),
              projectName,
            },
          ]
        : [],
    );

    return [
      ...(initiatives.length > 0
        ? [{ group: null, key: project.key, nodes: initiatives, projectName }]
        : []),
      ...groups,
    ];
  });
}

function HierarchyRowToggle({
  item,
  hasChildren,
  isExpanded,
  onToggle,
}: HierarchyRowToggleProps): React.ReactElement {
  if (!hasChildren) {
    return (
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
    );
  }

  return (
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
  );
}

function HierarchyRowTitle({
  item,
  onSelectTask,
  onOpenTask,
}: HierarchyRowTitleProps): React.ReactElement {
  const { t } = useTranslation();

  let typeLabel = t("tasks.type.task");

  if (item.type === WORK_ITEM_TYPE.INITIATIVE) {
    typeLabel = t("tasks.type.initiative");
  } else if (item.type === WORK_ITEM_TYPE.EPIC) {
    typeLabel = t("tasks.type.epic");
  } else if (item.type === WORK_ITEM_TYPE.SUBTASK) {
    typeLabel = t("tasks.type.subtask");
  }

  return (
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
  );
}

function HierarchyRowProgress({
  progress,
}: HierarchyRowProgressProps): React.ReactElement {
  return (
    <>
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
    </>
  );
}

function HierarchyRow({
  node,
  depth,
  selectedTaskId,
  collapsedIds,
  onToggle,
  onSelectTask,
  onOpenTask,
}: HierarchyRowProps): React.ReactElement {
  const { item, children, progress } = node;
  const isExpanded = !collapsedIds.has(item.id);
  const isSelected = item.key === selectedTaskId;

  return (
    <li>
      <div
        className={`flex items-center gap-2 rounded-xl bg-surface px-2 py-2 text-sm shadow-card transition-shadow hover:shadow-floating ${
          isSelected ? "bg-primary-subtle/60 ring-2 ring-primary" : ""
        }`}
        style={{ marginLeft: `${Math.min(depth, 4) * 1.25}rem` }}
      >
        <HierarchyRowToggle
          hasChildren={children.length > 0}
          isExpanded={isExpanded}
          item={item}
          onToggle={onToggle}
        />
        <TaskTypeBadge type={item.type} />
        <HierarchyRowTitle
          item={item}
          onOpenTask={onOpenTask}
          onSelectTask={onSelectTask}
        />
        <HierarchyRowProgress progress={progress} />
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
