import type { TerminalScreenReaderMode } from "@/definition/Settings";

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
 * @param mode - The person's setting.
 * @returns For `auto`, `true` unless the console was opened with a pointer:
 * keyboard use and the clicks of a screen reader come without one.
 */
export function resolveScreenReaderMode(
  mode: TerminalScreenReaderMode,
): boolean {
  if (mode !== "auto") return mode === "on";
  return lastInteraction !== "pointer";
}
