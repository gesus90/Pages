import { cn } from "@/app/lib/cn";

/**
 * The title of a block of the console sidebar: 14/650.
 */
export const SIDEBAR_TITLE_CLASS =
  "text-sm font-[650] text-agent-console-foreground";

/**
 * One block of the console sidebar with its title.
 * @remarks
 * A block has 12 px padding above and below, the only space between two
 * blocks; the sidebar draws the 1 px divider between them.
 */
export function SidebarSection(props: {
  readonly title: string;
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="min-w-0 py-3">
      <h3 className={SIDEBAR_TITLE_CLASS}>{props.title}</h3>
      {props.children}
    </section>
  );
}

/**
 * One row of the sidebar: the label 13/400 in the muted color, one value
 * right aligned and centered to the label.
 * @remarks
 * A row is 28 px high, a row whose value is a badge 32 px, so the todo list
 * above keeps as much of the height as possible. Label and value keep at
 * least 12 px apart; a value wider than its column is cut by the value itself,
 * never wrapped into a second line.
 */
export function SidebarRow(props: {
  readonly label: React.ReactNode;
  readonly children: React.ReactNode;
  /** Whether the value is a badge, which needs the higher row. */
  readonly hasBadge?: boolean;
}): React.ReactElement {
  return (
    <div
      data-sidebar-row=""
      className={cn(
        "flex min-w-0 items-center justify-between gap-3 text-[13px]",
        props.hasBadge ? "h-8" : "h-7",
      )}
    >
      <dt className="shrink-0 text-agent-console-muted">{props.label}</dt>
      <dd className="flex min-w-0 justify-end text-right text-agent-console-foreground">
        {props.children}
      </dd>
    </div>
  );
}

/**
 * The width a session row's value may take.
 * - `default`: 144 px at most.
 * - `wide`: 176 px at most, for the compact model badge.
 */
type RowBadgeWidth = "default" | "wide";

const ROW_BADGE_WIDTH_CLASS: Readonly<Record<RowBadgeWidth, string>> = {
  default: "max-w-36",
  wide: "max-w-44",
};

/**
 * The value of a session row, capped by its width so the label always keeps
 * its room; a long value ends with "…" inside its badge.
 */
export function RowBadge(props: {
  readonly children: React.ReactNode;
  readonly width?: RowBadgeWidth;
}): React.ReactElement {
  const width = props.width ?? "default";
  return (
    <span
      data-row-badge={width}
      className={cn("flex min-w-0 justify-end", ROW_BADGE_WIDTH_CLASS[width])}
    >
      {props.children}
    </span>
  );
}

/** A session row whose value is plain text, cut with "…" when it is too long. */
export function Fact(props: {
  readonly label: string;
  readonly value: string;
}): React.ReactElement {
  return (
    <SidebarRow label={props.label}>
      <span title={props.value} className="min-w-0 truncate">
        {props.value}
      </span>
    </SidebarRow>
  );
}
