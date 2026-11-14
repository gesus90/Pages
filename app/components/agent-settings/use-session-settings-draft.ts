import { useState } from "react";

import {
  AGENT_CHAT_SESSION_IDLE_RANGE,
  AGENT_CHAT_SESSION_RESTART_RANGE,
} from "@/definition/AgentChatSession";

import type { AgentChatSessionSettings } from "@/definition/AgentChatSession";

/** The two entries of the card "Verhalten" and what can be saved from them. */
export interface SessionSettingsDraft {
  readonly idleText: string;
  readonly restartText: string;
  /** Whether the idle entry is outside its range or no whole number. */
  readonly hasIdleProblem: boolean;
  readonly hasRestartProblem: boolean;
  /** The settings to save; `null` while an entry is not valid. */
  readonly settings: AgentChatSessionSettings | null;
  setIdleText(text: string): void;
  setRestartText(text: string): void;
}

interface WholeNumberRange {
  readonly minimum: number;
  readonly maximum: number;
}

/** The number a text holds when it is a whole number inside the range, else `null`. */
function readWholeNumber(text: string, range: WholeNumberRange): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/u.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return parsed >= range.minimum && parsed <= range.maximum ? parsed : null;
}

/**
 * The entries of idle time and restart threshold, checked against the
 * ranges of the contract before anything is sent (PAGE-376).
 *
 * @param saved - The settings the server holds; they fill the entries.
 */
export function useSessionSettingsDraft(
  saved: AgentChatSessionSettings,
): SessionSettingsDraft {
  const [idleText, setIdleText] = useState(String(saved.idleMinutes));
  const [restartText, setRestartText] = useState(String(saved.restartPercent));
  const idleMinutes = readWholeNumber(idleText, AGENT_CHAT_SESSION_IDLE_RANGE);
  const restartPercent = readWholeNumber(
    restartText,
    AGENT_CHAT_SESSION_RESTART_RANGE,
  );
  const isValid = idleMinutes !== null && restartPercent !== null;
  return {
    idleText,
    restartText,
    hasIdleProblem: idleMinutes === null,
    hasRestartProblem: restartPercent === null,
    settings: isValid ? { idleMinutes, restartPercent } : null,
    setIdleText,
    setRestartText,
  };
}
