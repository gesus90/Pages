import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { ScrollViewport } from "@/app/components/ui/scroll-viewport";
import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";

import { formatLocalTime } from "./console-time";
import { useHistoryWindow } from "./use-history-window";

import type {
  AgentSessionEvent,
  AgentSessionEventKind,
  AgentSessionEventPage,
} from "@/definition/AgentSessionJournal";

// Tool output longer than this starts collapsed.
const COLLAPSE_LENGTH = 600;
// Pixels from the end that still count as reading the newest entry.
const NEAR_END = 48;

const KIND_TONE: Record<AgentSessionEventKind, string> = {
  user_instruction: "border-info bg-info-subtle",
  repair_instruction: "border-info bg-info-subtle",
  agent_message: "border-border bg-surface",
  tool_started: "border-border bg-muted",
  tool_completed: "border-border bg-muted",
  tool_failed: "border-destructive bg-muted",
  plan: "border-border bg-muted",
  status: "border-transparent bg-transparent text-muted-foreground",
  error: "border-destructive bg-surface text-destructive",
  recovery: "border-warning bg-surface",
  usage: "border-transparent bg-transparent text-muted-foreground",
};

const IS_TOOL: ReadonlySet<AgentSessionEventKind> = new Set([
  "tool_started",
  "tool_completed",
  "tool_failed",
]);

/** The first line of a tool entry: the title the call keeps from its start to its end. */
function toolHeader(event: AgentSessionEvent): string {
  return event.text.split("\n", 1)[0] ?? "";
}

/**
 * One entry per tool call: the start of a call drops out once its end, with
 * command and output, is in the history; a call that still runs shows its start.
 *
 * @param events - The entries in sequence order.
 */
export function mergeToolEvents(
  events: readonly AgentSessionEvent[],
): readonly AgentSessionEvent[] {
  const ended = new Map<string, number>();
  for (const event of events)
    if (event.kind === "tool_completed" || event.kind === "tool_failed") {
      const key = `${event.turn ?? ""}:${toolHeader(event)}`;
      ended.set(key, (ended.get(key) ?? 0) + 1);
    }
  return events.filter((event) => {
    if (event.kind !== "tool_started") return true;
    const key = `${event.turn ?? ""}:${toolHeader(event)}`;
    const count = ended.get(key) ?? 0;
    if (count === 0) return true;
    ended.set(key, count - 1);
    return false;
  });
}

function EventText({
  event,
  isExpanded,
  onExpandedChange,
}: {
  readonly event: AgentSessionEvent;
  readonly isExpanded: boolean;
  readonly onExpandedChange: (isExpanded: boolean) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const isTool = IS_TOOL.has(event.kind);
  const text = (
    <pre
      className={cn(
        "max-w-full text-sm break-words whitespace-pre-wrap",
        isTool ? "font-mono text-xs" : "font-sans",
      )}
    >
      {event.text}
    </pre>
  );
  if (!isTool || event.text.length <= COLLAPSE_LENGTH) return text;
  return (
    // The open state lives outside the entry, so it survives scrolling out of the window.
    <details
      open={isExpanded}
      onToggle={(toggle) => onExpandedChange(toggle.currentTarget.open)}
    >
      <summary className="cursor-pointer text-xs text-muted-foreground">
        {t("plans.console.expand", { count: event.text.length })}
      </summary>
      {text}
    </details>
  );
}

interface HistoryEntryProps {
  readonly event: AgentSessionEvent;
  readonly position: number;
  readonly count: number;
  readonly isExpanded: boolean;
  readonly onExpandedChange: (id: string, isExpanded: boolean) => void;
  readonly measure: (element: HTMLElement | null) => (() => void) | undefined;
}

function HistoryEntry({
  event,
  position,
  count,
  isExpanded,
  onExpandedChange,
  measure,
}: HistoryEntryProps): React.ReactElement {
  const { t } = useTranslation();
  return (
    <li
      ref={measure}
      data-event-id={event.id}
      aria-posinset={position}
      aria-setsize={count}
      className="pb-2"
    >
      <div className={cn("rounded-lg border px-3 py-2", KIND_TONE[event.kind])}>
        <p className="mb-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span className="font-medium">
            {t(`plans.console.kind.${event.kind}`)}
          </span>
          {event.turn !== null ? (
            <span>{t("plans.console.turn", { turn: event.turn })}</span>
          ) : null}
          <time dateTime={event.createdAt}>
            {formatLocalTime(event.createdAt) ?? event.createdAt}
          </time>
        </p>
        <EventText
          event={event}
          isExpanded={isExpanded}
          onExpandedChange={(isOpen) => onExpandedChange(event.id, isOpen)}
        />
        {event.isTruncated ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {t("plans.console.truncated")}
          </p>
        ) : null}
      </div>
    </li>
  );
}

