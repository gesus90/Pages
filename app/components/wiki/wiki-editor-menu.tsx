interface MenuItem<Key extends string> {
  readonly key: Key;
  readonly label: string;
  readonly hint?: string;
}

interface WikiEditorMenuProps<Key extends string> {
  readonly items: readonly MenuItem<Key>[];
  readonly activeIndex: number;
  readonly label: string;
  readonly emptyLabel: string;
  readonly onPick: (key: Key) => void;
}

/** The list that the slash and the reference trigger open under the caret. */
export function WikiEditorMenu<Key extends string>({
  items,
  activeIndex,
  label,
  emptyLabel,
  onPick,
}: WikiEditorMenuProps<Key>): React.ReactElement {
  return (
    <ul
      aria-label={label}
      className="absolute top-full left-0 z-30 mt-1 max-h-64 w-72 overflow-y-auto rounded-xl bg-surface p-1 shadow-panel"
      role="listbox"
    >
      {items.length === 0 ? (
        <li className="px-3 py-2 text-sm text-muted-foreground">
          {emptyLabel}
        </li>
      ) : null}
      {items.map((item, index) => (
        <li
          key={item.key}
          aria-selected={index === activeIndex}
          className={
            index === activeIndex
              ? "flex cursor-pointer items-baseline justify-between gap-2 rounded-lg bg-muted px-3 py-1.5 text-sm"
              : "flex cursor-pointer items-baseline justify-between gap-2 rounded-lg px-3 py-1.5 text-sm hover:bg-muted"
          }
          role="option"
          // Keep the focus in the editor while the choice is made.
          onMouseDown={(event) => {
            event.preventDefault();
            onPick(item.key);
          }}
        >
          <span className="truncate">{item.label}</span>
          {item.hint ? (
            <span className="shrink-0 text-xs text-muted-foreground">
              {item.hint}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
