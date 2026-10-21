import { useMemo } from "react";

import { ScrollFades } from "./scroll-fades";
import { useScrollEdges } from "./use-scroll-edges";

/** Decorates browser/editor-owned markup without changing its DOM or input behavior. */
export function NativeScrollFades({
  viewport,
  container,
}: {
  readonly viewport: HTMLElement;
  readonly container: HTMLElement;
}): React.ReactElement {
  const viewportRef = useMemo(() => ({ current: viewport }), [viewport]);
  const containerRef = useMemo(() => ({ current: container }), [container]);
  const edges = useScrollEdges(viewportRef, containerRef);
  return <ScrollFades edges={edges} />;
}
