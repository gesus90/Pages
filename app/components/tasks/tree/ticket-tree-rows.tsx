import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import {
  statusDotClass,
  TaskTypeIcon,
} from "@/app/components/tasks/task-badges";
import { cn } from "@/app/lib/cn";

import type {
  TicketTreeGroupNode,
  TicketTreeNode,
  TicketTreeTicket,
} from "@/app/lib/ticket-tree";
import type { TicketTreeEntry } from "@/definition/Task";

/** Children shown before "show more"; long groups stay quick to render. */
const PAGE_SIZE = 50;

/** What every row of the tree needs. */
export interface TreeRowContext {
  readonly currentId: string | null;
  readonly expandedKeys: ReadonlySet<string>;
  readonly onToggle: (nodeKey: string) => void;
  readonly onNavigate?: () => void;
}

interface ToggleProps {
  readonly isOpen: boolean;
  readonly title: string;
  readonly onToggle: () => void;
}

/** Opens or closes a branch; a separate action from following the link. */
function Toggle({ isOpen, title, onToggle }: ToggleProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <button
      aria-expanded={isOpen}
      aria-label={t(isOpen ? "tasks.tree.collapse" : "tasks.tree.expand", {
        title,
      })}
      className="flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-muted md:size-6"
      type="button"
      onClick={onToggle}
    >
      <ChevronRight
        aria-hidden="true"
        className={cn("size-4 transition-transform", isOpen && "rotate-90")}
      />
    </button>
  );
}

/** Whether a branch contains the ticket currently shown, including deeper levels. */
function containsTicket(
  node: TicketTreeNode<TicketTreeEntry>,
  ticketId: string | null,
): boolean {
  return (
    (node.kind === "ticket" && node.entry.id === ticketId) ||
    node.children.some((child) => containsTicket(child, ticketId))
  );
}

/** Children of a branch, including the current ticket's path, and a button for the rest. */
export function TreeChildren({
  nodes,
  depth,
  context,
}: {
  readonly nodes: readonly TicketTreeNode<TicketTreeEntry>[];
  readonly depth: number;
  readonly context: TreeRowContext;
}): React.ReactElement {
  const { t } = useTranslation();
  const [count, setCount] = useState(PAGE_SIZE);
  const currentIndex = nodes.findIndex((node) =>
    containsTicket(node, context.currentId),
  );
  const visibleCount = Math.max(count, currentIndex + 1);
  const hidden = nodes.length - visibleCount;

  return (
    <ul>
      {nodes
        .slice(0, visibleCount)
        .map((node) =>
          node.kind === "group" ? (
            <GroupRow
              key={node.key}
              context={context}
              depth={depth}
              node={node}
            />
          ) : (
            <TicketRow
              key={node.key}
              context={context}
              depth={depth}
              node={node}
            />
          ),
        )}
      {hidden > 0 ? (
        <li>
          <button
            className="min-h-8 w-full rounded-lg text-left text-xs font-medium text-muted-foreground hover:bg-sidebar-hover hover:text-foreground"
            style={{ paddingLeft: `${depth * 0.75 + 2}rem` }}
            type="button"
            onClick={() => setCount(visibleCount + PAGE_SIZE)}
          >
            {t("tasks.tree.showMore", { count: hidden })}
          </button>
        </li>
      ) : null}
    </ul>
  );
}

/** One ticket of the tree: type, key, title and status, with its children. */
function TicketRow({
  node,
  depth,
  context,
}: {
  readonly node: TicketTreeTicket<TicketTreeEntry>;
  readonly depth: number;
  readonly context: TreeRowContext;
}): React.ReactElement {
  const { t } = useTranslation();
  const { entry, children } = node;
  const isOpen = context.expandedKeys.has(node.key);
  const isCurrent = entry.id === context.currentId;

  return (
    <li>
      <div
        className={cn(
          "flex min-h-9 items-center gap-1 rounded-lg pr-2 text-sm md:min-h-8",
          isCurrent
            ? "bg-primary-subtle text-foreground"
            : "text-muted-foreground hover:bg-sidebar-hover hover:text-foreground",
        )}
        style={{ paddingLeft: `${depth * 0.75 + 0.25}rem` }}
      >
        {children.length > 0 ? (
          <Toggle
            isOpen={isOpen}
            title={`${entry.key} ${entry.title}`}
            onToggle={() => context.onToggle(node.key)}
          />
        ) : (
          <span aria-hidden="true" className="size-7 shrink-0 md:size-6" />
        )}
        <Link
          aria-current={isCurrent ? "page" : undefined}
          className="flex min-w-0 flex-1 items-center gap-1.5 py-1"
          prefetch="intent"
          title={`${entry.key} ${entry.title}`}
          to={`/aufgaben/${entry.key}?from=hierarchy`}
          onClick={context.onNavigate}
        >
          <TaskTypeIcon type={entry.type} />
          {/* The narrow sidebar shows the title; type and key are read out
              and shown as tooltip. Spaces keep the parts apart. */}
          <span className="sr-only">
            {t(`tasks.type.${entry.type}`)} {entry.key}
          </span>{" "}
          <span className="truncate">{entry.title}</span>
        </Link>
        <span
          className={cn(
            "size-2 shrink-0 rounded-full",
            statusDotClass(entry.statusKey),
          )}
          role="img"
          aria-label={t("tasks.tree.status", { status: entry.statusName })}
          title={entry.statusName}
        />
      </div>
      {children.length > 0 && isOpen ? (
        <TreeChildren context={context} depth={depth + 1} nodes={children} />
      ) : null}
    </li>
  );
}

/** A group of tickets without a parent of the level above. */
function GroupRow({
  node,
  depth,
  context,
}: {
  readonly node: TicketTreeGroupNode<TicketTreeEntry>;
  readonly depth: number;
  readonly context: TreeRowContext;
}): React.ReactElement {
  const { t } = useTranslation();
  const isOpen = context.expandedKeys.has(node.key);
  const label = t(`tasks.tree.group.${node.group}`);

  return (
    <li>
      <div
        className="flex min-h-9 items-center gap-1 rounded-lg pr-2 text-sm text-muted-foreground md:min-h-8"
        style={{ paddingLeft: `${depth * 0.75 + 0.25}rem` }}
      >
        <Toggle
          isOpen={isOpen}
          title={label}
          onToggle={() => context.onToggle(node.key)}
        />
        <span className="min-w-0 flex-1 truncate italic">{label}</span>
        <span className="shrink-0 text-xs">{node.children.length}</span>
      </div>
      {isOpen ? (
        <TreeChildren
          context={context}
          depth={depth + 1}
          nodes={node.children}
        />
      ) : null}
    </li>
  );
}

/** A project of the tree, shown when tickets of several projects are visible. */
export function ProjectRow({
  projectKey,
  name,
  nodes,
  context,
}: {
  readonly projectKey: string;
  readonly name: string;
  readonly nodes: readonly TicketTreeNode<TicketTreeEntry>[];
  readonly context: TreeRowContext;
}): React.ReactElement {
  const isOpen = context.expandedKeys.has(projectKey);

  return (
    <li>
      <div className="flex min-h-9 items-center gap-1 rounded-lg pr-2 text-sm font-medium text-foreground md:min-h-8">
        <Toggle
          isOpen={isOpen}
          title={name}
          onToggle={() => context.onToggle(projectKey)}
        />
        <span className="min-w-0 flex-1 truncate">{name}</span>
      </div>
      {isOpen ? (
        <TreeChildren context={context} depth={1} nodes={nodes} />
      ) : null}
    </li>
  );
}
