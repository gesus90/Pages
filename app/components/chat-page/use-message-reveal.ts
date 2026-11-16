import { useEffect, useRef, useState } from "react";

import { messageElement } from "./content/chat-image-viewer";

/** The history the reveal pages through. */
interface RevealHistory {
  /** Changes whenever the shown messages change. */
  readonly messageCount: number;
  readonly hasOlder: boolean;
  readonly isLoadingOlder: boolean;
  loadOlder(): void;
}

/**
 * Brings a message of the opened history into view: "Zur
 * Nachricht" of "Medien & Dateien" scrolls to it and gives it the focus.
 * @remarks
 * A message older than the loaded pages is reached by loading one older page
 * after the other until it is there; when no older page is left, the view
 * stays as it is.
 * @param history - The shown messages and the way to load older ones.
 * @returns Starts the way to a message.
 */
export function useMessageReveal(
  history: RevealHistory,
): (messageId: string) => void {
  const [wanted, setWanted] = useState<string | null>(null);
  // The count of shown messages the last older page was asked for at, so one page is asked once.
  const requestedAt = useRef<number | null>(null);
  const { messageCount, hasOlder, isLoadingOlder, loadOlder } = history;

  useEffect(() => {
    if (wanted === null) return;
    const element = messageElement(wanted);
    if (element) {
      element.scrollIntoView({ block: "center", behavior: "smooth" });
      element.focus({ preventScroll: true });
      setWanted(null);
      return;
    }
    if (isLoadingOlder) return;
    if (!hasOlder) {
      setWanted(null);
      return;
    }
    if (requestedAt.current === messageCount) return;
    requestedAt.current = messageCount;
    loadOlder();
  }, [wanted, messageCount, hasOlder, isLoadingOlder, loadOlder]);

  function reveal(messageId: string): void {
    requestedAt.current = null;
    setWanted(messageId);
  }

  return reveal;
}
