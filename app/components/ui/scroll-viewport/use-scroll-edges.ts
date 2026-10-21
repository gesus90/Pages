import { useEffect, useRef, useState } from "react";

import { observeScrollEdges } from "./observe-scroll-edges";

import type { RefObject } from "react";
import type { ScrollEdges } from "./scroll-edges";

const EMPTY_EDGES: ScrollEdges = {
  top: false,
  bottom: false,
  left: false,
  right: false,
  style: {},
};

/** Shares the measured native edge states with React, updating only when they change. */
export function useScrollEdges(
  viewportRef: RefObject<HTMLElement | null>,
  containerRef: RefObject<HTMLElement | null>,
  onMeasure?: (viewport: HTMLElement) => void,
): ScrollEdges {
  const [edges, setEdges] = useState(EMPTY_EDGES);
  const callback = useRef(onMeasure);
  callback.current = onMeasure;
  useEffect(() => {
    const viewport = viewportRef.current;
    const container = containerRef.current;
    if (!viewport || !container) return;
    return observeScrollEdges(
      viewport,
      container,
      (next) =>
        setEdges((previous) =>
          JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
        ),
      (element) => callback.current?.(element),
    );
  }, [containerRef, viewportRef]);
  return edges;
}
