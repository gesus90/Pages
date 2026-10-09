import { ChevronRight, Clock, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { cn } from "@/app/lib/cn";
import { wikiPagePath } from "@/app/lib/wiki-tree";

import type { WikiDragHandlers } from "@/app/components/wiki/use-wiki-drag";
import type { WikiTreeItem } from "@/app/lib/wiki-tree";

interface WikiTreeItemViewProps {
  readonly item: WikiTreeItem;
  readonly depth: number;
  readonly currentId: string | null;
  readonly expandedIds: ReadonlySet<string>;
  readonly onToggle: (id: string) => void;
  readonly onNavigate?: () => void;
  readonly drag: WikiDragHandlers;
  /** Today as `YYYY-MM-DD`, to mark pages that are no longer up to date. */
  readonly today: string;
  /** Offers a plus that creates a subpage of the page, as in Notion. */
  readonly onCreateChild?: (node: WikiTreeItem["node"]) => void;
}

const DROP_MARKERS = {
  after: "border-b-2 border-primary",
  before: "border-t-2 border-primary",
  inside: "ring-2 ring-primary",
} as const;

function ExpandButton({
  isOpen,
  title,
  onToggle,
}: {
  readonly isOpen: boolean;
  readonly title: string;
  readonly onToggle: () => void;
}): React.ReactElement {
  const { t } = useTranslation();

  return (
    <button
      aria-expanded={isOpen}
      aria-label={t(isOpen ? "wiki.nav.collapse" : "wiki.nav.expand", {
        title,
      })}
      className="flex size-6 shrink-0 items-center justify-center rounded-md hover:bg-muted"
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

/** One page of the navigation tree with its open branch. */
export function WikiTreeItemView({
  item,
  depth,
  currentId,
  expandedIds,
  onToggle,
  onNavigate,
  drag,
  today,
  onCreateChild,
}: WikiTreeItemViewProps): React.ReactElement {
  const { t } = useTranslation();
  const { node, children } = item;
  const isOpen = expandedIds.has(node.id);
  const isCurrent = node.id === currentId;
  const isExpired = node.currentUntil !== null && node.currentUntil < today;
  const marker =
    drag.dropTargetId === node.id && drag.dropZone
      ? DROP_MARKERS[drag.dropZone]
      : "";

  return (
    <li>
      <div
        className={cn(
          "group flex min-h-8 items-center gap-1 rounded-lg pr-2 text-sm",
          isCurrent
            ? "bg-primary-subtle text-foreground"
            : "text-muted-foreground hover:bg-sidebar-hover hover:text-foreground",
          marker,
        )}
        data-wiki-node={node.id}
        draggable
        style={{ paddingLeft: `${depth * 0.75 + 0.25}rem` }}
        onDragEnd={drag.onDragEnd}
        onDragOver={(event) => drag.onDragOver(event, node)}
        onDragStart={(event) => drag.onDragStart(event, node)}
        onDrop={(event) => drag.onDrop(event, node)}
      >
        {children.length > 0 ? (
          <ExpandButton
            isOpen={isOpen}
            title={node.title}
            onToggle={() => onToggle(node.id)}
          />
        ) : (
          <span aria-hidden="true" className="size-6 shrink-0" />
        )}
        <Link
          aria-current={isCurrent ? "page" : undefined}
          className="flex min-w-0 flex-1 items-center gap-1.5 py-1"
          to={wikiPagePath(node.id, node.title)}
          onClick={onNavigate}
        >
          {node.icon ? <span aria-hidden="true">{node.icon}</span> : null}
          <span className="truncate">{node.title}</span>
        </Link>
        {isExpired ? (
          <Clock
            aria-label={t("wiki.page.expired")}
            className="size-3.5 shrink-0 text-warning"
            role="img"
          />
        ) : null}
        {onCreateChild ? (
          <button
            aria-label={t("wiki.nav.addChild", { title: node.title })}
            className="flex size-6 shrink-0 items-center justify-center rounded-md opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-muted [@media(hover:none)]:opacity-100"
            type="button"
            onClick={() => onCreateChild(node)}
          >
            <Plus aria-hidden="true" className="size-3.5" />
          </button>
        ) : null}
      </div>
      {children.length > 0 && isOpen ? (
        <ul>
          {children.map((child) => (
            <WikiTreeItemView
              key={child.node.id}
              currentId={currentId}
              depth={depth + 1}
              drag={drag}
              expandedIds={expandedIds}
              item={child}
              today={today}
              onCreateChild={onCreateChild}
              onNavigate={onNavigate}
              onToggle={onToggle}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
