import { useTranslation } from "react-i18next";

import { ParticipantAvatar } from "../chat-page-avatar";

import type { VirtualParticipant } from "@/definition/VirtualChat";
import type { LiveActivity } from "./live-answer-state";

/** One agent at work in the opened chat and what it does. */
export interface AgentActivity {
  readonly agent: Pick<
    VirtualParticipant,
    "id" | "name" | "color" | "avatarImageUrl"
  >;
  readonly activity: LiveActivity;
}

/**
 * The text of one activity, such as "Ed liest ConversationEvents.ts" or
 * "Mei testet · 1 Werkzeug läuft".
 */
function ActivityText({
  name,
  activity,
}: {
  readonly name: string;
  readonly activity: LiveActivity;
}): React.ReactElement {
  const { t } = useTranslation();
  if (activity.kind === "images")
    return (
      <>
        {t("chatPage.liveAnswer.activity.images", {
          name,
          count: activity.count,
        })}
      </>
    );
  if (activity.kind !== "tool")
    return <>{t(`chatPage.liveAnswer.activity.${activity.kind}`, { name })}</>;
  const target = activity.target === "" ? "…" : activity.target;
  return (
    <>
      {t(`chatPage.liveAnswer.activity.${activity.action}`, { name, target })}
      <span className="text-muted-foreground">
        {" · "}
        {t("chatPage.liveAnswer.activity.running", { count: activity.running })}
      </span>
    </>
  );
}

/**
 * The agents at work in the opened chat above the input, each
 * with a small avatar and what it does now; an entry goes once its agent is
 * done. In a group several stand side by side.
 * @remarks
 * The line is always 20 px high and stays empty while no agent works, so
 * the field below it never moves.
 */
export function ChatPageActivityRow({
  entries,
}: {
  readonly entries: readonly AgentActivity[];
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <ul
      aria-label={t("chatPage.liveAnswer.activityLabel")}
      aria-live="polite"
      className="mb-2 flex h-5 min-w-0 items-center gap-x-4 overflow-hidden whitespace-nowrap"
      data-activity-row=""
    >
      {entries.map(({ agent, activity }) => (
        <li
          key={agent.id}
          className="inline-flex min-w-0 items-center gap-1.5 text-xs text-foreground"
        >
          <ParticipantAvatar
            participant={agent}
            size={18}
            className="shrink-0 rounded-full ring-1 ring-primary"
          />
          <span className="min-w-0 truncate">
            <ActivityText name={agent.name} activity={activity} />
          </span>
        </li>
      ))}
    </ul>
  );
}
