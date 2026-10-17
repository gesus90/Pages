import { useEffect, useState } from "react";

/**
 * How far an on-screen keyboard covers the bottom of the layout viewport, in pixels.
 *
 * @remarks
 * Mobile browsers lay a keyboard over fixed elements instead of shrinking
 * them; the visual viewport tells how much of the page stays visible.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return undefined;
    const visible = viewport;
    function update(): void {
      setInset(
        Math.max(
          0,
          Math.round(window.innerHeight - visible.height - visible.offsetTop),
        ),
      );
    }
    update();
    visible.addEventListener("resize", update);
    visible.addEventListener("scroll", update);
    return () => {
      visible.removeEventListener("resize", update);
      visible.removeEventListener("scroll", update);
    };
  }, []);
  return inset;
}
