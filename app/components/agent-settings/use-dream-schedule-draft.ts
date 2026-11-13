import { useState } from "react";

import {
  clampDreamInterval,
  dreamSettingsKey,
  fieldsFromDreamSettings,
  hasDreamWeekdayChoice,
  hasValidDreamInterval,
  readDreamFields,
} from "./agent-dream-fields";

import type { DreamFields } from "./agent-dream-fields";
import type { AgentDreamSettings } from "./agent-dreaming-api";
import type { AgentDreamIntervalUnit } from "@/definition/AgentDreaming";

/** The entries of the card "Zeitplan" and what can be saved from them. */
export interface DreamScheduleDraft {
  readonly fields: DreamFields;
  readonly hasIntervalProblem: boolean;
  /** Whether a weekday can be chosen: the interval is 7 days. */
  readonly hasWeekdayChoice: boolean;
  /** The settings to save; `null` while an entry is not valid. */
  readonly settings: AgentDreamSettings | null;
  /** Whether the entries differ from what the server holds. */
  readonly isChanged: boolean;
  /** Changes some of the entries. */
  update(patch: Partial<DreamFields>): void;
  /** Changes the unit and keeps the interval inside the range of the new unit. */
  setUnit(unit: AgentDreamIntervalUnit): void;
}

/**
 * The entries of the schedule and the model of the dream run, checked against
 * the ranges of the contract before anything is sent (PAGE-378).
 *
 * @param saved - The settings the server holds; they fill the entries.
 */
export function useDreamScheduleDraft(
  saved: AgentDreamSettings,
): DreamScheduleDraft {
  const [fields, setFields] = useState(() => fieldsFromDreamSettings(saved));
  const settings = readDreamFields(fields);
  return {
    fields,
    hasIntervalProblem: !hasValidDreamInterval(fields),
    hasWeekdayChoice: hasDreamWeekdayChoice(fields),
    settings,
    isChanged:
      settings !== null &&
      dreamSettingsKey(settings) !== dreamSettingsKey(saved),
    update: (patch) => setFields((current) => ({ ...current, ...patch })),
    setUnit: (unit) =>
      setFields((current) => ({
        ...current,
        unit,
        intervalText: clampDreamInterval(current.intervalText, unit),
      })),
  };
}
