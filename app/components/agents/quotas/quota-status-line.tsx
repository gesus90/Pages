import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { cn } from "@/app/lib/cn";

import { QUOTA_STATUS_LINE_CLASS } from "./quota-card-layout";
import { QuotaSpinner } from "./quota-spinner";
import { statusPresentation } from "./quota-status-presentation";
import { formatQuotaMoment, formatQuotaStand } from "./quota-time";

import type { StatusLimit, StatusTone } from "./quota-status-presentation";
import type { QuotaAccount } from "@/definition/AgentQuota";
import type { ClaudeQuotaStatus } from "@/definition/ClaudeQuota";

const TONE_CLASSES: Readonly<Record<StatusTone, string>> = {
  success: "text-success",
  muted: "text-muted-foreground",
  warning: "text-warning",
  destructive: "text-destructive",
};

const BUTTON_CLASS =
  "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[9px] border border-border bg-surface px-2.5 text-xs font-semibold text-foreground transition-colors hover:bg-surface-hover disabled:cursor-default";

/**
 * The status line at the foot of every card: what happened at the last query.
 * @remarks
 * 48 px high below a 1 px border, so it stands on the same line in every
 * card. On a narrow card the text wraps while the button stays whole, and
 * the full text stands in the tooltip for a text that is cut. The retry
 * button queries the card once more without moving the minute beat; it is
 * off while the card queries, and its icon turns once the hint shows.
 * A card without figures says "Wird geladen …" with the ring at once; a card
 * with figures says "wird aktualisiert" only once `isHintShown` is set. An
 * Antigravity card names a used-up window, with its group, instead of the
 * time of the answer.
 */
export function QuotaStatusLine({
  status,
  now,
  source,
  progress,
  onRetry,
}: {
  readonly status: ClaudeQuotaStatus;
  readonly now: Date;
  readonly source: {
    readonly provider: QuotaAccount["provider"];
    /** The window without a rest that the line names, if any. */
    readonly limit?: StatusLimit | null;
  };
  readonly progress: {
    /** Whether the card waits for the answer of its query. */
    readonly isQuerying: boolean;
    /** Whether the hint for a query that takes longer shows. */
    readonly isHintShown: boolean;
  };
  readonly onRetry: () => void;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  const { isQuerying, isHintShown } = progress;
  const presentation = statusPresentation(status, {
    t,
    provider: source.provider,
    time: (iso) =>
      formatQuotaStand(new Date(iso), now, { t, language: i18n.language }),
    moment: (iso) =>
      formatQuotaMoment(new Date(iso), now, { t, language: i18n.language }),
    isHintShown,
    limit: source.limit,
  });
  const Icon = presentation.icon;
  return (
    <footer
      data-quota-state={status.kind}
      data-quota-state-tone={presentation.tone}
      className={QUOTA_STATUS_LINE_CLASS}
    >
      <p
        role={Icon === "spinner" ? "status" : undefined}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2 text-xs leading-4",
          TONE_CLASSES[presentation.tone],
        )}
      >
        {Icon === "spinner" ? (
          <QuotaSpinner />
        ) : (
          <Icon aria-hidden="true" className="size-3.5 shrink-0" />
        )}
        <span className="line-clamp-2 min-w-0" title={presentation.text}>
          {presentation.text}
        </span>
      </p>
      {presentation.action === "retry" ? (
        <button
          type="button"
          onClick={onRetry}
          disabled={isQuerying}
          className={BUTTON_CLASS}
        >
          <RefreshCw
            aria-hidden="true"
            className={cn(
              "size-[13px]",
              isQuerying &&
                isHintShown &&
                "animate-spin motion-reduce:animate-none",
            )}
          />
          {t("agentsPage.state.retry")}
        </button>
      ) : null}
      {presentation.action === "openConnection" ? (
        <Link to="/settings/agents" className={BUTTON_CLASS}>
          {t("agentsPage.state.openConnection")}
        </Link>
      ) : null}
    </footer>
  );
}
