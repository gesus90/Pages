import { useState } from "react";

import {
  AGENT_LOGBOOK_LIMIT_RANGE,
  AGENT_LOGBOOK_QUIET_RANGE,
} from "@/definition/AgentLogbook";

import type { AgentLogbookSettings } from "@/definition/AgentLogbook";

/** The value of the model choice that follows the instance, or the agent's own model. */
export const DEFAULT_MODEL_KEY = "";

/** The entries of the cards "Obergrenze" and "Hintergrund-Zusammenfassung" and what can be saved from them. */
export interface LogbookSettingsDraft {
  readonly limitText: string;
  readonly quietText: string;
  /** The key of the chosen model; {@link DEFAULT_MODEL_KEY} for none. */
  readonly modelKey: string;
  readonly hasLimitProblem: boolean;
  readonly hasQuietProblem: boolean;
  /** The settings to save; `null` while an entry is not valid. */
  readonly settings: AgentLogbookSettings | null;
  setLimitText(text: string): void;
  setQuietText(text: string): void;
  setModelKey(key: string): void;
}

interface WholeNumberRange {
  readonly minimum: number;
  readonly maximum: number;
}

/** The key a model is chosen by in the list. */
export function logbookModelKey(model: {
  readonly connectionId: string;
  readonly model: string;
}): string {
  return `${model.connectionId}\u001f${model.model}`;
}

/** The model a key stands for; `null` for {@link DEFAULT_MODEL_KEY} or a malformed key. */
function readModelKey(key: string): AgentLogbookSettings["model"] {
  const [connectionId = "", model = ""] = key.split("\u001f");
  return connectionId === "" || model === ""
    ? null
    : { connectionId, model };
}

function readWholeNumber(text: string, range: WholeNumberRange): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/u.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return parsed >= range.minimum && parsed <= range.maximum ? parsed : null;
}

/**
 * The entries of limit, quiet time and model of the Lagebuch, checked against
 * the ranges of the contract before anything is sent (PAGE-377).
 *
 * @param saved - The settings the server holds; they fill the entries.
 */
export function useLogbookSettingsDraft(
  saved: AgentLogbookSettings,
): LogbookSettingsDraft {
  const [limitText, setLimitText] = useState(String(saved.limit));
  const [quietText, setQuietText] = useState(String(saved.quietMinutes));
  const [modelKey, setModelKey] = useState(
    saved.model === null ? DEFAULT_MODEL_KEY : logbookModelKey(saved.model),
  );
  const limit = readWholeNumber(limitText, AGENT_LOGBOOK_LIMIT_RANGE);
  const quietMinutes = readWholeNumber(quietText, AGENT_LOGBOOK_QUIET_RANGE);
  const isValid = limit !== null && quietMinutes !== null;
  return {
    limitText,
    quietText,
    modelKey,
    hasLimitProblem: limit === null,
    hasQuietProblem: quietMinutes === null,
    settings: isValid
      ? { limit, quietMinutes, model: readModelKey(modelKey) }
      : null,
    setLimitText,
    setQuietText,
    setModelKey,
  };
}
