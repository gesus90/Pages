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
}

/** Whether a key press belongs to the browser or the system, not to paging. */
function hasModifier(event: React.KeyboardEvent): boolean {
  return event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;
}

/**
 * A full-screen viewer for one image of a list, with arrows and the arrow
 * keys to page through the list.
 *
 * @remarks
 * A modal dialog, so it traps the focus, closes on Escape and hands the focus
 * back. It sits above whatever dialog it opened from. A single image has no
 * navigation. An image that cannot load is reported in its place and the
 * other images stay reachable.
 */
export function ImageViewer({
  images,
  index,
  onIndexChange,
  onClose,
  onCloseAutoFocus,
}: ImageViewerProps): React.ReactElement | null {
  const { t } = useTranslation();
  const content = useRef<HTMLDivElement>(null);
  const image = images[index];

  if (!image) {
    return null;
  }

  const count = images.length;
  const hasNavigation = count > 1;
  const label =
    image.alt || t("imageViewer.unnamed", { current: index + 1, total: count });

  function step(direction: -1 | 1): void {
    const target = stepViewerIndex(index, count, direction);

    if (target === null) {
      return;
    }

    onIndexChange(target);

    if (stepViewerIndex(target, count, direction) === null) {
      // The arrow that was used turns unavailable; a disabled control would
      // drop the focus out of the dialog.
      content.current?.focus();
    }
  }

  function handleKeyDown(event: React.KeyboardEvent): void {
    if (event.key === "Escape") {
      onClose();
      return;
    }

    if (!hasNavigation || hasModifier(event)) {
      return;
    }

    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      step(event.key === "ArrowLeft" ? -1 : 1);
    }
  }

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
          <div className="relative flex min-h-0 flex-1">
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
            />
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
