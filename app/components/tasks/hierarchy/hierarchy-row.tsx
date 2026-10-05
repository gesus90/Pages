import {
  TaskPriorityBadge,
  TaskStatusBadge,
  TaskTypeBadge,
} from "@/app/components/tasks/task-badges";

import { HierarchyRowProgress } from "./hierarchy-row-progress";
import { HierarchyRowTitle } from "./hierarchy-row-title";
import { HierarchyRowToggle } from "./hierarchy-row-toggle";

import type { HierarchyNode } from "./build-hierarchy";

interface HierarchyRowProps {
  readonly node: HierarchyNode;
  readonly depth: number;
  readonly selectedTaskId: string | null;
  readonly collapsedIds: ReadonlySet<string>;
  readonly onToggle: (id: string) => void;
  readonly onSelectTask: (key: string) => void;
  readonly onOpenTask: (key: string) => void;
}

/** Renders one node of the planning hierarchy and, when expanded, its children. */
export function HierarchyRow({
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
