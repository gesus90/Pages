import {
  AGENT_DREAM_INTERVAL_RANGE,
  AGENT_DREAM_WEEKLY_DAYS,
} from "@/definition/AgentDreaming";

import type {
  AgentDreamModelRef,
  AgentDreamSettings,
} from "./agent-dreaming-api";
import type {
  AgentDreamIntervalUnit,
  AgentDreamSchedule,
} from "@/definition/AgentDreaming";

/** The value of the model choice that stands for the agent's own model. */
export const DEFAULT_DREAM_MODEL_KEY = "";

/** What the card "Zeitplan" holds while it is edited: the entries as text. */
export interface DreamFields {
  readonly isEnabled: boolean;
  readonly intervalText: string;
  readonly unit: AgentDreamIntervalUnit;
  /** `HH:MM`, or an empty text for the time of the instance. */
  readonly time: string;
  /** `1` (Monday) to `7` (Sunday), or an empty text for none. */
  readonly weekday: string;
  readonly isOnFullLogbook: boolean;
  /** The key of the chosen model; {@link DEFAULT_DREAM_MODEL_KEY} for the agent's own. */
  readonly modelKey: string;
}

const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;
const KEY_SEPARATOR = "\u001f";

/**
 * The key a model is chosen by in the list.
 *
 * @param model - The model.
 */
export function dreamModelKey(model: AgentDreamModelRef): string {
  return `${model.connectionId}${KEY_SEPARATOR}${model.model}`;
}

/** The model a key stands for; `null` for the agent's own or a malformed key. */
function readModelKey(key: string): AgentDreamModelRef | null {
  const [connectionId = "", model = ""] = key.split(KEY_SEPARATOR);
  return connectionId === "" || model === "" ? null : { connectionId, model };
}

/** The whole number a text spells, when it lies in the range of the unit. */
function readInterval(
  text: string,
  unit: AgentDreamIntervalUnit,
): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/u.test(trimmed)) return null;
  const parsed = Number(trimmed);
  const range = AGENT_DREAM_INTERVAL_RANGE[unit];
  return parsed >= range.minimum && parsed <= range.maximum ? parsed : null;
}

/**
 * The schedule without what its unit and interval ignore: no time for hours,
 * no weekday unless the interval is a week.
 *
 * @param schedule - The schedule as entered or as the server holds it.
 */
export function normalizeDreamSchedule(
  schedule: AgentDreamSchedule,
): AgentDreamSchedule {
  const isDays = schedule.unit === "days";
  const isWeekly = isDays && schedule.interval === AGENT_DREAM_WEEKLY_DAYS;
  return {
    ...schedule,
    time: isDays ? schedule.time : null,
    weekday: isWeekly ? schedule.weekday : null,
  };
}

/**
 * The entries that show the settings the server holds.
 *
 * @param settings - The saved schedule and model.
 */
export function fieldsFromDreamSettings(
  settings: AgentDreamSettings,
): DreamFields {
  const { schedule, model } = settings;
  return {
    isEnabled: schedule.isEnabled,
    intervalText: String(schedule.interval),
    unit: schedule.unit,
    time: schedule.time ?? "",
    weekday: schedule.weekday === null ? "" : String(schedule.weekday),
    isOnFullLogbook: schedule.isOnFullLogbook,
    modelKey: model === null ? DEFAULT_DREAM_MODEL_KEY : dreamModelKey(model),
  };
}

/**
 * Whether the interval is a whole number of weeks in days, so that a weekday
 * can be chosen.
 *
 * @param fields - The entries.
 */
export function hasDreamWeekdayChoice(fields: DreamFields): boolean {
  return (
    fields.unit === "days" &&
    readInterval(fields.intervalText, fields.unit) === AGENT_DREAM_WEEKLY_DAYS
  );
}

/**
 * Whether the interval is inside the range of its unit.
 *
 * @param fields - The entries.
 */
export function hasValidDreamInterval(fields: DreamFields): boolean {
  return readInterval(fields.intervalText, fields.unit) !== null;
}

/**
 * The settings the entries stand for, ready to save.
 *
 * @param fields - The entries.
 * @returns The settings, or `null` while an entry is not valid.
 */
export function readDreamFields(
  fields: DreamFields,
): AgentDreamSettings | null {
  const interval = readInterval(fields.intervalText, fields.unit);
  if (interval === null) return null;
  const time = fields.time === "" ? null : fields.time;
  if (fields.unit === "days" && time !== null && !TIME_PATTERN.test(time))
    return null;
  return {
    schedule: normalizeDreamSchedule({
      isEnabled: fields.isEnabled,
      interval,
      unit: fields.unit,
      time,
      weekday: fields.weekday === "" ? null : Number(fields.weekday),
      isOnFullLogbook: fields.isOnFullLogbook,
    }),
    model: readModelKey(fields.modelKey),
  };
}

/**
 * Keeps the interval inside the range of a unit after the unit changed.
 *
 * @param text - The interval as entered.
 * @param unit - The unit the interval counts in from now on.
 * @returns The nearest interval of the range, or the text when it is no number.
 */
export function clampDreamInterval(
  text: string,
  unit: AgentDreamIntervalUnit,
): string {
  const parsed = Number(text.trim());
  if (text.trim() === "" || !Number.isFinite(parsed)) return text;
  const range = AGENT_DREAM_INTERVAL_RANGE[unit];
  return String(
    Math.min(range.maximum, Math.max(range.minimum, Math.round(parsed))),
  );
}

/**
 * A text that is the same for settings that mean the same.
 *
 * @param settings - The schedule and model.
 */
export function dreamSettingsKey(settings: AgentDreamSettings): string {
  const { schedule, model } = settings;
  const normalized = normalizeDreamSchedule(schedule);
  return [
    normalized.isEnabled,
    normalized.interval,
    normalized.unit,
    normalized.time ?? "",
    normalized.weekday ?? "",
    normalized.isOnFullLogbook,
    model === null ? DEFAULT_DREAM_MODEL_KEY : dreamModelKey(model),
  ]
    .map(String)
    .join("|");
}
