import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useRef } from "react";
import { useTranslation } from "react-i18next";

import { stepViewerIndex } from "@/app/lib/viewer-images";

import { ViewerHeader, ViewerSteps } from "./image-viewer/viewer-controls";
import { ViewerStage } from "./image-viewer/viewer-stage";

import type { ViewerImage } from "@/app/lib/viewer-images";

interface ImageViewerProps {
  readonly images: readonly ViewerImage[];
  /** Position of the image being shown. */
  readonly index: number;
  readonly onIndexChange: (index: number) => void;
  readonly onClose: () => void;
  /** Called when the viewer has closed; it may place the focus itself. */
  readonly onCloseAutoFocus?: (event: Event) => void;
  /**
   * Replaces the head with position, caption and close (PAGE-382); it must
   * offer a way to close.
   */
  readonly header?: React.ReactNode;
  /** Shown below the image, such as a strip of all images of a chat. */
  readonly footer?: React.ReactNode;
}

/** The shortest horizontal swipe that pages, in pixels. */
const SWIPE_DISTANCE = 50;

/** Whether a key press belongs to the browser or the system, not to paging. */
function hasModifier(event: React.KeyboardEvent): boolean {
  return event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;
}

/** Horizontal paging direction of a touch swipe, or `null` when too short/vertical. */
function swipeDirection(
  start: { readonly x: number; readonly y: number } | null,
  touch: React.Touch | undefined,
): -1 | 1 | null {
  if (!start || !touch) return null;
  const distance = touch.clientX - start.x;
  if (Math.abs(distance) < SWIPE_DISTANCE) return null;
  if (Math.abs(distance) < Math.abs(touch.clientY - start.y)) return null;
  return distance > 0 ? -1 : 1;
}

function useViewerInput(context: {
  readonly index: number;
  readonly count: number;
  readonly hasNavigation: boolean;
  readonly onIndexChange: (index: number) => void;
  readonly onClose: () => void;
  readonly content: React.RefObject<HTMLDivElement | null>;
}): {
  readonly step: (direction: -1 | 1) => void;
  readonly handleTouchStart: (event: React.TouchEvent) => void;
  readonly handleTouchEnd: (event: React.TouchEvent) => void;
  readonly handleKeyDown: (event: React.KeyboardEvent) => void;
} {
  const { index, count, hasNavigation, onIndexChange, onClose, content } =
    context;
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  function step(direction: -1 | 1): void {
    const target = stepViewerIndex(index, count, direction);
    if (target === null) return;
    onIndexChange(target);
    // Focus stays inside the dialog when the used arrow turns unavailable.
    if (stepViewerIndex(target, count, direction) === null)
      content.current?.focus();
  }

  function handleTouchStart(event: React.TouchEvent): void {
    const touch = event.touches[0];
    touchStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
  }

  function handleTouchEnd(event: React.TouchEvent): void {
    const start = touchStart.current;
    touchStart.current = null;
    if (!hasNavigation) return;
    const direction = swipeDirection(start, event.changedTouches[0]);
    if (direction !== null) step(direction);
  }

  function handleKeyDown(event: React.KeyboardEvent): void {
    if (event.key === "Escape") {
      onClose();
      return;
    }
    if (!hasNavigation || hasModifier(event)) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      step(event.key === "ArrowLeft" ? -1 : 1);
    }
  }

  return { step, handleTouchStart, handleTouchEnd, handleKeyDown };
}

/**
 * A full-screen viewer for one image of a list, with arrows and the arrow
 * keys to page through the list.
 *
 * @remarks
 * A modal dialog, so it traps the focus, closes on Escape and hands the focus
 * back. It sits above whatever dialog it opened from. A single image has no
 * navigation. An image that cannot load or is no longer there is reported in
 * its place and the other images stay reachable. On a touch screen a
 * horizontal swipe pages. The chat gives it a head and a strip of its own
 * (PAGE-382).
 */
export function ImageViewer({
  images,
  index,
  onIndexChange,
  onClose,
  onCloseAutoFocus,
  header,
  footer,
}: ImageViewerProps): React.ReactElement | null {
  const { t } = useTranslation();
  const content = useRef<HTMLDivElement>(null);
  const count = images.length;
  const hasNavigation = count > 1;
  const { step, handleTouchStart, handleTouchEnd, handleKeyDown } =
    useViewerInput({
      index,
      count,
      hasNavigation,
      onIndexChange,
      onClose,
      content,
    });
  const image = images[index];

  if (!image) return null;

  const label =
    image.alt || t("imageViewer.unnamed", { current: index + 1, total: count });

  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          ref={content}
          aria-describedby={undefined}
          className="fixed inset-0 z-55 flex flex-col bg-viewer-scrim outline-none"
          onCloseAutoFocus={onCloseAutoFocus}
          // Escape closes through `handleKeyDown` alone. The dialog layer only
          // knows the viewer a few renders after it appeared, and a dialog
          // underneath may have used the key by then; either would lose an
          // Escape that only the layer handled.
          onEscapeKeyDown={(event) => event.preventDefault()}
          onKeyDown={handleKeyDown}
        >
          <DialogPrimitive.Title className="sr-only">
            {t("imageViewer.title")}
          </DialogPrimitive.Title>
          {header ?? (
            <ViewerHeader
              caption={image.alt}
              linkHref={image.linkHref}
              position={
                hasNavigation
                  ? t("imageViewer.position", {
                      current: index + 1,
                      total: count,
                    })
                  : null
              }
            />
          )}
          <div
            className="relative flex min-h-0 flex-1"
            onTouchEnd={handleTouchEnd}
            onTouchStart={handleTouchStart}
          >
            {hasNavigation ? (
              <ViewerSteps
                hasNext={index < count - 1}
                hasPrevious={index > 0}
                onStep={step}
              />
            ) : null}
            <ViewerStage
              key={`${index}:${image.src}`}
              isPaged={hasNavigation}
              label={label}
              src={image.src}
              {...(image.unavailable === undefined
                ? {}
                : { unavailable: image.unavailable })}
            />
          </div>
          {footer}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
