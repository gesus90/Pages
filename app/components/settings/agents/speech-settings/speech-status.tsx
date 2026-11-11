import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import type { PageAgentModel } from "@/definition/PageAgent";
import type {
  SpeechAdministration,
  SpeechStatus,
} from "@/definition/SpeechRecognition";
import type { TFunction } from "i18next";

const STATUS_CLASSES: Readonly<Record<SpeechStatus, string>> = {
  ready: "bg-success-subtle text-success",
  noModel: "bg-muted text-muted-foreground",
  modelUnavailable: "bg-warning-subtle text-warning",
  modelUnsuitable: "bg-warning-subtle text-warning",
  modelNotInCatalog: "bg-warning-subtle text-warning",
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
 * Whether the saved speech recognition can run: ready, no model, a model
 * that is no longer offered, or one that is no transcription model.
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

/** The statuses whose saved model a note names, with the text that explains it. */
const STATUS_NOTES: Partial<Record<SpeechStatus, string>> = {
  modelUnsuitable: "speechSettings.unsuitable",
  modelNotInCatalog: "speechSettings.notInCatalog",
};

/**
 * Explains why a saved model does not run: it is no transcription model
 * (PAGE-294), or its OpenRouter catalog no longer lists it (PAGE-302). The
 * saved choice and the longest recording stay as they are.
 */
export function SpeechStatusNote({
  administration,
}: {
  readonly administration: SpeechAdministration;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const { selection } = administration.settings;
  const note = STATUS_NOTES[administration.status];
  if (note === undefined || selection === null) return null;
  return (
    <p role="status" className="text-xs text-warning">
      {t(note, { model: selection.model })}
    </p>
  );
}

/**
 * Tells how OpenRouter's transcription models become selectable while no
 * OpenRouter connection offers one (PAGE-302).
 */
export function SpeechOpenRouterHint({
  models,
}: {
  readonly models: readonly PageAgentModel[];
}): React.ReactElement | null {
  const { t } = useTranslation();
  const hasOpenRouterModel = models.some(
    (model) => model.provider === "openrouter" && model.isSimulation !== true,
  );
  if (hasOpenRouterModel) return null;
  return (
    <p className="text-xs text-muted-foreground">
      {t("speechSettings.noOpenRouterModels")}
    </p>
  );
}
