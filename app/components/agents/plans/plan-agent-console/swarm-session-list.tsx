import { Check, Minus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { ScrollViewport } from "@/app/components/ui/scroll-viewport";
import { cn } from "@/app/lib/cn";

import { formatMinuteTime } from "./console-time";
import { SwarmSessionPreview } from "./swarm-session-preview";

import type { PlanSwarmSessionStatus } from "@/definition/AgentPlanSwarmSession";

/** What the card of one session shows. */
export interface SwarmCardData {
  readonly stepId: string;
  /** „Haupt“ or `H1`. */
  readonly name: string;
  readonly status: PlanSwarmSessionStatus;
  readonly model: string;
  /** Whether the session got an attempt; without one it did not start. */
  readonly hasSession: boolean;
  /** Whether the miniature is read again every 30 seconds. */
  readonly isLive: boolean;
  /** The rows of the miniature; empty without output. */
  readonly rows: readonly string[];
  /** The last line of the output, for the spoken name. */
  readonly lastLine: string | null;
  /** When the miniature was read, in milliseconds since the epoch. */
  readonly readAt: number | null;
}

/** Which of the two pickers of a swarm console draws. */
type PickerKind = "column" | "bar";

/**
 * What survives the new mount a selection causes: the scroll position of each
 * picker and the picker that had the keyboard focus.
 */
export interface SwarmListMemory {
  scroll: Record<PickerKind, number>;
  restoreFocus: { readonly kind: PickerKind; readonly stepId: string } | null;
}

interface SwarmListProps {
  readonly cards: readonly SwarmCardData[];
  readonly selectedId: string;
  readonly memory: React.RefObject<SwarmListMemory>;
  readonly onSelect: (stepId: string) => void;
}

const STATUS_STYLE: Readonly<Record<PlanSwarmSessionStatus, string>> = {
  running: "border-primary bg-primary-subtle text-status-active",
  waiting: "border-dashed border-border bg-transparent text-muted-foreground",
  succeeded: "border-success bg-success-subtle text-success",
  failed: "border-destructive bg-destructive-subtle text-destructive",
  cancelled: "border-border bg-muted text-muted-foreground",
};

const DOT_STYLE: Readonly<Record<PlanSwarmSessionStatus, string>> = {
  running: "bg-primary",
  waiting: "bg-muted-foreground",
  succeeded: "bg-success",
  failed: "bg-destructive",
  cancelled: "bg-muted-foreground",
};

const FOCUS_RING =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

/** The mark in front of the word; the word always stays, so color is never the only sign. */
function StatusMark({
  status,
}: {
  readonly status: PlanSwarmSessionStatus;
}): React.ReactElement {
  if (status === "succeeded")
    return <Check aria-hidden="true" className="size-3 shrink-0" />;
  if (status === "failed")
    return <X aria-hidden="true" className="size-3 shrink-0" />;
  if (status === "cancelled")
    return <Minus aria-hidden="true" className="size-3 shrink-0" />;
  return (
    <span
      aria-hidden="true"
      className={cn("size-1.5 shrink-0 rounded-full", DOT_STYLE[status])}
    />
  );
}

/** 20 px high with a 6 px radius, a 1 px border and the word of the state. */
function StatusChip({
  status,
}: {
  readonly status: PlanSwarmSessionStatus;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-md border px-1.5 text-[11px] leading-4 font-semibold",
        STATUS_STYLE[status],
      )}
    >
      <StatusMark status={status} />
      {t(`plans.console.swarm.status.${status}`)}
    </span>
  );
}

/** The spoken name of a card: session, state and the last line. */
function useCardName(card: SwarmCardData): string {
  const { t } = useTranslation();
  const status = t(`plans.console.swarm.status.${card.status}`);
  if (card.lastLine === null) return `${card.name}, ${status}`;
  return `${card.name}, ${status}, ${card.lastLine}`;
}

/** The dashed area that stands where the miniature would: same size, so nothing jumps. */
function EmptyPreview({
  card,
}: {
  readonly card: SwarmCardData;
}): React.ReactElement {
  const { t } = useTranslation();
  const key =
    !card.hasSession && card.status === "waiting" ? "notStarted" : "noOutput";
  return (
    <div
      aria-hidden="true"
      className="flex h-[88px] w-[186px] shrink-0 items-center justify-center rounded-lg border border-dashed border-border px-2 text-center text-[11px] leading-4 text-muted-foreground"
    >
      {t(`plans.console.swarm.${key}`)}
    </div>
  );
}

