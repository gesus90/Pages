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
 * The agents at work in the opened chat above the input (PAGE-381), each
 * with a small avatar and what it does now; an entry goes once its agent is
 * done. In a group several stand side by side.
 */
export function ChatPageActivityRow({
  entries,
}: {
  readonly entries: readonly AgentActivity[];
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (entries.length === 0) return null;
  return (
    <ul
      aria-label={t("chatPage.liveAnswer.activityLabel")}
      aria-live="polite"
      className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1.5"
    >
      {entries.map(({ agent, activity }) => (
        <li
          key={agent.id}
          className="inline-flex min-w-0 items-center gap-1.5 text-xs text-foreground"
        >
          <ParticipantAvatar
            participant={agent}
            size={22}
            className="shrink-0 rounded-full ring-2 ring-primary"
          />
          <span className="min-w-0 truncate">
            <ActivityText name={agent.name} activity={activity} />
          </span>
        </li>
      ))}
    </ul>
  );
}
