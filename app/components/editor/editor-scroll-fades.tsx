import { useEffect, useState } from "react";

import { NativeScrollFades } from "@/app/components/ui/scroll-viewport/native-scroll-fades";

/** Finds editor-owned scroll surfaces while leaving ProseMirror's DOM untouched. */
export function EditorScrollFades({
  container,
}: {
  readonly container: HTMLElement | null;
}): React.ReactElement | null {
  const [viewports, setViewports] = useState<readonly HTMLElement[]>([]);
  useEffect(() => {
    if (!container) return;
    function discover(): void {
      const next = Array.from(
        (container as HTMLElement).querySelectorAll<HTMLElement>(
          "pre, .tableWrapper, .ProseMirror",
        ),
      ).filter(
        (element) =>
          /auto|scroll/.test(getComputedStyle(element).overflow) &&
          !element.classList.contains("pages-scroll-viewport"),
      );
      setViewports((previous) =>
        previous.length === next.length &&
        previous.every((element, index) => element === next[index])
          ? previous
          : next,
      );
    }
    discover();
    const observer = new MutationObserver(discover);
    observer.observe(container, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [container]);
  if (!container) return null;
  return (
    <>
      {viewports.map((viewport, index) => (
        <NativeScrollFades
          key={index}
          viewport={viewport}
          container={container}
        />
      ))}
    </>
  );
}
