import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { useFloatingStyle } from "@/app/components/editor/menus/use-floating-style";
import { cn } from "@/app/lib/cn";

import type { Editor } from "@tiptap/core";
import type { SuggestionStore } from "@/app/components/editor/menus/suggestion-store";

interface SuggestionMenuProps<Item> {
  readonly editor: Editor;
  readonly store: SuggestionStore<Item>;
  /** Identifier of the list, for the editor's `aria-activedescendant`. */
  readonly id: string;
  readonly label: string;
  readonly emptyLabel: string;
  readonly getKey: (item: Item) => string;
  readonly renderItem: (item: Item) => React.ReactNode;
  readonly isEnabled?: (item: Item) => boolean;
  /** Heading shown above the first item of each group. */
  readonly groupLabel?: (item: Item) => string;
}

/** Tells assistive technology which entry of the open menu is highlighted. */
function useActiveDescendant(
  editor: Editor,
  listId: string,
  activeId: string | null,
): void {
  useEffect(() => {
    const element = editor.view.dom;

    if (activeId === null) {
      return undefined;
    }

    element.setAttribute("aria-controls", listId);
    element.setAttribute("aria-activedescendant", activeId);
    element.setAttribute("aria-expanded", "true");
    document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });

    return () => {
      element.removeAttribute("aria-controls");
      element.removeAttribute("aria-activedescendant");
      element.removeAttribute("aria-expanded");
    };
  }, [editor, listId, activeId]);
}

/**
 * The list under the caret that a trigger such as `/` opens. Focus stays in
 * the editor; arrows, Enter and Escape reach the list through the store.
 */
export function SuggestionMenu<Item>({
  editor,
  store,
  id,
  label,
  emptyLabel,
  getKey,
  renderItem,
  isEnabled = () => true,
  groupLabel,
}: SuggestionMenuProps<Item>): React.ReactElement | null {
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    () => null,
  );
  const [element, setElement] = useState<HTMLElement | null>(null);
  const style = useFloatingStyle(element, snapshot?.rect ?? null);
  const activeId =
    snapshot && snapshot.items.length > 0
      ? `${id}-${snapshot.activeIndex}`
      : null;

  useActiveDescendant(editor, id, activeId);

  if (!snapshot) {
    return null;
  }

  return createPortal(
    <div
      ref={setElement}
      className="pages-floating-panel z-50 max-h-80 w-72 overflow-y-auto p-1"
      style={style}
    >
      <ul aria-label={label} id={id} role="listbox">
        {snapshot.items.map((item, index) => {
          const group = groupLabel?.(item);
          const previous = snapshot.items[index - 1];
          const showGroup =
            group !== undefined &&
            (previous === undefined || groupLabel?.(previous) !== group);

          return (
            <li key={getKey(item)} role="presentation">
              {showGroup ? (
                <p className="px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground">
                  {group}
                </p>
              ) : null}
              <div
                aria-disabled={!isEnabled(item)}
                aria-selected={index === snapshot.activeIndex}
                className={cn(
                  "flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-3 text-sm",
                  index === snapshot.activeIndex && "bg-muted",
                  !isEnabled(item) && "cursor-default text-muted-foreground",
                )}
                id={`${id}-${index}`}
                role="option"
                onClick={() => store.pick(index)}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => store.highlight(index)}
              >
                {renderItem(item)}
              </div>
            </li>
          );
        })}
      </ul>
      {snapshot.items.length === 0 ? (
        <p className="px-3 py-2 text-sm text-muted-foreground" role="status">
          {emptyLabel}
        </p>
      ) : null}
    </div>,
    document.body,
  );
}
