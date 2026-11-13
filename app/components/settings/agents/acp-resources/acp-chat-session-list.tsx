import { useTranslation } from "react-i18next";

import { AgentCheckTime } from "../agent-check-time";

import type { AcpChatSessionView } from "@/definition/AcpResource";

interface AgentSessions {
  readonly agentId: string;
  readonly agentName: string;
  readonly sessions: readonly AcpChatSessionView[];
}

/** Groups the sessions by agent, agents by name and sessions by their last activity. */
function groupByAgent(
  sessions: readonly AcpChatSessionView[],
): readonly AgentSessions[] {
  const groups = new Map<string, AgentSessions>();
  for (const session of sessions) {
    const group = groups.get(session.agentId);
    groups.set(session.agentId, {
      agentId: session.agentId,
      agentName: session.agentName,
      sessions: [...(group?.sessions ?? []), session],
    });
  }
  return [...groups.values()]
    .sort((first, second) => first.agentName.localeCompare(second.agentName))
    .map((group) => ({
      ...group,
      sessions: [...group.sessions].sort((first, second) =>
        second.lastActivityAt.localeCompare(first.lastActivityAt),
      ),
    }));
}

function SessionItem({
  session,
}: {
  readonly session: AcpChatSessionView;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <li className="space-y-0.5">
      <p>
        {session.conversation} ·{" "}
        {t(`settings.agents.resources.chatSessions.${session.state}`)}
      </p>
      <p className="text-xs text-muted-foreground">
        {t("settings.agents.resources.chatSessions.lastActivity")}{" "}
        <AgentCheckTime checkedAt={session.lastActivityAt} />
      </p>
      <p className="break-all text-xs text-muted-foreground">
        {t("settings.agents.resources.entry.instance")}: {session.instanceId}
      </p>
    </li>
  );
}

/**
 * The chat sessions each agent holds open between the rounds of its
 * conversations (PAGE-335), with the conversation and the last activity.
 */
export function AcpChatSessionList({
  sessions,
}: {
  readonly sessions: readonly AcpChatSessionView[];
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <section className="space-y-2">
      <h3 className="font-medium">
        {t("settings.agents.resources.chatSessions.title")}
      </h3>
      {sessions.length === 0 ? (
        <p className="text-muted-foreground">
          {t("settings.agents.resources.chatSessions.none")}
        </p>
      ) : (
        <ul className="space-y-2">
          {groupByAgent(sessions).map((group) => (
            <li
              key={group.agentId}
              className="space-y-2 rounded-md border border-border p-3"
            >
              <p className="font-medium">
                {t("settings.agents.resources.chatSessions.agent", {
                  name: group.agentName,
                  count: group.sessions.length,
                })}
              </p>
              <ul className="space-y-2">
                {group.sessions.map((session) => (
                  <SessionItem key={session.instanceId} session={session} />
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
