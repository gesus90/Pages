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
    `${name} konnte nicht antworten, die Antwort ist fehlgeschlagen. Der Grund ist nicht bekannt.`,
  round_limit: () => "Abstimmung beendet, Grenze erreicht",
  agent_stopped: (name) => `Die Antwort von ${name} wurde gestoppt.`,
  // A system line carries its own text.
  session_event: () => "",
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
    error.code === "accessModeRequired" ||
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
  const repeated = error.isTransient
    ? " Auch der automatische zweite Versuch ist gescheitert."
    : "";
  return `${name} konnte nicht antworten: ${failureReason(error)}.${repeated}`;
}

/** The reason of a failed job: the tool that was not ready, the failed step, or the code. */
function failureReason(error: AgentJobAnswerError): string {
  const { detail, failureCode: code } = error;
  if (code === "agent_tool_not_ready" && detail?.tool)
    return `Das Werkzeug ${detail.tool} ist nicht bereit (Status ${detail.toolStatus ?? "unbekannt"}, Diagnose ${detail.diagnostic ?? "unbekannt"})`;
  if (code === "plan_step_failed" && detail) {
    const cause = detail.cause ? `, ${detail.cause}` : "";
    return `Fehler ${code} beim Schritt ${detail.step ?? detail.stage}${cause}`;
  }
  return `Fehler ${code}`;
}
