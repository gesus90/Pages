import { useEffect, useState } from "react";

/**
 * Whether an element shows on the whole screen now, as "Vollbild" of a
 * card made it.
 * @param element - The element that asks for the full screen.
 * @returns `true` while that element is the full-screen element.
 */
export function useFullscreenElement(
  element: React.RefObject<HTMLElement | null>,
): boolean {
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    function handleChange(): void {
      setIsFullscreen(
        element.current !== null &&
          document.fullscreenElement === element.current,
      );
    }
    document.addEventListener("fullscreenchange", handleChange);
    return () => document.removeEventListener("fullscreenchange", handleChange);
  }, [element]);
  return isFullscreen;
}
