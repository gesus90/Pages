import { useEffect, useSyncExternalStore } from "react";

/** How many open surfaces ask to hide Pica's symbol right now. */
let hidingSurfaces = 0;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function isHidden(): boolean {
  return hidingSurfaces > 0;
}

function isHiddenOnServer(): boolean {
  return false;
}

/**
 * Hides Pica's symbol while the calling component is mounted (PAGE-283).
 *
 * @remarks
 * A fullscreen surface whose lower right corner holds controls, such as the
 * terminal of the agent plan, calls it; the symbol comes back when the last
 * such surface closes. Every other page keeps the symbol.
 */
export function useHidePicaLauncher(): void {
  useEffect(() => {
    hidingSurfaces += 1;
    notify();
    return () => {
      hidingSurfaces -= 1;
      notify();
    };
  }, []);
}

/** Whether an open surface hides Pica's symbol; the server always shows it. */
export function useIsPicaLauncherHidden(): boolean {
  return useSyncExternalStore(subscribe, isHidden, isHiddenOnServer);
}
