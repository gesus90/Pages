import { useTranslation } from "react-i18next";

import { SESSION_STATE_DOT } from "@/app/components/agent-settings/agent-session-display";
import { cn } from "@/app/lib/cn";

import type {
  AgentChatSessionBrief,
  AgentChatSessionState,
} from "@/definition/AgentChatSession";

/** The color of the state word; a session that is ready stays quiet. */
const STATE_TEXT: Readonly<Record<AgentChatSessionState, string>> = {
  working: "text-warning",
  ready: "text-muted-foreground",
  resting: "text-muted-foreground",
  restart_needed: "text-destructive",
};

/**
 * What an agent does in this chat, from its session (PAGE-376): "arbeitet …",
 * "bereit", "ruht" or "Neustart nötig", and how many messages wait for their
 * turn.
 *
 * @returns The status, or `null` while the agent has no session in the chat.
 */
export function AgentSessionStatus({
  brief,
}: {
  readonly brief: AgentChatSessionBrief | undefined;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (brief === undefined) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span
        className={cn(
          "inline-flex items-center gap-1",
          STATE_TEXT[brief.state],
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "size-1.5 rounded-full",
            SESSION_STATE_DOT[brief.state],
          )}
        />
        {t(`chatPage.agentStatus.${brief.state}`)}
      </span>
      {brief.waitingMessages > 0 ? (
        <span className="text-muted-foreground">
          {t("chatPage.agentStatus.waiting", { count: brief.waitingMessages })}
        </span>
      ) : null}
    </span>
  );
}
