/**
 * The title of a block of the console sidebar: 14/650.
 */
export const SIDEBAR_TITLE_CLASS =
  "text-sm font-[650] text-agent-console-foreground";

/**
 * One block of the console sidebar with its title.
 * @remarks
 * Blocks stand 14 px apart with a 1 px divider between them, drawn by the
 * sidebar; a block only lays out its own title and rows.
 */
export function SidebarSection(props: {
  readonly title: string;
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="min-w-0">
      <h3 className={SIDEBAR_TITLE_CLASS}>{props.title}</h3>
      {props.children}
    </section>
  );
}

/**
 * One row of the session facts: 36 px high, the label 13/400 in the muted
 * color, one value right aligned and centered to the label.
 * @remarks
 * Label and value keep at least 12 px apart; a value wider than its column
 * is cut by the value itself, never wrapped into a second line.
 */
export function SidebarRow(props: {
  readonly label: string;
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <div
      data-sidebar-row=""
      className="flex h-9 min-w-0 items-center justify-between gap-3 text-[13px]"
    >
      <dt className="shrink-0 text-agent-console-muted">{props.label}</dt>
      <dd className="flex min-w-0 justify-end text-right text-agent-console-foreground">
        {props.children}
      </dd>
    </div>
  );
}

/**
 * The cap of a badge in a session row: 144 px at most, so the label always
 * keeps its room and a long value ends with "…" inside its badge.
 */
export function RowBadge(props: {
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <span className="flex max-w-36 min-w-0 justify-end">{props.children}</span>
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
