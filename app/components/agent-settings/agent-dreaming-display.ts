import { DEFAULT_DREAM_MODEL_KEY, dreamModelKey } from "./agent-dream-fields";

import type {
  AgentDreamCounts,
  AgentDreamFileSize,
  AgentDreamLogEntry,
  AgentDreamLogKind,
  AgentDreamSchedule,
  AgentDreamingOverview,
} from "@/definition/AgentDreaming";
import type { TFunction } from "i18next";

/** The kinds of the log of a run in the order the tab lists them. */
export const DREAM_LOG_KINDS: readonly AgentDreamLogKind[] = [
  "memoryTaken",
  "memoryDropped",
  "lessonLearned",
  "lessonStrengthened",
  "lessonDropped",
  "recipeCreated",
  "recipeUpdated",
  "recipeDropped",
];

/** One kind of the log with its lines. */
export interface DreamLogGroup {
  readonly kind: AgentDreamLogKind;
  readonly entries: readonly AgentDreamLogEntry[];
}

/** One choice of the model of the dream run. */
export interface DreamModelOption {
  readonly value: string;
  readonly label: string;
}

/**
 * The lines of a log grouped by kind, in the order of {@link DREAM_LOG_KINDS}.
 *
 * @param log - The lines of the run.
 * @returns Only the kinds that have a line.
 */
export function groupDreamLog(
  log: readonly AgentDreamLogEntry[],
): DreamLogGroup[] {
  return DREAM_LOG_KINDS.map((kind) => ({
    kind,
    entries: log.filter((entry) => entry.kind === kind),
  })).filter((group) => group.entries.length > 0);
}

/**
 * What a schedule means in words, such as "alle 6 Stunden", "täglich um 02:00"
 * or "jeden Montag um 02:00".
 *
 * @param schedule - The schedule, as entered or saved.
 * @param instanceTime - The time of day of the instance; a schedule in days
 * without a time of its own runs then.
 * @param t - The translation function.
 */
export function describeDreamSchedule(
  schedule: AgentDreamSchedule,
  instanceTime: string,
  t: TFunction,
): string {
  if (!schedule.isEnabled) return t("agentDreaming.summary.off");
  const { interval, unit, weekday } = schedule;
  if (unit === "hours")
    return t("agentDreaming.summary.hours", { count: interval });
  const time = schedule.time ?? instanceTime;
  const suffix = schedule.time === null ? "Instance" : "";
  if (interval === 1)
    return t(`agentDreaming.summary.daily${suffix}`, { time });
  if (weekday !== null && interval === 7)
    return t(`agentDreaming.summary.weekly${suffix}`, {
      weekday: t(`agentDreaming.weekday.${String(weekday)}`),
      time,
    });
  return t(`agentDreaming.summary.days${suffix}`, { interval, time });
}

/**
 * The counts of a run in words, such as "3 Einträge übernommen · 1 neue
 * Lektion"; only the kinds that did something.
 *
 * @param counts - How many entries the run touched per kind.
 * @param t - The translation function.
 */
export function describeDreamCounts(
  counts: AgentDreamCounts,
  t: TFunction,
): string {
  const touched = DREAM_LOG_KINDS.filter((kind) => counts[kind] > 0);
  if (touched.length === 0) return t("agentDreaming.counts.none");
  return touched
    .map((kind) => t(`agentDreaming.counts.${kind}`, { count: counts[kind] }))
    .join(" · ");
}

/**
 * Why a run failed, in words; a code the tab does not know shows as it is.
 *
 * @param code - The stable code of the run.
 * @param t - The translation function.
 */
export function describeDreamError(code: string, t: TFunction): string {
  return t(`agentDreaming.errorCode.${code}`, {
    defaultValue: t("agentDreaming.errorCodeUnknown", { code }),
  });
}

/**
 * A number the way the language of the visitor writes it.
 *
 * @param count - The number.
 * @param language - The language code.
 */
export function formatDreamNumber(count: number, language: string): string {
  return new Intl.NumberFormat(language).format(count);
}

/**
 * "1.234 / 8.000 Zeichen" for a file of the memory.
 *
 * @param size - Characters used and the limit.
 * @param t - The translation function.
 * @param language - The language code.
 */
export function describeDreamFileSize(
  size: AgentDreamFileSize,
  t: TFunction,
  language: string,
): string {
  return t("agentDreaming.files.size", {
    characters: formatDreamNumber(size.characters, language),
    limit: formatDreamNumber(size.limit, language),
  });
}

/**
 * How full a file is, as a whole percent between 0 and 100.
 *
 * @param size - Characters used and the limit.
 */
export function dreamFilePercent(size: AgentDreamFileSize): number {
  if (size.limit <= 0) return 0;
  const percent = Math.round((size.characters / size.limit) * 100);
  return Math.min(100, Math.max(0, percent));
}

/**
 * The options of the model choice: the agent's own model first, then every
 * model the administrator may choose.
 *
 * @param overview - The overview with the models and the saved choice.
 * @param t - The translation function.
 */
export function dreamModelOptions(
  overview: AgentDreamingOverview,
  t: TFunction,
): DreamModelOption[] {
  const { ownModelLabel, models, model: saved } = overview;
  const own: DreamModelOption = {
    value: DEFAULT_DREAM_MODEL_KEY,
    label:
      ownModelLabel === null
        ? t("agentDreaming.schedule.modelAgent")
        : t("agentDreaming.schedule.modelAgentNamed", { name: ownModelLabel }),
  };
  const options = models.map((model) => ({
    value: dreamModelKey(model),
    label: model.label,
  }));
  // A saved model the choice no longer lists stays visible until another is chosen.
  const isListed =
    saved === null ||
    options.some((option) => option.value === dreamModelKey(saved));
  const missing =
    isListed || saved === null
      ? []
      : [{ value: dreamModelKey(saved), label: saved.model }];
  return [own, ...missing, ...options];
}
