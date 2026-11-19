import { useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigation, useNavigationType } from "react-router";

import { scrollMaskStyle } from "@/app/components/ui/scroll-viewport/scroll-mask";

import type { CSSProperties, ReactNode, UIEvent } from "react";

/** Length in CSS pixels of the fade at the upper edge of the scrolled page. */
const PAGE_FADE_SIZE = 28;

const MAX_REMEMBERED_POSITIONS = 100;

/** The scroll offsets of the pages left behind, by history entry. */
const rememberedPositions = new Map<string, number>();

const FADED_TOP_STYLE: CSSProperties = scrollMaskStyle(
  { top: true, bottom: false, left: false, right: false },
  { fadeEdges: ["top"], fadeTop: PAGE_FADE_SIZE },
);

interface PageScrollAreaProps {
  readonly children: ReactNode;
}

function rememberPosition(historyKey: string, top: number): void {
  rememberedPositions.delete(historyKey);
  rememberedPositions.set(historyKey, top);
  if (rememberedPositions.size <= MAX_REMEMBERED_POSITIONS) return;
  const oldest = rememberedPositions.keys().next();
  if (!oldest.done) rememberedPositions.delete(oldest.value);
}

/**
 * Keeps the scroll position of the page area across navigation.
 * @remarks
 * The page area scrolls instead of the window, so the router's own scroll
 * restoration does not reach it. Going back restores the remembered offset, a
 * link to an address with a fragment scrolls to its target, and another page
 * starts at the top. A change of the search part keeps the offset.
 */
function usePageScroll(): {
  readonly pageRef: React.RefObject<HTMLElement | null>;
  readonly isScrolled: boolean;
  readonly handleScroll: (event: UIEvent<HTMLElement>) => void;
} {
  const { key, pathname, hash } = useLocation();
  const navigationType = useNavigationType();
  const isIdle = useNavigation().state === "idle";
  const pageRef = useRef<HTMLElement | null>(null);
  const shownKey = useRef(key);
  const shownPathname = useRef<string | null>(null);
  const [isScrolled, setIsScrolled] = useState(false);

  useLayoutEffect(() => {
    const isNewPage = shownPathname.current !== pathname;
    shownKey.current = key;
    shownPathname.current = pathname;
    const page = pageRef.current;
    if (!page) return;
    const remembered = rememberedPositions.get(key);
    if (navigationType === "POP" && remembered !== undefined) {
      page.scrollTop = remembered;
      return;
    }
    const target = hash ? document.getElementById(hash.slice(1)) : null;
    if (target) {
      target.scrollIntoView();
      return;
    }
    if (isNewPage) page.scrollTop = 0;
  }, [key, pathname, hash, navigationType]);

  function handleScroll(event: UIEvent<HTMLElement>): void {
    const top = event.currentTarget.scrollTop;
    // While the next page loads, the page shown may shrink and the browser
    // moves its offset; the offset from before the navigation stays.
    if (isIdle) rememberPosition(shownKey.current, top);
    setIsScrolled(top > 0);
  }

  return { pageRef, isScrolled, handleScroll };
}

/**
 * The scrolling area of the authenticated pages, between the lower edge of the
 * header and the lower edge of the window.
 * @remarks
 * Its scrollbar starts below the header, which stays in place. At the top the
 * page keeps its distance to the header; once the page is scrolled, its content
 * fades out over the upper edge.
 */
export function PageScrollArea({
  children,
}: PageScrollAreaProps): React.ReactElement {
  const { pageRef, isScrolled, handleScroll } = usePageScroll();

  return (
    <main
      ref={pageRef}
      className="pages-scroll-viewport pages-scroll-vertical min-h-0 flex-1 overflow-y-auto px-4 pt-5 pb-10 md:pr-8 md:pl-(--app-content-start) xl:pr-10"
      style={isScrolled ? FADED_TOP_STYLE : undefined}
      onScroll={handleScroll}
    >
      {children}
    </main>
  );
}
