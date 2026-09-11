import { useEffect, useRef, useState } from "react";

import { cn } from "@/app/lib/cn";

import type { ReactNode } from "react";

// Sub-Pixel-Rundungen der Browser sollen am Scroll-Ende keinen Fade erzwingen.
const SCROLL_EDGE_TOLERANCE = 2;

interface HorizontalScrollAreaProps {
  readonly children: ReactNode;
  readonly className?: string;
  readonly viewportClassName?: string;
  readonly contentClassName?: string;
  readonly viewportRef?: { readonly current: HTMLDivElement | null };
  readonly onViewportScroll?: (viewport: HTMLDivElement) => void;
}

/**
 * Renders a horizontally scrollable region with soft edge fades.
 *
 * @remarks
 * Der Fade macht abgeschnittene Inhalte sichtbar, statt sie hart am Rand
 * enden zu lassen: links erscheint er, sobald gescrollt wurde, rechts
 * solange weiterer Inhalt folgt. Beide Overlays sind klickdurchlässig,
 * damit Drag & Drop und Buttons darunter erreichbar bleiben. Über
 * `viewportRef` und `onViewportScroll` können Aufrufer zusätzlich auf
 * Scrollpositionen reagieren, etwa für quasi-endlos nachladende Inhalte.
 */
export function HorizontalScrollArea({
  children,
  className,
  viewportClassName,
  contentClassName,
  viewportRef: externalViewportRef,
  onViewportScroll,
}: HorizontalScrollAreaProps): React.ReactElement {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollCallbackRef = useRef(onViewportScroll);
  scrollCallbackRef.current = onViewportScroll;
  const [hasStartFade, setHasStartFade] = useState(false);
  const [hasEndFade, setHasEndFade] = useState(false);

  // Die Fades hängen an gemessenen Layoutwerten und lassen sich daher
  // nicht aus Props ableiten.
  useEffect(() => {
    const viewport = viewportRef.current as HTMLDivElement;

    if (externalViewportRef) {
      (externalViewportRef as { current: HTMLDivElement | null }).current =
        viewport;
    }

    function updateFades(): void {
      const maxScrollLeft = viewport.scrollWidth - viewport.clientWidth;

      setHasStartFade(viewport.scrollLeft > SCROLL_EDGE_TOLERANCE);
      setHasEndFade(
        viewport.scrollLeft < maxScrollLeft - SCROLL_EDGE_TOLERANCE,
      );
      scrollCallbackRef.current?.(viewport);
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
    <div className={cn("relative min-w-0", className)}>
      <div
        ref={viewportRef}
        className={cn(
          "pages-thin-scrollbar min-w-0 overflow-x-auto overflow-y-hidden",
          viewportClassName,
        )}
      >
        <div ref={contentRef} className={cn("flex", contentClassName)}>
          {children}
        </div>
      </div>

      <div
        aria-hidden="true"
        className={cn(
          "pages-scroll-fade-start pointer-events-none absolute top-0 bottom-2 left-0 w-10 transition-opacity duration-200 sm:w-14",
          hasStartFade ? "opacity-100" : "opacity-0",
        )}
      />
      <div
        aria-hidden="true"
        className={cn(
          "pages-scroll-fade-end pointer-events-none absolute top-0 right-0 bottom-2 w-10 transition-opacity duration-200 sm:w-14",
          hasEndFade ? "opacity-100" : "opacity-0",
        )}
      />
    </div>
  );
}
