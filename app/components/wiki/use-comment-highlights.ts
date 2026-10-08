import { useEffect } from "react";

import { findQuoteRange } from "@/app/lib/wiki-highlight";

import type { QuoteReference } from "@/app/lib/wiki-highlight";

/** Name of the highlight that marks commented passages. */
export const COMMENT_HIGHLIGHT = "wiki-comment";

/**
 * Marks the passages that open comments refer to.
 *
 * @param root - The element that holds the rendered page; `null` while the
 * page is being edited.
 * @param quotes - The quoted passages of the open comments.
 *
 * @remarks
 * Uses the CSS Custom Highlight API, which paints ranges without touching the
 * markup, so React keeps full control of the page. Browsers without it show
 * the quote in the comment only.
 */
export function useCommentHighlights(
  root: HTMLElement | null,
  quotes: readonly QuoteReference[],
): void {
  useEffect(() => {
    if (root === null || typeof CSS === "undefined" || !("highlights" in CSS)) {
      return undefined;
    }

    const ranges = quotes.flatMap((quote) => {
      const range = findQuoteRange(root, quote);

      return range ? [range] : [];
    });

    CSS.highlights.set(COMMENT_HIGHLIGHT, new Highlight(...ranges));

    return () => {
      CSS.highlights.delete(COMMENT_HIGHLIGHT);
    };
  }, [root, quotes]);
}
