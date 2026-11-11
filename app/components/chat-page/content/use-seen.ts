import { useEffect, useState } from "react";

/**
 * Whether an element has been in the visible part of the page once.
 *
 * @param element - The element to watch; `null` until it is mounted.
 * @returns `true` from the first time the element is visible, and from then on.
 */
export function useSeen(element: Element | null): boolean {
  const [isSeen, setSeen] = useState(false);
  useEffect(() => {
    if (!element || isSeen) return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setSeen(true);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, isSeen]);
  return isSeen;
}
