import type { AgentSettingsCurrentChat } from "./agent-settings-types";
import type {
  AgentChatSessionBrief,
  AgentChatSessionChat,
  AgentChatSessionState,
  AgentChatSessionView,
} from "@/definition/AgentChatSession";
import type { TFunction } from "i18next";

/** The color of the dot of each state, by semantic token. */
export const SESSION_STATE_DOT: Readonly<
  Record<AgentChatSessionState, string>
> = {
  working: "bg-warning",
  ready: "bg-success-dot",
  resting: "bg-muted-foreground/50",
  restart_needed: "bg-destructive",
};

/**
 * Whether the context of a session is as full as it may get: a session that
 * needs its restart, or one at or above the restart threshold.
 *
 * @param brief - The session.
 * @param restartPercent - The restart threshold of the agent; `null` when
 * only the state of the session decides.
 */
export function isContextCritical(
  brief: AgentChatSessionBrief,
  restartPercent: number | null,
): boolean {
  if (brief.state === "restart_needed") return true;
  return (
    restartPercent !== null &&
    brief.contextPercent !== null &&
    brief.contextPercent >= restartPercent
  );
}

/**
 * The context fill as a whole percent between 0 and 100.
 *
 * @param percent - The reported fill; `null` before the first round.
 */
export function clampContextPercent(percent: number | null): number | null {
  if (percent === null) return null;
  return Math.min(100, Math.max(0, Math.round(percent)));
}

/**
 * Whether a session belongs to the chat the popup was opened from.
 *
 * @param view - The session.
 * @param current - The chat the popup was opened from, if any.
 */
export function isCurrentSession(
  view: AgentChatSessionView,
  current: AgentSettingsCurrentChat | undefined,
): boolean {
  if (current === undefined) return false;
  if ("sessionId" in current) return current.sessionId === view.sessionId;
  return current.kind === view.chat.kind && current.id === view.chat.id;
}

/**
 * The chat of a session as the lists name it: "Gruppe „Name“" or
 * "Direkt · Name".
 *
 * @param chat - The chat of the session.
 * @param t - The translation function.
 */
export function sessionChatName(
  chat: AgentChatSessionChat,
  t: TFunction,
): string {
  return t(`agentSessions.chat.${chat.kind}`, { name: chat.name });
}

const THOUSAND = 1_000;
const MILLION = 1_000_000;

/**
 * A token count in the short form of the lists: `151 k`, `1,2 M`.
 *
 * @param tokens - The count.
 * @param t - The translation function.
 * @param language - The language whose number format applies.
 */
export function formatTokenCount(
  tokens: number,
  t: TFunction,
  language: string,
): string {
  const scaled = tokens >= MILLION ? tokens / MILLION : tokens / THOUSAND;
  const format = new Intl.NumberFormat(language, {
    maximumFractionDigits: scaled < 10 ? 1 : 0,
  });
  if (tokens >= MILLION)
    return t("agentSessions.tokens.million", { value: format.format(scaled) });
  if (tokens >= THOUSAND)
    return t("agentSessions.tokens.thousand", { value: format.format(scaled) });
  return new Intl.NumberFormat(language).format(tokens);
}
