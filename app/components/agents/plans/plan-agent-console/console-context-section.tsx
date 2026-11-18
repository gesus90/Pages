import { useState } from "react";
import { useTranslation } from "react-i18next";

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

/** The bar of the occupancy: 6 px high, at least 4 px filled. */
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
        className="h-full rounded-[3px] bg-primary"
        style={{ width: `max(4px, ${share}%)` }}
      />
    </div>
  );
}

/**
 * The block "Kontext": how much of the model's window the session occupies.
 * @remarks
 * The title stands left, "used / window" right, the bar below. The last
 * reported value stays until a new one comes, also after a report without
 * one. A session that never reported a value shows only a sentence, no
 * empty bar that would read as 0 %. Without a known window the occupancy
 * stands alone and no bar is drawn.
 */
export function ConsoleContextSection({
  view,
}: {
  readonly view: AgentSessionView;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  const key = "plans.console.terminal.sidebar";
  const title = t(`${key}.context`);
  const context = useReportedContext(view.context, view.key.attemptId);
  const numbers = new Intl.NumberFormat(i18n.language);
  const share = contextShare(context);
  const limit =
    context.limit === null
      ? t(`${key}.unknown`)
      : numbers.format(context.limit);
  return (
    <section aria-label={title} data-console-context="" className="min-w-0">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className={SIDEBAR_TITLE_CLASS}>{title}</h3>
        {context.used === null ? null : (
          <span className="min-w-0 truncate text-[13px] font-semibold text-agent-console-foreground tabular-nums">
            {`${numbers.format(context.used)} / ${limit}`}
          </span>
        )}
      </div>
      {context.used === null ? (
        <p className="mt-1.5 text-[13px] text-agent-console-muted">
          {t(`${key}.contextNotReported`)}
        </p>
      ) : null}
      {share === null ? null : <ContextBar share={share} label={title} />}
    </section>
  );
}
