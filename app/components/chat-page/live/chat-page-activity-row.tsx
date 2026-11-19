import { useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { ParticipantAvatar } from "../chat-page-avatar";

import type { RefObject } from "react";
import type { VirtualParticipant } from "@/definition/VirtualChat";
import type { LiveActivity } from "./live-answer-state";

/** One agent at work in the opened chat and what it does. */
export interface AgentActivity {
  readonly agent: Pick<
    VirtualParticipant,
    "id" | "name" | "color" | "avatarImageUrl"
  >;
  readonly activity: LiveActivity;
  /** How many messages wait for the agent's turn in this chat. */
  readonly waitingMessages: number;
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

/** The look of the chip of an agent at work: a thin accent border, no fill. */
const CHIP_CLASS =
  "inline-flex h-6 items-center gap-1.5 rounded-full border border-primary/55 pr-2.5 pl-0.5 text-xs whitespace-nowrap text-foreground";

/** The chip "+N" for the agents at work that do not fit into the line. */
const MORE_CLASS =
  "inline-flex h-6 shrink-0 items-center rounded-full border border-border px-2.5 text-xs whitespace-nowrap text-muted-foreground";

/** The chip of one agent at work: avatar with its ring, what it does, and the messages waiting. */
function ActivityChip({
  entry,
  className,
}: {
  readonly entry: AgentActivity;
  readonly className?: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const { agent, activity, waitingMessages } = entry;
  return (
    <span className={cn(CHIP_CLASS, className)} data-activity-chip="">
      <ParticipantAvatar
        participant={agent}
        size={18}
        className="shrink-0 ring-[1.5px] ring-primary"
      />
      <span className="min-w-0 truncate">
        <ActivityText name={agent.name} activity={activity} />
        {waitingMessages > 0 ? (
          <span className="text-muted-foreground">
            {" · "}
            {t("chatPage.agentStatus.waiting", { count: waitingMessages })}
          </span>
        ) : null}
      </span>
    </span>
  );
}

/** What the chips say, so the line measures them again when it changes. */
function contentKeyOf(entries: readonly AgentActivity[]): string {
  return JSON.stringify(
    entries.map(({ agent, activity, waitingMessages }) => [
      agent.id,
      agent.name,
      activity,
      waitingMessages,
    ]),
  );
}

/**
 * The agents at work in the opened chat above the input, each as a chip
 * with its avatar and what it does now; a chip goes once its agent is done.
 * @remarks
 * The line is always 24 px high and stays empty while no agent works, so
 * the field below it never moves. Agents that rest, are ready or need a
 * restart have no chip; their state stands in the chat head. In a group the
 * chips stand side by side; those that do not fit are counted by a chip
 * "+N" that names them in its title, and the line never wraps. Only the
 * text of a chip is truncated, never its avatar and ring.
 */
export function ChatPageActivityRow({
  entries,
}: {
  readonly entries: readonly AgentActivity[];
}): React.ReactElement {
  const { t } = useTranslation();
  const chips = useFittingChips(contentKeyOf(entries));
  const shown = entries.slice(0, chips.visibleCount);
  const hidden = entries.slice(shown.length);
  return (
    <div className="relative mb-2 h-6 overflow-hidden">
      <ul
        ref={chips.row}
        aria-label={t("chatPage.liveAnswer.activityLabel")}
        aria-live="polite"
        className="flex h-6 min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap"
        data-activity-row=""
      >
        {shown.map((entry, index) => (
          <li
            key={entry.agent.id}
            className={cn("flex min-w-0", index === 0 ? "shrink" : "shrink-0")}
          >
            <ActivityChip entry={entry} className="max-w-full" />
          </li>
        ))}
        {hidden.length > 0 ? (
          <li className="flex shrink-0">
            <span
              className={MORE_CLASS}
              title={hidden.map((entry) => entry.agent.name).join(", ")}
            >
              {`+${String(hidden.length)}`}
            </span>
          </li>
        ) : null}
      </ul>
      <div
        ref={chips.measurer}
        aria-hidden="true"
        className="pointer-events-none invisible absolute top-0 left-0 flex w-max gap-2 whitespace-nowrap"
      >
        {entries.map((entry) => (
          <ActivityChip
            key={entry.agent.id}
            entry={entry}
            className="shrink-0"
          />
        ))}
        <span className={MORE_CLASS}>{`+${String(entries.length)}`}</span>
      </div>
    </div>
  );
}

const CHIP_GAP_PX = 8;

interface FittingChips {
  readonly row: RefObject<HTMLUListElement | null>;
  readonly measurer: RefObject<HTMLDivElement | null>;
  readonly visibleCount: number;
}

function fittingChipCount(
  widths: readonly number[],
  plusWidth: number,
  available: number,
): number {
  let used = 0;
  let count = 0;
  for (const [index, width] of widths.entries()) {
    const next = used + (index === 0 ? 0 : CHIP_GAP_PX) + width;
    const isLast = index === widths.length - 1;
    const reserve = isLast ? 0 : CHIP_GAP_PX + plusWidth;
    if (next + reserve > available) break;
    used = next;
    count = index + 1;
  }
  return Math.min(widths.length, Math.max(1, count));
}

function useFittingChips(contentKey: string): FittingChips {
  const row = useRef<HTMLUListElement | null>(null);
  const measurer = useRef<HTMLDivElement | null>(null);
  const [visibleCount, setVisibleCount] = useState(Number.POSITIVE_INFINITY);

  useLayoutEffect(() => {
    const line = row.current;
    const copies = measurer.current;
    if (!line || !copies) return undefined;
    function measure(): void {
      if (!line || !copies) return;
      const items = [...copies.children].filter(
        (element): element is HTMLElement => element instanceof HTMLElement,
      );
      const plus = items.pop();
      const widths = items.map((element) => element.offsetWidth);
      setVisibleCount(
        fittingChipCount(widths, plus?.offsetWidth ?? 0, line.clientWidth),
      );
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(line);
    return () => observer.disconnect();
  }, [contentKey]);

  return { row, measurer, visibleCount };
}
