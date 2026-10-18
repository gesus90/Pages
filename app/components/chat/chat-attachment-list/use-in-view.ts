import { useEffect, useRef, useState } from "react";

import type { RefObject } from "react";

/**
 * Tells once an element came near the visible part of its scroll container.
 *
 * @remarks
 * Previews load only then, so a long conversation with many files stays
 * fast. Without `IntersectionObserver`, as on the server, nothing loads.
 */
export function useInView<Element extends HTMLElement>(): {
  readonly ref: RefObject<Element | null>;
  readonly isInView: boolean;
} {
  const ref = useRef<Element | null>(null);
  const [isInView, setIsInView] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (isInView || element === null || !("IntersectionObserver" in window))
      return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setIsInView(true);
      },
      { rootMargin: "200px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [isInView]);

  return { ref, isInView };
}
