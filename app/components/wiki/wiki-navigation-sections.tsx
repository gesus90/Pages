import { Link } from "react-router";

import { WikiTreeItemView } from "@/app/components/wiki/wiki-tree-item";
import { wikiPagePath } from "@/app/lib/wiki-tree";

import type {
  WikiDragHandlers,
  WikiDropArea,
} from "@/app/components/wiki/use-wiki-drag";
import type { WikiTreeItem } from "@/app/lib/wiki-tree";

const HEADING_CLASS =
  "flex items-center gap-1.5 px-2 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase";
const LINK_CLASS =
  "flex min-h-8 items-center gap-1.5 rounded-lg px-2 text-sm text-muted-foreground hover:bg-sidebar-hover hover:text-foreground";

/** The link look of the navigation, shared by its plain links. */
export const NAVIGATION_LINK_CLASS = LINK_CLASS;

interface TreeSectionProps {
  readonly title: string;
  readonly icon: React.ReactNode;
  readonly items: readonly WikiTreeItem[];
  /** Where a page dropped on the heading goes. */
  readonly area: WikiDropArea;
  readonly currentId: string | null;
  readonly expandedIds: ReadonlySet<string>;
  readonly onToggle: (id: string) => void;
  readonly onNavigate?: () => void;
  readonly drag: WikiDragHandlers;
  readonly today: string;
}

/** An area of the navigation with the page trees in it. */
export function WikiTreeSection({
  title,
  icon,
  items,
  area,
  drag,
  ...rest
}: TreeSectionProps): React.ReactElement {
  return (
    <section
      aria-label={title}
      onDragOver={drag.onAreaDragOver}
      onDrop={(event) => drag.onAreaDrop(event, area)}
    >
      <h3 className={HEADING_CLASS}>
        {icon}
        {title}
      </h3>
      <ul>
        {items.map((item) => (
          <WikiTreeItemView
            key={item.node.id}
            depth={0}
            drag={drag}
            item={item}
            {...rest}
          />
        ))}
      </ul>
    </section>
  );
}

interface LinkListProps {
  readonly title: string;
  readonly icon: React.ReactNode;
  readonly links: readonly {
    readonly id: string;
    readonly title: string;
    readonly icon: string | null;
  }[];
  readonly onNavigate?: () => void;
}

/** A short list of page links, such as the favorites. */
export function WikiLinkList({
  title,
  icon,
  links,
  onNavigate,
}: LinkListProps): React.ReactElement | null {
  return links.length === 0 ? null : (
    <section aria-label={title}>
      <h3 className={HEADING_CLASS}>
        {icon}
        {title}
      </h3>
      <ul>
        {links.map((link) => (
          <li key={link.id}>
            <Link
              className={LINK_CLASS}
              to={wikiPagePath(link.id, link.title)}
              onClick={onNavigate}
            >
              {link.icon ? <span aria-hidden="true">{link.icon}</span> : null}
              <span className="truncate">{link.title}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
