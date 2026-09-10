import { useEffect, useRef, useState } from "react";

import { cn } from "@/app/lib/cn";

import type { ReactNode } from "react";

// Sub-Pixel-Rundungen der Browser sollen am Scroll-Ende keinen Fade erzwingen.
const SCROLL_EDGE_TOLERANCE = 2;

interface VerticalScrollAreaProps {
  readonly children: ReactNode;
  readonly className?: string;
  readonly viewportClassName?: string;
  readonly contentClassName?: string;
}

/**
 * Renders a vertically scrollable region with soft top and bottom fades.
 *
 * @remarks
 * Gegenstück zu {@link HorizontalScrollArea}: Inhalt, der oberhalb oder
 * unterhalb des Sichtbereichs liegt, endet als weicher Verlauf statt an einer
 * harten Kante. Die Fades erscheinen nur, wenn in der jeweiligen Richtung
 * wirklich weiterer Inhalt existiert, und sind klickdurchlässig, damit
 * darunterliegende Bedienelemente erreichbar bleiben. Die Verlaufsfarbe folgt
 * `--scroll-fade-channels`, das der aufrufende Container auf seinen eigenen
 * Hintergrund setzen kann.
 */
export function VerticalScrollArea({
  children,
  className,
  viewportClassName,
  contentClassName,
}: VerticalScrollAreaProps): React.ReactElement {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [hasTopFade, setHasTopFade] = useState(false);
  const [hasBottomFade, setHasBottomFade] = useState(false);

  // Die Fades hängen an gemessenen Layoutwerten und lassen sich daher
  // nicht aus Props ableiten.
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
    observer.observe(contentRef.current as HTMLDivElement);

    return () => {
      viewport.removeEventListener("scroll", updateFades);
      observer.disconnect();
    };
  }, []);

  return (
    <div className={cn("relative flex min-h-0 min-w-0 flex-col", className)}>
      <div
        ref={viewportRef}
        className={cn(
          "pages-hover-scrollbar min-h-0 flex-1 overflow-x-hidden overflow-y-auto",
          viewportClassName,
        )}
      >
        <div ref={contentRef} className={cn("flex flex-col", contentClassName)}>
          {children}
        </div>
      </div>

      <div
        aria-hidden="true"
        className={cn(
          "pages-scroll-fade-top pointer-events-none absolute top-0 right-0 left-0 h-8 transition-opacity duration-200",
          hasTopFade ? "opacity-100" : "opacity-0",
        )}
      />
      <div
        aria-hidden="true"
        className={cn(
          "pages-scroll-fade-bottom pointer-events-none absolute right-0 bottom-0 left-0 h-8 transition-opacity duration-200",
          hasBottomFade ? "opacity-100" : "opacity-0",
        )}
      />
    </div>
  );
}
