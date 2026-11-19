import { Video } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

interface ChatCallButtonProps {
  /** Whether a call runs or rings in this chat; the button then starts nothing. */
  readonly isRunning: boolean;
  readonly onStart: () => void;
}

/**
 * "Anruf starten": the camera button in the composer of a direct chat.
 * @remarks
 * Click, Enter and Space start the call. While a call runs the button stays
 * focusable but starts nothing, so a keyboard user keeps their place.
 */
export function ChatCallButton({
  isRunning,
  onStart,
}: ChatCallButtonProps): React.ReactElement {
  const { t } = useTranslation();

  function handleClick(): void {
    if (!isRunning) onStart();
  }

  return (
    <button
      type="button"
      aria-disabled={isRunning ? true : undefined}
      aria-label={t("chatCall.start")}
      title={t("chatCall.start")}
      onClick={handleClick}
      className={cn(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-xl border focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus-visible:outline-none",
        isRunning
          ? "cursor-default border-primary bg-primary-subtle text-primary"
          : "border-border bg-surface text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <Video aria-hidden="true" className="size-[18px]" />
    </button>
  );
}
