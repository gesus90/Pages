import { useEffect, useState } from "react";

import { readSelectionQuote } from "@/app/lib/wiki-highlight";

import type { QuoteReference } from "@/app/lib/wiki-highlight";

/**
 * Follows what the person selects inside the rendered page.
 *
 * @param root - The element that holds the rendered page; `null` while the
 * page is being edited.
 * @returns The selected passage with its surroundings, or `null` while
 * nothing inside the page is selected.
 */
export function useWikiSelection(
  root: HTMLElement | null,
): QuoteReference | null {
  const [selection, setSelection] = useState<QuoteReference | null>(null);

  useEffect(() => {
    if (root === null) {
      return undefined;
    }

    const update = (): void => {
      setSelection(readSelectionQuote(root, window.getSelection()));
    };

    document.addEventListener("selectionchange", update);

    return () => {
      document.removeEventListener("selectionchange", update);
      setSelection(null);
    };
  }, [root]);

  return selection;
}
