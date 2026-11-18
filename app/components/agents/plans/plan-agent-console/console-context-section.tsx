import { useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { SIDEBAR_TITLE_CLASS } from "./console-sidebar-parts";

import type {
  AgentSessionContextUsage,
  AgentSessionView,
} from "@/definition/AgentSessionJournal";

/** The occupancy the console shows: the last one that named a value. */
interface ShownContext {
  readonly used: number | null;
  readonly limit: number | null;
}

interface KeptContext extends ShownContext {
  /** The attempt the values belong to; another attempt starts empty. */
  readonly attemptId: string;
}

/**
 * Keeps the last reported occupancy until a new one arrives.
 * @param context - The occupancy of the current session view.
 * @param attemptId - The attempt the view belongs to.
 * @returns The occupancy to show: the current values, or for a value a
 * report left out, the last one of the same attempt.
 * @remarks
 * The server keeps the last value as well; this keeps it also across a view
 * that arrives without it, such as a refresh between two readings.
 */
function useReportedContext(
  context: AgentSessionContextUsage,
  attemptId: string,
): ShownContext {
  const [kept, setKept] = useState<KeptContext | null>(null);
  const previous = kept?.attemptId === attemptId ? kept : null;
  const shown: ShownContext = {
    used: context.contextUsed ?? previous?.used ?? null,
    limit: context.contextLimit ?? previous?.limit ?? null,
  };
  const hasChanged =
    previous === null
      ? shown.used !== null || shown.limit !== null
      : previous.used !== shown.used || previous.limit !== shown.limit;
  if (hasChanged) setKept({ attemptId, ...shown });
  return shown;
}

/** The share of the window in use, from 0 to 100; `null` without both values. */
function contextShare(context: ShownContext): number | null {
  const { used, limit } = context;
  if (used === null || limit === null || limit <= 0) return null;
  return Math.min(100, (used / limit) * 100);
}

/** From this share on the bar warns; from the second one it signals an almost full window. */
const WARNING_SHARE = 85;
const DANGER_SHARE = 95;

/** The fill of the bar: the primary color, `warning` from 85 %, `destructive` from 95 %. */
function barFillClass(share: number): string {
  if (share >= DANGER_SHARE) return "bg-destructive";
  return share >= WARNING_SHARE ? "bg-warning" : "bg-primary";
}

/** The bar of the occupancy: 6 px high with a 3 px radius, at least 3 px filled. */
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
        style={{ width: `max(3px, ${share}%)` }}
      />
    </div>
  );
}

/** The value at the right of the title: nothing reported yet, only the occupancy, or occupancy and window. */
function contextValue(
  context: ShownContext,
  options: {
    readonly numbers: Intl.NumberFormat;
    readonly t: ReturnType<typeof useTranslation>["t"];
  },
): string {
  const key = "plans.console.terminal.sidebar";
  const { used, limit } = context;
  if (used === null) return options.t(`${key}.contextNotReported`);
  if (limit === null)
    return options.t(`${key}.contextTokens`, {
      used: options.numbers.format(used),
    });
  return `${options.numbers.format(used)} / ${options.numbers.format(limit)}`;
}

/**
 * The block "Kontext", fixed 76 px high: how much of the model's window the session occupies.
 * @remarks
 * The title stands left, the value right, in three states. Without a
 * reported value it reads "noch nicht gemeldet" and draws no bar, so an
 * empty bar never reads as 0 %. With only the occupancy, such as
 * "233 Tokens", the window is unknown and no bar is drawn. With both, such
 * as "233 / 476.000", a 6 px bar shows the share. The last reported value
 * stays until a new one comes, also after a report without one.
 */
export function ConsoleContextSection({
  view,
}: {
  readonly view: AgentSessionView;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  const title = t("plans.console.terminal.sidebar.context");
  const context = useReportedContext(view.context, view.key.attemptId);
  const numbers = new Intl.NumberFormat(i18n.language);
  const share = contextShare(context);
  return (
    <section
      aria-label={title}
      data-console-context=""
      className="h-[76px] min-w-0 shrink-0"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className={SIDEBAR_TITLE_CLASS}>{title}</h3>
        <span
          data-context-value=""
          className="min-w-0 truncate text-[13px] text-agent-console-muted tabular-nums"
        >
          {contextValue(context, { numbers, t })}
        </span>
      </div>
      {share === null ? null : <ContextBar share={share} label={title} />}
    </section>
  );
}
