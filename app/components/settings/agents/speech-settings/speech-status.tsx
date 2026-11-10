import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import type { SpeechStatus } from "@/definition/SpeechRecognition";
import type { TFunction } from "i18next";

const STATUS_CLASSES: Readonly<Record<SpeechStatus, string>> = {
  ready: "bg-success-subtle text-success",
  noModel: "bg-muted text-muted-foreground",
  modelUnavailable: "bg-warning-subtle text-warning",
};

/**
 * Names a duration of the speech settings in whole minutes or seconds.
 *
 * @param durationMs - The duration in milliseconds.
 * @param translate - The translation function of the page.
 * @returns For example "2 Minuten" or "30 Sekunden".
 */
export function formatSpeechDuration(
  durationMs: number,
  translate: TFunction,
): string {
  const seconds = Math.round(durationMs / 1000);
  return seconds % 60 === 0
    ? translate("speechSettings.minutes", { count: seconds / 60 })
    : translate("speechSettings.seconds", { count: seconds });
}

/**
 * Whether the saved speech recognition can run: ready, no model, or a model
 * that is no longer offered.
 */
export function SpeechStatusBadge({
  status,
}: {
  readonly status: SpeechStatus;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <span
      role="status"
      className={cn(
        "rounded-md px-2 py-1 text-xs font-semibold",
        STATUS_CLASSES[status],
      )}
    >
      {t(`speechSettings.status.${status}`)}
    </span>
  );
}
