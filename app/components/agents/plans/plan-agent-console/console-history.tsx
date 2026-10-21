import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { ScrollViewport } from "@/app/components/ui/scroll-viewport";
import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";

import type {
  AgentSessionEvent,
  AgentSessionEventKind,
  AgentSessionEventPage,
} from "@/definition/AgentSessionJournal";

// The DOM holds at most this many entries until the reader asks for earlier ones.
const WINDOW_SIZE = 150;
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

function EventText({
  event,
}: {
  readonly event: AgentSessionEvent;
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
    <details>
      <summary className="cursor-pointer text-xs text-muted-foreground">
        {t("plans.console.expand", { count: event.text.length })}
      </summary>
      {text}
    </details>
  );
}

function HistoryEntry({
  event,
}: {
  readonly event: AgentSessionEvent;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <li className={cn("rounded-lg border px-3 py-2", KIND_TONE[event.kind])}>
      <p className="mb-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
        <span className="font-medium">
          {t(`plans.console.kind.${event.kind}`)}
        </span>
        {event.turn !== null ? (
          <span>{t("plans.console.turn", { turn: event.turn })}</span>
        ) : null}
        <time dateTime={event.createdAt}>{event.createdAt}</time>
      </p>
      <EventText event={event} />
      {event.isTruncated ? (
        <p className="mt-1 text-xs text-muted-foreground">
          {t("plans.console.truncated")}
        </p>
      ) : null}
    </li>
  );
}

/** Follows the newest entry only while the reader is at the end; otherwise the position stays. */
function useStickToEnd(lastSequence: number): {
  readonly ref: React.RefObject<HTMLDivElement | null>;
  readonly onScroll: () => void;
} {
  const ref = useRef<HTMLDivElement | null>(null);
  const isAtEnd = useRef(true);
  useEffect(() => {
    const element = ref.current;
    if (element && isAtEnd.current) element.scrollTop = element.scrollHeight;
  }, [lastSequence]);
  function onScroll(): void {
    const element = ref.current;
    if (!element) return;
    isAtEnd.current =
      element.scrollHeight - element.scrollTop - element.clientHeight <
      NEAR_END;
  }
  return { ref, onScroll };
}

/**
 * The structured history: instructions, agent text, tools, status, warnings and recovery.
 *
 * @remarks
 * Texts are the redacted journal entries; they render as text, never as
 * markup. Only the newest entries are drawn until the reader asks for more.
 */
export function ConsoleHistory({
  events,
  source,
  retainedFrom,
}: {
  readonly events: readonly AgentSessionEvent[];
  readonly source: AgentSessionEventPage["source"];
  readonly retainedFrom: number | null;
}): React.ReactElement {
  const { t } = useTranslation();
  const [shown, setShown] = useState(WINDOW_SIZE);
  const visible = events.slice(-shown);
  const hidden = events.length - visible.length;
  // The newest sequence keeps growing after the list reached its size limit.
  const scroll = useStickToEnd(events.at(-1)?.sequence ?? 0);
  return (
    <ScrollViewport
      axis="vertical"
      ref={scroll.ref}
      onScroll={scroll.onScroll}
      containerClassName="min-h-0 flex-1"
      className="overflow-y-auto overscroll-contain px-5 py-4"
    >
      {source === "legacy_record" ? (
        <p className="mb-3 text-xs text-muted-foreground">
          {t("plans.console.legacy")}
        </p>
      ) : null}
      {retainedFrom !== null && hidden === 0 ? (
        <p className="mb-3 text-xs text-muted-foreground">
          {t("plans.console.retained")}
        </p>
      ) : null}
      {hidden > 0 ? (
        <Button
          size="sm"
          variant="ghost"
          className="mb-3"
          onClick={() => setShown((value) => value + WINDOW_SIZE)}
        >
          {t("plans.console.earlier", { count: hidden })}
        </Button>
      ) : null}
      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("plans.console.noEvents")}
        </p>
      ) : (
        <ol
          role="log"
          aria-live="polite"
          aria-relevant="additions"
          aria-label={t("plans.console.history")}
          className="space-y-2"
        >
          {visible.map((event) => (
            <HistoryEntry key={event.id} event={event} />
          ))}
        </ol>
      )}
    </ScrollViewport>
  );
}
