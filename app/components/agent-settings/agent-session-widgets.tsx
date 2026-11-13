import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";

import {
  SESSION_STATE_DOT,
  clampContextPercent,
} from "./agent-session-display";

import type {
  AgentChatSessionAction,
  AgentChatSessionBrief,
  AgentChatSessionState,
} from "@/definition/AgentChatSession";

/** The state of a session as a colored dot with its word. */
export function SessionStateLabel({
  state,
}: {
  readonly state: AgentChatSessionState;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span
        aria-hidden="true"
        className={cn("size-2 shrink-0 rounded-full", SESSION_STATE_DOT[state])}
      />
      {t(`agentSessions.state.${state}`)}
    </span>
  );
}

/** How full the context of a session is: a bar and the percent, red when critical. */
export function ContextMeter({
  percent,
  isCritical,
  label,
}: {
  readonly percent: number | null;
  readonly isCritical: boolean;
  /** Names the session the bar belongs to, for assistive technology. */
  readonly label: string;
}): React.ReactElement {
  const fill = clampContextPercent(percent);
  return (
    <div className="flex items-center gap-2">
      <div
        aria-label={label}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={fill ?? undefined}
        aria-valuetext={fill === null ? "–" : `${String(fill)} %`}
        className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-muted"
        role="meter"
      >
        <div
          className={cn(
            "h-full rounded-full",
            isCritical ? "bg-destructive" : "bg-primary",
          )}
          style={{ width: `${String(fill ?? 0)}%` }}
        />
      </div>
      <span
        className={cn(
          "w-10 text-right text-xs tabular-nums",
          isCritical ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {fill === null ? "–" : `${String(fill)} %`}
      </span>
    </div>
  );
}

/** The actions of one session in the order of the buttons. */
const SESSION_ACTIONS: readonly AgentChatSessionAction[] = [
  "stop",
  "summarize",
  "restart",
];

/**
 * Whether an action does something for a session: stopping only makes sense
 * while the session works.
 *
 * @param action - The action.
 * @param brief - The session.
 */
export function canRunSessionAction(
  action: AgentChatSessionAction,
  brief: AgentChatSessionBrief,
): boolean {
  return action !== "stop" || brief.state === "working";
}

/** The buttons "Anhalten", "Zusammenfassen" and "Neu starten" of one session. */
export function SessionActionButtons({
  brief,
  subject,
  pendingKey,
  onAction,
}: {
  readonly brief: AgentChatSessionBrief;
  /** Names what the buttons act on, for assistive technology: the chat or the agent. */
  readonly subject: string;
  /** The change that runs now (see `agentSessionRequestKey`); all buttons wait for it. */
  readonly pendingKey: string | null;
  readonly onAction: (
    action: AgentChatSessionAction,
    sessionId: string,
  ) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap gap-1.5">
      {SESSION_ACTIONS.map((action) => (
        <Button
          key={action}
          aria-label={t(`agentSessions.actionFor.${action}`, {
            chat: subject,
          })}
          disabled={pendingKey !== null || !canRunSessionAction(action, brief)}
          isPending={pendingKey === `${brief.sessionId}:${action}`}
          onClick={() => onAction(action, brief.sessionId)}
          size="xs"
          variant="outline"
        >
          {t(`agentSessions.actions.${action}`)}
        </Button>
      ))}
    </div>
  );
}
