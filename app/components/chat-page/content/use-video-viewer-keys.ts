import { useEffect, useRef, useState } from "react";

/** How long the controls of the full screen stay without a movement, in milliseconds. */
export const VIEWER_CONTROLS_IDLE_MILLISECONDS = 3000;

/** How far ← and → move a video, in seconds. */
export const VIEWER_SKIP_SECONDS = 5;

/** What the keys of the full screen do (PAGE-384). */
export interface VideoViewerKeyActions {
  readonly toggle: () => void;
  readonly skip: (seconds: number) => void;
  readonly previous: () => void;
  readonly next: () => void;
  readonly toggleFullscreen: () => void;
  readonly toggleMute: () => void;
  readonly close: () => void;
}

/**
 * The action of one key of the full screen, or `null` for a key it leaves alone.
 *
 * @param event - The key with its modifiers.
 * @param actions - What the keys do.
 */
export function viewerKeyAction(
  event: Pick<
    KeyboardEvent,
    "key" | "shiftKey" | "ctrlKey" | "metaKey" | "altKey"
  >,
  actions: VideoViewerKeyActions,
): (() => void) | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  switch (event.key) {
    case " ":
    case "Spacebar":
      return actions.toggle;
    case "ArrowLeft":
      return event.shiftKey
        ? actions.previous
        : () => actions.skip(-VIEWER_SKIP_SECONDS);
    case "ArrowRight":
      return event.shiftKey
        ? actions.next
        : () => actions.skip(VIEWER_SKIP_SECONDS);
    case "f":
    case "F":
      return actions.toggleFullscreen;
    case "m":
    case "M":
      return actions.toggleMute;
    case "Escape":
      return actions.close;
    default:
      return null;
  }
}

/**
 * The keys of the video full screen (PAGE-384): Space Start/Pause, ← → five
 * seconds, ⇧← ⇧→ the previous or next video, F the full screen of the
 * browser, M the sound and Esc closes.
 *
 * @param actions - What the keys do; read anew on every key.
 */
export function useVideoViewerKeys(actions: VideoViewerKeyActions): void {
  const latest = useRef(actions);
  useEffect(() => {
    latest.current = actions;
  });
  useEffect(() => {
    function handleKey(event: KeyboardEvent): void {
      const action = viewerKeyAction(event, latest.current);
      if (!action) return;
      // Space would also press a focused button and the arrows move a focused slider.
      event.preventDefault();
      action();
    }
    window.addEventListener("keydown", handleKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", handleKey, { capture: true });
  }, []);
}

/**
 * Whether the controls of the full screen show (PAGE-384): after a movement,
 * a touch or a key, and while the video does not play; they fade out after
 * three seconds without a movement.
 *
 * @param isPlaying - Whether the video plays; a paused one keeps its controls.
 * @returns Whether they show, and the handler that shows them again.
 */
export function useIdleControls(isPlaying: boolean): {
  readonly isVisible: boolean;
  readonly wake: () => void;
} {
  const [isIdle, setIdle] = useState(false);
  const [moved, setMoved] = useState(0);
  useEffect(() => {
    if (!isPlaying) return undefined;
    const timer = window.setTimeout(
      () => setIdle(true),
      VIEWER_CONTROLS_IDLE_MILLISECONDS,
    );
    return () => window.clearTimeout(timer);
  }, [isPlaying, moved]);
  useEffect(() => {
    function handleKey(): void {
      setIdle(false);
      setMoved((count) => count + 1);
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);
  return {
    isVisible: !isPlaying || !isIdle,
    wake: () => {
      setIdle(false);
      setMoved((count) => count + 1);
    },
  };
}
