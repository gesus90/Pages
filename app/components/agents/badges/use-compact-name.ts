import { useLayoutEffect, useRef, useState } from "react";

import type { RefObject } from "react";

/** The name a badge shows and the element that shows it. */
interface CompactName {
  /** The element of the visible name; its overflow decides the short form. */
  readonly ref: RefObject<HTMLSpanElement | null>;
  /** The full name while it fits, otherwise the short one. */
  readonly shown: string;
}

/**
 * Shows the full name of a badge while it fits and the short one otherwise.
 * @param full - The complete name, such as `Gemini 4 Argon`.
 * @param compact - The name without its first word, such as `4 Argon`.
 * @returns The ref to set on the visible name and the name to show.
 * @remarks
 * The full name renders first, cut with an ellipsis by its element; when it
 * overflows there, the short name takes its place before the browser
 * paints. The decision belongs to the full name it was made for, so another
 * name starts again with its full form. A short name that still does not fit
 * keeps the ellipsis. The server renders the full name.
 */
export function useCompactName(full: string, compact: string): CompactName {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [compactFor, setCompactFor] = useState<string | null>(null);
  const isCompact = compactFor === full && compact !== full;

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || compact === full || compactFor === full) return;
    if (element.scrollWidth > element.clientWidth) setCompactFor(full);
  }, [full, compact, compactFor]);

  return { ref, shown: isCompact ? compact : full };
}
