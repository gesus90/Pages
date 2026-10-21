import { cn } from "@/app/lib/cn";

import type { ScrollEdges } from "./scroll-edges";

/** Decorative, pointer-transparent edges that never cover the native scrollbars. */
export function ScrollFades({
  edges,
  className,
}: {
  readonly edges: ScrollEdges;
  readonly className?: string;
}): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "pages-scroll-fades pointer-events-none absolute",
        className,
      )}
      style={edges.style}
    >
      {(["top", "bottom", "left", "right"] as const).map((edge) => (
        <span
          key={edge}
          data-scroll-fade={edge}
          className={cn(
            `pages-scroll-fade-${edge}`,
            edges[edge] ? "opacity-100" : "opacity-0",
          )}
        />
      ))}
    </span>
  );
}
