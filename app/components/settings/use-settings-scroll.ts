import { useLayoutEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router";

import type { RefObject, UIEvent } from "react";

/** How many visited settings pages remember their scroll position. */
const MAX_REMEMBERED_POSITIONS = 100;

/** The last scroll position of each visited settings page, by its history entry. */
const rememberedPositions = new Map<string, number>();

/** The scroll position of the settings and how it is remembered. */
interface SettingsScroll {
  readonly viewportRef: RefObject<HTMLElement | null>;
  readonly onScroll: (event: UIEvent<HTMLElement>) => void;
}

function rememberPosition(historyKey: string, top: number): void {
  rememberedPositions.delete(historyKey);
  rememberedPositions.set(historyKey, top);
  if (rememberedPositions.size <= MAX_REMEMBERED_POSITIONS) return;
  const oldest = rememberedPositions.keys().next();
  if (!oldest.done) rememberedPositions.delete(oldest.value);
}

/**
 * Starts every newly opened settings page at the top and puts back the position of a page reached through the browser history.
 * @remarks
 * The position is set before the new page is painted, so the page never
 * shows at the position of the previous one. A change of the address that
 * stays on the same page, such as its query, keeps the position.
 * @returns The ref and the scroll handler of the settings' scrolling element.
 */
export function useSettingsScroll(): SettingsScroll {
  const { key, pathname } = useLocation();
  const navigationType = useNavigationType();
  const viewportRef = useRef<HTMLElement | null>(null);
  const shownKey = useRef(key);
  const shownPathname = useRef<string | null>(null);

  useLayoutEffect(() => {
    const isNewPage = shownPathname.current !== pathname;
    shownKey.current = key;
    shownPathname.current = pathname;
    const viewport = viewportRef.current;
    if (!viewport) return;
    const remembered = rememberedPositions.get(key);
    if (navigationType === "POP" && remembered !== undefined) {
      viewport.scrollTop = remembered;
      return;
    }
    if (isNewPage) viewport.scrollTop = 0;
  }, [key, pathname, navigationType]);

  function handleScroll(event: UIEvent<HTMLElement>): void {
    rememberPosition(shownKey.current, event.currentTarget.scrollTop);
  }

  return { viewportRef, onScroll: handleScroll };
}
