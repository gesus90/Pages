import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";

/** The intent that stores whether the list is collapsed (PAGE-325). */
export const LIST_COLLAPSED_INTENT = "list-collapsed";

/** Below this viewport width the page shows its selection instead of the list. */
const LIST_MINIMUM_VIEWPORT = "(min-width: 768px)";

/** The state of the list card of the chat page and the ways to change it. */
export interface ChatListCollapse {
  readonly isCollapsed: boolean;
  /** Collapses an expanded list and expands a collapsed one, and stores it. */
  readonly toggle: () => void;
  /** Expands the list and stores it; nothing happens when it is expanded. */
  readonly expand: () => void;
}

/**
 * Recognizes `Ctrl+Shift+L`, on a Mac `⌘⇧L`, which collapses and expands
 * the list (PAGE-325).
 *
 * @param event - The pressed keys.
 */
export function isListShortcut(
  event: Pick<
    KeyboardEvent,
    "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey"
  >,
): boolean {
  return (
    (event.ctrlKey || event.metaKey) &&
    event.shiftKey &&
    !event.altKey &&
    event.key.toLowerCase() === "l"
  );
}

function isListShown(): boolean {
  return window.matchMedia(LIST_MINIMUM_VIEWPORT).matches;
}

/**
 * Whether the list card of the chat page is collapsed to its bar of
 * avatars, kept per person in the view settings of the chat page like the
 * width of the split view (PAGE-325).
 *
 * @remarks
 * The shortcut also works in the input; the page listens in the capture
 * phase so the editor cannot swallow it. Below 768 px there is no list and
 * the shortcut does nothing.
 *
 * @param stored - The state the person chose last.
 */
export function useChatListCollapse(stored: boolean): ChatListCollapse {
  const saver = useFetcher();
  const [isCollapsed, setIsCollapsed] = useState(stored);
  const current = useRef(isCollapsed);
  const submit = useRef(saver.submit);
  useEffect(() => {
    submit.current = saver.submit;
  }, [saver.submit]);

  const change = useRef((next: boolean): void => {
    if (current.current === next) return;
    current.current = next;
    setIsCollapsed(next);
    const formData = new FormData();
    formData.set("intent", LIST_COLLAPSED_INTENT);
    formData.set("isCollapsed", String(next));
    void submit.current(formData, { method: "post" });
  });

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.repeat || !isListShortcut(event) || !isListShown()) return;
      event.preventDefault();
      event.stopPropagation();
      change.current(!current.current);
    }
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, []);

  return {
    isCollapsed,
    toggle: () => change.current(!current.current),
    expand: () => change.current(false),
  };
}
