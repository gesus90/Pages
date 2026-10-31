import { useRef, useState } from "react";

import { collectViewerImages } from "@/app/lib/viewer-images";

import type { ViewerImages } from "@/app/lib/viewer-images";

/** What the viewer is showing and how to drive it. */
export interface ImageViewerControls {
  /** The images being paged through, `null` while the viewer is closed. */
  readonly session: ViewerImages | null;
  /** Opens the viewer on an image of rendered text. */
  readonly open: (image: HTMLImageElement) => void;
  readonly select: (index: number) => void;
  readonly close: () => void;
  /** Returns the focus to the control that opened the viewer. */
  readonly restoreFocus: (event: Event) => void;
}

/**
 * The state of an image viewer that opens on an image of rendered text.
 *
 * @remarks
 * The images are read once when the viewer opens, so the set and the order
 * stay stable while a person pages through them, even if the text changes
 * underneath.
 */
export function useImageViewer(): ImageViewerControls {
  const [session, setSession] = useState<ViewerImages | null>(null);
  const trigger = useRef<HTMLElement | null>(null);

  function open(image: HTMLImageElement): void {
    const collected = collectViewerImages(image);

    if (collected) {
      trigger.current = image.closest("button, a") ?? image;
      setSession(collected);
    }
  }

  function select(index: number): void {
    setSession((current) => (current ? { ...current, index } : current));
  }

  function close(): void {
    setSession(null);
  }

  function restoreFocus(event: Event): void {
    // The control may be gone when the text changed meanwhile; the page
    // behind the viewer then keeps the focus it traps anyway.
    event.preventDefault();

    if (trigger.current?.isConnected) {
      trigger.current.focus({ preventScroll: true });
    }
  }

  return { close, open, restoreFocus, select, session };
}
