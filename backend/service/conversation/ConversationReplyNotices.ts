import { AgentJobAnswerError } from "@/backend/error/AgentJobAnswerError";
import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";

import type { PagesEvent } from "@/backend/service/events/PagesEventPublisher";
import type { ConversationNotice } from "@/definition/Conversation";

/** User-facing explanations for replies that could not be produced. */
export const NOTICE_TEXTS: Readonly<
  Record<ConversationNotice, (name: string) => string>
> = {
  agent_inactive: (name) =>
    `${name} ist deaktiviert und antwortet nicht auf diese Nachricht.`,
  agent_cost_limit: (name) =>
    `${name} antwortet nicht: Das Kostenlimit des Agents ist erreicht.`,
  agent_unavailable: (name) =>
    `${name} antwortet nicht: Für den Agent ist gerade kein Modell nutzbar.`,
  agent_failed: (name) =>
    `${name} konnte nicht antworten, die Antwort ist fehlgeschlagen. Schreib die Nachricht erneut, um es noch einmal zu versuchen.`,
  round_limit: () => "Abstimmung beendet, Grenze erreicht",
  agent_stopped: (name) => `Die Antwort von ${name} wurde gestoppt.`,
};

/** Announces a changed conversation. */
export function changedEvent(conversationId: string): PagesEvent {
  return { type: "conversation.changed", id: conversationId };
}

/** Maps an answer failure to its user-facing notice. */
export function noticeFor(error: unknown): ConversationNotice {
  if (
    error instanceof AgentJobAnswerError ||
    !(error instanceof AgentEmployeeError)
  )
    return "agent_failed";
  if (error.code === "inactive") return "agent_inactive";
  return error.code === "unavailable" ||
    error.code === "accessUnsupported" ||
    error.code === "modelNotAllowed"
    ? "agent_unavailable"
    : "agent_failed";
}

/** Identifies an answer failure for logging. */
export function failureCode(error: unknown): string {
  if (error instanceof AgentJobAnswerError) return error.failureCode;
  return error instanceof AgentEmployeeError ? error.code : "general";
}

/** Explains an answer failure to conversation members. */
export function failureText(
  error: unknown,
  notice: ConversationNotice,
  name: string,
): string {
  if (!(error instanceof AgentJobAnswerError))
    return NOTICE_TEXTS[notice](name);
  if (
    error.failureCode === "cli_not_logged_in" ||
    error.failureCode === "cli_auth_failed" ||
    error.failureCode === "provider_auth_failed"
  )
    return `${name} antwortet nicht: Der Agent ist nicht angemeldet (${error.failureCode}).`;
  if (error.isCancelled)
    return `Die Antwort von ${name} wurde abgebrochen (${error.failureCode}); auch der einmalige Wiederholungsversuch wurde nicht abgeschlossen.`;
  return `${name} konnte nicht antworten: Fehler ${error.failureCode}.`;
}
