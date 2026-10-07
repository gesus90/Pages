import { useEffect, useRef, useState } from "react";

import type { ReactNode } from "react";

// Sub-Pixel-Rundungen der Browser sollen am Scroll-Ende keinen Fade erzwingen.
const SCROLL_EDGE_TOLERANCE = 2;

interface ProjectGridScrollAreaProps {
  readonly children: ReactNode;
}

/**
 * Renders the project grid inside a bounded scroll viewport with edge fades.
 *
 * @remarks
 * Inhalt, der oberhalb oder unterhalb des Sichtbereichs liegt, endet als
 * kurzer, weicher Verlauf statt an einer harten Kante. Die Fades erscheinen
 * nur, wenn in der jeweiligen Richtung wirklich weiterer Inhalt existiert,
 * und sind klickdurchlässig, damit darunterliegende Karten erreichbar
 * bleiben. Zwischen Kartengrid und Scrollbar liegt eine Gutter, sodass die
 * Scrollbar an der Außenkante des Containers sitzt und nie in den Karten.
 */
export function ProjectGridScrollArea({
  children,
}: ProjectGridScrollAreaProps): React.ReactElement {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [hasTopFade, setHasTopFade] = useState(false);
  const [hasBottomFade, setHasBottomFade] = useState(false);

  // Die Fades hängen an gemessenen Layoutwerten und lassen sich daher nicht
  // aus Props ableiten.
  useEffect(() => {
    const viewport = viewportRef.current as HTMLDivElement;

    function updateFades(): void {
      const maxScrollTop = viewport.scrollHeight - viewport.clientHeight;

      setHasTopFade(viewport.scrollTop > SCROLL_EDGE_TOLERANCE);
      setHasBottomFade(
        viewport.scrollTop < maxScrollTop - SCROLL_EDGE_TOLERANCE,
      );
    }

    updateFades();
    viewport.addEventListener("scroll", updateFades, { passive: true });

    if (typeof ResizeObserver === "undefined") {
      return () => {
        viewport.removeEventListener("scroll", updateFades);
      };
    }

    const observer = new ResizeObserver(updateFades);
    observer.observe(viewport);
    observer.observe(viewport.firstElementChild as Element);

    return () => {
      viewport.removeEventListener("scroll", updateFades);
      observer.disconnect();
    };
  }, []);

  return (
    <div className="relative mt-8 min-h-0 flex-1">
      <div
        ref={viewportRef}
        className="pages-hover-scrollbar h-full overflow-x-hidden overflow-y-auto overscroll-contain"
      >
        <div className="pt-2 pr-4 pb-8 pl-2">{children}</div>
      </div>
      <div
        aria-hidden="true"
        className={`pages-scroll-fade-top pointer-events-none absolute inset-x-0 top-0 h-6 transition-opacity duration-200 ${
          hasTopFade ? "opacity-100" : "opacity-0"
        }`}
      />
      <div
        aria-hidden="true"
        className={`pages-scroll-fade-bottom pointer-events-none absolute inset-x-0 bottom-0 h-6 transition-opacity duration-200 ${
          hasBottomFade ? "opacity-100" : "opacity-0"
        }`}
      />
    </div>
  );
}
