import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, ExternalLink, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

const CONTROL_CLASS =
  "inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-viewer-control text-viewer-foreground ring-1 ring-viewer-edge transition-colors hover:bg-viewer-control-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-35";

interface ViewerHeaderProps {
  /** The position as "2 / 5"; missing for a single image. */
  readonly position: string | null;
  readonly caption: string;
  /** Target of the link around the image, `null` without one. */
  readonly linkHref: string | null;
}

/** The position, the name of the image and the actions that leave the viewer. */
export function ViewerHeader({
  position,
  caption,
  linkHref,
}: ViewerHeaderProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div className="flex shrink-0 items-center gap-3 p-3 sm:p-4">
      <div className="flex min-w-0 flex-1 items-baseline gap-3">
        {position ? (
          <p
            className="shrink-0 text-sm font-semibold text-viewer-foreground tabular-nums"
            role="status"
          >
            {position}
          </p>
        ) : null}
        <p className="min-w-0 truncate text-sm text-viewer-muted">{caption}</p>
      </div>
      {linkHref ? (
        <a
          aria-label={t("imageViewer.openLink")}
          className={CONTROL_CLASS}
          href={linkHref}
          rel="noopener noreferrer"
          target="_blank"
          title={t("imageViewer.openLink")}
        >
          <ExternalLink aria-hidden="true" className="size-5" />
        </a>
      ) : null}
      <DialogPrimitive.Close asChild>
        <button
          aria-label={t("imageViewer.close")}
          className={CONTROL_CLASS}
          title={t("imageViewer.close")}
          type="button"
        >
          <X aria-hidden="true" className="size-5" />
        </button>
      </DialogPrimitive.Close>
    </div>
  );
}

interface ViewerStepButtonProps {
  readonly direction: "previous" | "next";
  /** Whether the list has an image in that direction. */
  readonly isAvailable: boolean;
  readonly onStep: () => void;
}

/** The arrow to the previous or next image; unavailable at the ends. */
function ViewerStepButton({
  direction,
  isAvailable,
  onStep,
}: ViewerStepButtonProps): React.ReactElement {
  const { t } = useTranslation();
  const Icon = direction === "previous" ? ChevronLeft : ChevronRight;
  const label = t(`imageViewer.${direction}`);

  return (
    <button
      aria-label={label}
      className={cn(CONTROL_CLASS, "pointer-events-auto")}
      disabled={!isAvailable}
      title={label}
      type="button"
      onClick={onStep}
    >
      <Icon aria-hidden="true" className="size-6" />
    </button>
  );
}

interface ViewerStepsProps {
  readonly hasPrevious: boolean;
  readonly hasNext: boolean;
  readonly onStep: (direction: -1 | 1) => void;
}

/**
 * Both arrows. On a wide screen they sit at the sides of the image; on a
 * narrow one they move below it, where they cover none of the picture.
 */
export function ViewerSteps({
  hasPrevious,
  hasNext,
  onStep,
}: ViewerStepsProps): React.ReactElement {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-10 flex justify-center gap-8 sm:inset-y-0 sm:items-center sm:justify-between sm:gap-0 sm:px-4">
      <ViewerStepButton
        direction="previous"
        isAvailable={hasPrevious}
        onStep={() => onStep(-1)}
      />
      <ViewerStepButton
        direction="next"
        isAvailable={hasNext}
        onStep={() => onStep(1)}
      />
    </div>
  );
}
