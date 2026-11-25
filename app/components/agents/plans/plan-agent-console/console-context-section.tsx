import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { SIDEBAR_TITLE_CLASS } from "./console-sidebar-parts";

import type {
  AgentSessionContextUsage,
  AgentSessionView,
} from "@/definition/AgentSessionJournal";

/**
 * The share of the window in use, from 0 to 100; `null` while the window is unknown.
 * @remarks
 * A known window without a reading yet stands as 0 %: the attempt has not
 * reported an occupancy, and the bar stays empty until it does. Without a
 * window there is no share, so no bar and no percentage is shown.
 */
function contextShare(context: AgentSessionContextUsage): number | null {
  const { contextUsed: used, contextLimit: limit } = context;
  if (limit === null || limit <= 0) return null;
  return Math.min(100, ((used ?? 0) / limit) * 100);
}

/** From this share on the bar warns; from the second one it signals an almost full window. */
const WARNING_SHARE = 85;
const DANGER_SHARE = 95;

/** The fill of the bar: the primary color, `warning` from 85 %, `destructive` from 95 %. */
function barFillClass(share: number): string {
  if (share >= DANGER_SHARE) return "bg-destructive";
  return share >= WARNING_SHARE ? "bg-warning" : "bg-primary";
}

/** The occupancy bar with a minimum 3 px fill when usage is positive. */
function ContextBar({
  share,
  label,
}: {
  readonly share: number;
  readonly label: string;
}): React.ReactElement {
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(share)}
      data-context-bar=""
      className="mt-2.5 h-1.5 overflow-hidden rounded-[3px] bg-agent-console-track"
    >
      <div
        className={cn("h-full rounded-[3px]", barFillClass(share))}
        style={{ width: share > 0 ? `max(3px, ${share}%)` : 0 }}
      />
    </div>
  );
}

/**
 * Formats the occupancy as "used / window".
 * @remarks
 * Before the first reading a known window stands as `0 / window`. An unknown
 * window keeps the occupancy and shows the shared placeholder of the sidebar
 * as its denominator; without both values only the placeholder stands.
 */
function contextValue(
  context: AgentSessionContextUsage,
  options: {
    readonly numbers: Intl.NumberFormat;
    readonly unknown: string;
  },
): string {
  const { contextUsed: used, contextLimit: limit } = context;
  if (limit === null && used === null) return options.unknown;
  const usedText = options.numbers.format(used ?? 0);
  const limitText =
    limit === null ? options.unknown : options.numbers.format(limit);
  return `${usedText} / ${limitText}`;
}

/**
 * The block "Kontext", fixed 60 px high: how much of the model's window the session occupies.
 * @remarks
 * The same block serves every provider. The session view holds the last
 * reported values of the selected attempt's model and takes a window the
 * adapter did not report from the model's catalog entry. The bar is shown
 * whenever the window is known, empty until the first reading. The height
 * holds the 12 px padding of a sidebar block above and below, the title line
 * and the bar, with no empty band below the bar; it stays the same without a
 * bar, so the blocks below do not move when the window becomes known.
 */
export function ConsoleContextSection({
  view,
}: {
  readonly view: AgentSessionView;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  const title = t("plans.console.terminal.sidebar.context");
  const { context } = view;
  const numbers = new Intl.NumberFormat(i18n.language);
  const share = contextShare(context);
  return (
    <section
      aria-label={title}
      data-console-context=""
      className="h-15 min-w-0 shrink-0 py-3"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className={SIDEBAR_TITLE_CLASS}>{title}</h3>
        <span
          data-context-value=""
          className="min-w-0 truncate text-[13px] text-agent-console-muted tabular-nums"
        >
          {contextValue(context, {
            numbers,
            unknown: t("plans.console.terminal.sidebar.unknown"),
          })}
        </span>
      </div>
      {share === null ? null : <ContextBar share={share} label={title} />}
    </section>
  );
}