function CardFooter({
  card,
}: {
  readonly card: SwarmCardData;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  const time =
    card.readAt === null ? "–" : formatMinuteTime(card.readAt, i18n.language);
  let rhythm = "";
  if (card.hasSession)
    rhythm = t(`plans.console.swarm.${card.isLive ? "rhythm" : "final"}`);
  return (
    <span className="flex justify-between gap-2 text-[11px] leading-[14px] text-muted-foreground">
      <span>{t("plans.console.swarm.readAt", { time })}</span>
      <span>{rhythm}</span>
    </span>
  );
}

interface CardProps {
  readonly card: SwarmCardData;
  readonly isSelected: boolean;
  readonly isFocusStop: boolean;
  readonly onSelect: (stepId: string) => void;
  readonly onFocus: (stepId: string) => void;
}

/** One session in the column: name, state, model, miniature and the time of the last read. */
function SessionCard(props: CardProps): React.ReactElement {
  const { t } = useTranslation();
  const { card, isSelected } = props;
  const name = useCardName(card);
  return (
    <button
      type="button"
      data-swarm-session={card.stepId}
      aria-current={isSelected ? "true" : undefined}
      aria-label={name}
      title={t("plans.console.swarm.open")}
      tabIndex={props.isFocusStop ? 0 : -1}
      onClick={() => props.onSelect(card.stepId)}
      onFocus={() => props.onFocus(card.stepId)}
      className={cn(
        "flex w-full cursor-pointer flex-col gap-1 rounded-xl border p-2.5 text-left",
        FOCUS_RING,
        isSelected
          ? "border-primary bg-primary-subtle"
          : "border-border bg-surface hover:bg-muted",
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[13px] leading-5 font-bold text-foreground">
          {card.name}
        </span>
        <StatusChip status={card.status} />
      </span>
      <span
        className="truncate text-[11px] leading-4 text-muted-foreground"
        title={card.model}
      >
        {card.model || t("plans.console.swarm.unknown")}
      </span>
      {card.rows.length > 0 ? (
        <SwarmSessionPreview rows={card.rows} />
      ) : (
        <EmptyPreview card={card} />
      )}
      <CardFooter card={card} />
    </button>
  );
}

/** One session in the bar: 44 px high with its name and a dot of the state. */
function BarChip(props: CardProps): React.ReactElement {
  const { t } = useTranslation();
  const { card, isSelected } = props;
  const name = useCardName(card);
  const status = t(`plans.console.swarm.status.${card.status}`);
  return (
    <button
      type="button"
      data-swarm-session={card.stepId}
      aria-current={isSelected ? "true" : undefined}
      aria-label={name}
      title={`${card.name} · ${status}`}
      tabIndex={props.isFocusStop ? 0 : -1}
      onClick={() => props.onSelect(card.stepId)}
      onFocus={() => props.onFocus(card.stepId)}
      className={cn(
        "flex h-11 shrink-0 cursor-pointer items-center gap-2 rounded-xl border px-3",
        FOCUS_RING,
        isSelected
          ? "border-primary bg-primary-subtle"
          : "border-border bg-surface hover:bg-muted",
      )}
    >
      <span className="text-[13px] leading-5 font-semibold text-foreground">
        {card.name}
      </span>
      <span
        aria-hidden="true"
        className={cn("size-2 shrink-0 rounded-full", DOT_STYLE[card.status])}
      />
    </button>
  );
}

const MOVES: Readonly<Record<string, number>> = {
  ArrowUp: -1,
  ArrowLeft: -1,
  ArrowDown: 1,
  ArrowRight: 1,
};

/** The button a navigation key leads to; `null` for any other key. */
function targetOf(
  key: string,
  buttons: readonly HTMLButtonElement[],
): HTMLButtonElement | null {
  if (key === "Home") return buttons[0] ?? null;
  if (key === "End") return buttons.at(-1) ?? null;
  const step = MOVES[key];
  if (step === undefined) return null;
  const current = buttons.findIndex(
    (button) => button === document.activeElement,
  );
  const next = Math.min(buttons.length - 1, Math.max(0, current + step));
  return buttons[next] ?? null;
}

interface RovingList {
  readonly listRef: React.RefObject<HTMLUListElement | null>;
  readonly focusId: string;
  readonly onFocus: (stepId: string) => void;
  readonly onKeyDown: (event: React.KeyboardEvent) => void;
}

/**
 * The picker is one tab stop; the arrow keys, Home and End move the focus
 * between its sessions, and Enter or Space on a focused one selects it.
 */
function useRovingList(
  selectedId: string,
  kind: PickerKind,
  memory: React.RefObject<SwarmListMemory>,
): RovingList {
  const listRef = useRef<HTMLUListElement | null>(null);
  const [focusId, setFocusId] = useState(selectedId);
  useEffect(() => {
    const restore = memory.current.restoreFocus;
    if (restore?.kind !== kind) return;
    memory.current.restoreFocus = null;
    setFocusId(restore.stepId);
    listRef.current
      ?.querySelector<HTMLButtonElement>(
        `button[data-swarm-session="${CSS.escape(restore.stepId)}"]`,
      )
      ?.focus({ preventScroll: true });
  }, [kind, memory]);
  function onKeyDown(event: React.KeyboardEvent): void {
    const buttons = [
      ...(listRef.current?.querySelectorAll<HTMLButtonElement>(
        "button[data-swarm-session]",
      ) ?? []),
    ];
    const target = targetOf(event.key, buttons);
    if (!target) return;
    event.preventDefault();
    target.focus();
  }
  return { listRef, focusId, onFocus: setFocusId, onKeyDown };
}

/** Keeps the scroll position of a picker across the new mount a selection causes. */
function useKeptScroll(
  kind: PickerKind,
  memory: React.RefObject<SwarmListMemory>,
): {
  readonly ref: React.RefObject<HTMLElement | null>;
  readonly onScroll: (event: React.UIEvent<HTMLElement>) => void;
} {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const kept = memory.current.scroll[kind];
    if (kind === "column") ref.current?.scroll({ top: kept });
    else ref.current?.scroll({ left: kept });
  }, [kind, memory]);
  return {
    ref,
    onScroll: (event) => {
      const { scrollTop, scrollLeft } = event.currentTarget;
      memory.current.scroll[kind] = kind === "column" ? scrollTop : scrollLeft;
    },
  };
}

function PickerItems(
  props: SwarmListProps & { readonly kind: PickerKind },
): React.ReactElement {
  const { t } = useTranslation();
  const roving = useRovingList(props.selectedId, props.kind, props.memory);
  const Item = props.kind === "column" ? SessionCard : BarChip;
  function select(stepId: string): void {
    props.memory.current.restoreFocus = { kind: props.kind, stepId };
    props.onSelect(stepId);
  }
  return (
    <ul
      ref={roving.listRef}
      aria-label={t("plans.console.swarm.title")}
      onKeyDown={roving.onKeyDown}
      className={cn(
        props.kind === "column" ? "flex flex-col gap-2" : "flex gap-2",
      )}
    >
      {props.cards.map((card) => (
        <li
          key={card.stepId}
          className={props.kind === "bar" ? "shrink-0" : ""}
        >
          <Item
            card={card}
            isSelected={card.stepId === props.selectedId}
            isFocusStop={card.stepId === roving.focusId}
            onSelect={select}
            onFocus={roving.onFocus}
          />
        </li>
      ))}
    </ul>
  );
}

/**
 * The sessions of a swarm as a 232 px column between terminal and details.
 * @remarks
 * Visible from 1140 px of the console on. The cards keep 8 px apart and
 * scroll without a bar; a transparent fade of 40 px marks more cards.
 */
export function SwarmSessionColumn(props: SwarmListProps): React.ReactElement {
  const { t } = useTranslation();
  const scroll = useKeptScroll("column", props.memory);
  return (
    <aside
      aria-label={t("plans.console.swarm.title")}
      className="hidden w-[232px] shrink-0 flex-col border-l border-border bg-surface pt-3.5 @min-[1140px]:flex"
    >
      <div className="flex items-center justify-between gap-2 px-3 pb-3">
        <h3 className="text-sm leading-5 font-[650] text-foreground">
          {t("plans.console.swarm.title")}
        </h3>
        <span className="text-[13px] text-muted-foreground tabular-nums">
          {props.cards.length}
        </span>
      </div>
      <ScrollViewport
        axis="vertical"
        fadeMode="mask"
        fadeEdges={["top", "bottom"]}
        fadeTop={40}
        fadeBottom={40}
        hideScrollbar
        containerClassName="min-h-0 flex-1"
        className="px-3 pb-3"
        ref={scroll.ref}
        onScroll={scroll.onScroll}
      >
        <PickerItems {...props} kind="column" />
      </ScrollViewport>
    </aside>
  );
}

/**
 * The sessions of a swarm as a bar above the terminal, below 1140 px of the console.
 * @remarks
 * Chips are 44 px high and 8 px apart; the bar scrolls sideways without a bar
 * and a transparent fade of 48 px marks more chips on the right. The
 * miniature lines are left out; the state stands in the tooltip and the name.
 */
export function SwarmSessionBar(props: SwarmListProps): React.ReactElement {
  const scroll = useKeptScroll("bar", props.memory);
  return (
    <div className="shrink-0 border-b border-border bg-surface @min-[1140px]:hidden">
      <ScrollViewport
        axis="horizontal"
        fadeMode="mask"
        fadeEdges={["right"]}
        fadeRight={48}
        hideScrollbar
        className="p-3"
        ref={scroll.ref}
        onScroll={scroll.onScroll}
      >
        <PickerItems {...props} kind="bar" />
      </ScrollViewport>
    </div>
  );
}
