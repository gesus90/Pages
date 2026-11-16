import { useEffect, useRef } from "react";

/** How long a message the link pointed to stays marked, in milliseconds. */
const MARK_MILLISECONDS = 4_000;

/** How many older pages the history loads at most to find the message. */
const MAXIMUM_OLDER_PAGES = 10;

/** The attribute that marks the message a link pointed to. */
export const MESSAGE_FOCUS_ATTRIBUTE = "data-message-focus";

/** The older pages of the history the focus may load. */
interface FocusOlderPages {
  readonly hasMore: boolean;
  readonly isLoading: boolean;
  readonly onLoad: () => void;
}

/** Finds the element of a message inside the history by its ID. */
function messageElement(
  viewport: HTMLElement,
  messageId: string,
): HTMLElement | null {
  for (const element of viewport.querySelectorAll<HTMLElement>(
    "[data-message-id]",
  ))
    if (element.dataset.messageId === messageId) return element;
  return null;
}

/**
 * Scrolls the history to the message a "Zur Nachricht" link names
 * and marks it for a moment.
 * @remarks
 * A message outside the loaded part makes the history load older pages, at
 * most {@link MAXIMUM_OLDER_PAGES}; a message that is not found (deleted, or
 * older than that) leaves the history at its end.
 * @param viewport - The scroll area of the history.
 * @param focus - The message ID of the link, the IDs shown and the older pages.
 */
export function useMessageFocus(
  viewport: React.RefObject<HTMLElement | null>,
  focus: {
    readonly messageId: string | undefined;
    readonly messageIds: readonly string[];
    readonly older: FocusOlderPages;
  },
): void {
  const { messageId, messageIds, older } = focus;
  const handled = useRef<string | null>(null);
  const loadedPages = useRef(0);
  const isShown = messageId !== undefined && messageIds.includes(messageId);
  const canLoad = older.hasMore && !older.isLoading;
  const { onLoad } = older;

  useEffect(() => {
    if (messageId === undefined || isShown || !canLoad) return;
    if (handled.current === messageId) return;
    if (loadedPages.current >= MAXIMUM_OLDER_PAGES) return;
    loadedPages.current += 1;
    onLoad();
  }, [messageId, isShown, canLoad, onLoad]);

  useEffect(() => {
    const element = viewport.current;
    if (!element || messageId === undefined || !isShown) return undefined;
    if (handled.current === messageId) return undefined;
    const target = messageElement(element, messageId);
    if (!target) return undefined;
    handled.current = messageId;
    loadedPages.current = 0;
    target.scrollIntoView({ block: "center" });
    target.setAttribute(MESSAGE_FOCUS_ATTRIBUTE, "true");
    const timer = window.setTimeout(() => {
      target.removeAttribute(MESSAGE_FOCUS_ATTRIBUTE);
    }, MARK_MILLISECONDS);
    return () => {
      window.clearTimeout(timer);
      target.removeAttribute(MESSAGE_FOCUS_ATTRIBUTE);
    };
  }, [viewport, messageId, isShown]);
}
