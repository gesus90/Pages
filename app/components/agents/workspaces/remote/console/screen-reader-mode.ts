let lastInteraction: "pointer" | "keyboard" | null = null;

// The console opens from a menu, so the interaction before it tells how.
if (typeof document !== "undefined") {
  document.addEventListener(
    "pointerdown",
    () => {
      lastInteraction = "pointer";
    },
    { capture: true, passive: true },
  );
  document.addEventListener(
    "keydown",
    () => {
      lastInteraction = "keyboard";
    },
    { capture: true, passive: true },
  );
}

/**
 * Whether a new terminal keeps an accessible copy of its screen.
 *
 * @returns `true` unless the console was opened with a pointer: keyboard use
 * and the clicks of a screen reader come without one.
 */
export function resolveScreenReaderMode(): boolean {
  return lastInteraction !== "pointer";
}
