import { ImageOff, Loader2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

type LoadState = "loading" | "loaded" | "failed";

interface ViewerStageProps {
  readonly src: string;
  /** Name of the image for people who cannot see it. */
  readonly label: string;
  /** Whether arrows share the screen; below the image on a narrow one. */
  readonly isPaged: boolean;
}

/**
 * The image as large as the space allows, with its proportions kept, or why
 * it is not there.
 *
 * @remarks
 * The load state belongs to one image: the viewer gives every image its own
 * stage, so an image that failed never marks the next one.
 */
export function ViewerStage({
  src,
  label,
  isPaged,
}: ViewerStageProps): React.ReactElement {
  const { t } = useTranslation();
  const [state, setState] = useState<LoadState>("loading");

  return (
    <div
      className={cn(
        "relative flex min-h-0 min-w-0 flex-1 items-center justify-center px-3 sm:px-20 sm:pb-6",
        isPaged ? "pb-[4.75rem]" : "pb-3",
      )}
    >
      {state === "failed" ? (
        <div
          className="flex max-w-md flex-col items-center gap-3 text-center text-viewer-foreground"
          role="alert"
        >
          <ImageOff aria-hidden="true" className="size-10" />
          <p className="text-base font-semibold">{t("imageViewer.failed")}</p>
          <p className="text-sm break-all text-viewer-muted">{label}</p>
        </div>
      ) : (
        <img
          alt={label}
          className={cn(
            "size-full object-contain",
            state === "loading" && "opacity-0",
          )}
          decoding="async"
          src={src}
          onError={() => setState("failed")}
          onLoad={() => setState("loaded")}
        />
      )}
      {state === "loading" ? (
        <p
          className="absolute inset-0 flex items-center justify-center text-viewer-foreground"
          role="status"
        >
          <Loader2 aria-hidden="true" className="size-8 animate-spin" />
          <span className="sr-only">{t("imageViewer.loading")}</span>
        </p>
      ) : null}
    </div>
  );
}
