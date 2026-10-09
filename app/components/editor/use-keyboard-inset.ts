import { useEffect, useState } from "react";

/**
 * Measures how much of the layout viewport an on-screen keyboard covers, so
 * a bar at the bottom can sit above the keyboard instead of behind it.
 *
 * @returns The covered height in pixels; 0 without a keyboard or without
 * the Visual Viewport API.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const viewport = window.visualViewport;

    if (!viewport) {
      return undefined;
    }

    const update = (): void => {
      setInset(
        Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop),
      );
    };

    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);

    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, []);

  return inset;
}