/** Follows the newest entry only while the reader is at the end; otherwise the position stays. */
function useStickToEnd(
  layout: { readonly lastSequence: number; readonly version: number },
  navigation: HistoryNavigation,
  onViewport: (viewport: HTMLElement) => void,
): {
  readonly ref: React.RefObject<HTMLDivElement | null>;
  readonly onScroll: (event: React.UIEvent<HTMLElement>) => void;
} {
  const ref = useRef<HTMLDivElement | null>(null);
  const isAtEnd = useRef(true);
  useEffect(() => {
    const element = ref.current;
    const selection = window.getSelection();
    if (element && navigation.isFollowing && !selection?.toString())
      element.scrollTop = element.scrollHeight;
    // Measured heights move the end as well, so following stays at it.
  }, [layout.lastSequence, layout.version, navigation.isFollowing]);
  // The handler sits on the viewport itself, so the scrolled element is always there.
  function onScroll(event: React.UIEvent<HTMLElement>): void {
    const element = event.currentTarget;
    onViewport(element);
    isAtEnd.current =
      element.scrollHeight - element.scrollTop - element.clientHeight <
      NEAR_END;
    if (!isAtEnd.current) navigation.stopFollowing();
  }
  return { ref, onScroll };
}

interface HistoryNavigation {
  readonly hasEarlier: boolean;
  readonly isHistoryLoading: boolean;
  readonly isFollowing: boolean;
  readonly loadEarlier: () => void;
  readonly followLatest: () => void;
  readonly stopFollowing: () => void;
  readonly downloadAddress: string;
}

/** Earlier entries, following the newest one and the download of the whole journal. */
function HistoryToolbar({
  navigation,
}: {
  readonly navigation: HistoryNavigation;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      {navigation.hasEarlier ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={navigation.isHistoryLoading}
          onClick={navigation.loadEarlier}
        >
          {t("plans.console.loadEarlier")}
        </Button>
      ) : null}
      {!navigation.isFollowing ? (
        <Button size="sm" variant="ghost" onClick={navigation.followLatest}>
          {t("plans.console.followLatest")}
        </Button>
      ) : null}
      <a
        className="text-xs text-primary underline"
        href={navigation.downloadAddress}
        download
      >
        {t("plans.console.download")}
      </a>
      {navigation.isHistoryLoading ? (
        <span role="status" className="text-xs text-muted-foreground">
          {t("plans.console.earlierLoading")}
        </span>
      ) : null}
    </div>
  );
}

/**
 * The structured history: instructions, agent text, tools, status, warnings and recovery.
 *
 * @remarks
 * Texts are the redacted journal entries; they render as text, never as
 * markup. Only the entries near the viewport are drawn, however long the
 * journal is; the others keep their space, so scrolling reaches all of them.
 */
export function ConsoleHistory({
  events: allEvents,
  source,
  retainedFrom,
  navigation,
}: {
  readonly events: readonly AgentSessionEvent[];
  readonly source: AgentSessionEventPage["source"];
  readonly retainedFrom: number | null;
  readonly navigation: HistoryNavigation;
}): React.ReactElement {
  const { t } = useTranslation();
  // The window measures by list identity; a new list each render would measure forever.
  const events = useMemo(() => mergeToolEvents(allEvents), [allEvents]);
  const historyWindow = useHistoryWindow(events);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const scroll = useStickToEnd(
    {
      lastSequence: events.at(-1)?.sequence ?? 0,
      version: historyWindow.layoutVersion,
    },
    navigation,
    historyWindow.follow,
  );
  function changeExpanded(id: string, isExpanded: boolean): void {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (isExpanded) next.add(id);
      else next.delete(id);
      return next;
    });
  }
  return (
    <ScrollViewport
      axis="vertical"
      ref={scroll.ref}
      onScroll={scroll.onScroll}
      onViewportMeasure={historyWindow.follow}
      // While following, the end is kept by hand; the browser's anchoring would fight it.
      style={{ overflowAnchor: navigation.isFollowing ? "none" : "auto" }}
      containerClassName="min-h-0 flex-1"
      className="overflow-y-auto overscroll-contain px-5 py-4"
    >
      {source === "legacy_record" ? (
        <p className="mb-3 text-xs text-muted-foreground">
          {t("plans.console.legacy")}
        </p>
      ) : null}
      {retainedFrom !== null ? (
        <p className="mb-3 text-xs text-muted-foreground">
          {t("plans.console.retained")}
        </p>
      ) : null}
      <HistoryToolbar navigation={navigation} />
      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("plans.console.noEvents")}
        </p>
      ) : (
        <ol
          ref={historyWindow.listRef}
          role="log"
          // Entries drawn by scrolling are not news; only the followed end announces.
          aria-live={navigation.isFollowing ? "polite" : "off"}
          aria-relevant="additions"
          aria-label={t("plans.console.history")}
          style={{
            paddingTop: historyWindow.spaceBefore,
            paddingBottom: historyWindow.spaceAfter,
          }}
        >
          {events
            .slice(historyWindow.start, historyWindow.end)
            .map((event, offset) => (
              <HistoryEntry
                key={event.id}
                event={event}
                position={historyWindow.start + offset + 1}
                count={events.length}
                isExpanded={expanded.has(event.id)}
                onExpandedChange={changeExpanded}
                measure={historyWindow.measure}
              />
            ))}
        </ol>
      )}
    </ScrollViewport>
  );
}
