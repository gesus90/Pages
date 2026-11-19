import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { SIDEBAR_TITLE_CLASS } from "./console-sidebar-parts";

import type {
  AgentSessionContextUsage,
  AgentSessionView,
} from "@/definition/AgentSessionJournal";

/** The share of the window in use, from 0 to 100; `null` without both values. */
function contextShare(context: AgentSessionContextUsage): number | null {
  const { contextUsed: used, contextLimit: limit } = context;
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

/** Formats whichever parts of the context the provider has reported. */
function contextValue(
  context: AgentSessionContextUsage,
  options: {
    readonly numbers: Intl.NumberFormat;
    readonly t: ReturnType<typeof useTranslation>["t"];
  },
): string {
  const key = "plans.console.terminal.sidebar";
  const { contextUsed: used, contextLimit: limit } = context;
  if (used === null) {
    if (limit === null) return options.t(`${key}.contextNotReported`);
    return options.t(`${key}.contextWindowTokens`, {
      limit: options.numbers.format(limit),
    });
  }
  if (limit === null)
    return options.t(`${key}.contextTokens`, {
      used: options.numbers.format(used),
    });
  return `${options.numbers.format(used)} / ${options.numbers.format(limit)}`;
}

/**
 * The block "Kontext", fixed 76 px high: how much of the model's window the session occupies.
 * @remarks
 * The session view holds the last reported values of the attempt's model.
 * The bar is shown once both occupancy and window are available.
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
