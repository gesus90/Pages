import { useEffect, useEffectEvent } from "react";

/** Ctrl+S, or Cmd+S on macOS, without the modifiers of other shortcuts. */
function isSaveShortcut(event: KeyboardEvent): boolean {
  return (
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === "s"
  );
}

/**
 * Saves the plan with Ctrl+S or Cmd+S while the editor is open, wherever the focus is.
 *
 * @remarks
 * The browser never saves the page instead, and a held key saves only once.
 * Saving stays explicit: nothing is stored without the shortcut.
 */
export function usePlanSaveShortcut(onSave: () => void): void {
  const handleKeyDown = useEffectEvent((event: KeyboardEvent): void => {
    if (event.isComposing || !isSaveShortcut(event)) return;
    event.preventDefault();
    if (!event.repeat) onSave();
  });
  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}
