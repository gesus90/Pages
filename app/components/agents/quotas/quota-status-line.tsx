import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { cn } from "@/app/lib/cn";

import { QUOTA_STATUS_LINE_CLASS } from "./quota-card-layout";
import styles from "./quota-loading.module.css";
import { statusPresentation } from "./quota-status-presentation";
import { formatQuotaMoment, formatQuotaStand } from "./quota-time";

import type {
  GeneralStatusLimit,
  StatusLimit,
  StatusPresentation,
  StatusTone,
} from "./quota-status-presentation";
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
 * with stale figures keeps its timestamp and shows a spinner while querying.
 * A card with current figures shows the refresh hint after a delay. An
 * Antigravity card names a used-up window, with its group, instead of the
 * time of the answer; a Codex card says "Limit erreicht" when the account
 * states its limit is reached, with a reset only when one belongs to it.
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
    /** The limit a Codex account states for itself, if any. */
    readonly generalLimit?: GeneralStatusLimit | null;
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
  const presentation = statusPresentation(status, {
    t,
    provider: source.provider,
    time: (iso) =>
      formatQuotaStand(new Date(iso), now, { t, language: i18n.language }),
    moment: (iso) =>
      formatQuotaMoment(new Date(iso), now, { t, language: i18n.language }),
    progress,
    limit: source.limit,
    generalLimit: source.generalLimit,
  });
  return (
    <QuotaStatusFooter
      kind={status.kind}
      presentation={presentation}
      progress={progress}
      onRetry={onRetry}
    />
  );
}

/** Common quota status layout for provider-specific text and actions. */
export function QuotaStatusFooter({
  kind,
  presentation,
  progress,
  onRetry,
  connectionHref = "/settings/agents",
}: {
  readonly kind: string;
  readonly presentation: StatusPresentation;
  readonly progress: {
    readonly isQuerying: boolean;
    readonly isHintShown: boolean;
  };
  readonly onRetry: () => void;
  readonly connectionHref?: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const { isQuerying, isHintShown } = progress;
  const Icon = presentation.icon;
  const isRefreshing = Icon === "spinner" || presentation.isUpdating;
  return (
    <footer
      data-quota-state={kind}
      data-quota-state-tone={presentation.tone}
      className={QUOTA_STATUS_LINE_CLASS}
    >
      <p
        role={isRefreshing ? "status" : undefined}
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
        {presentation.isUpdating ? <QuotaSpinner /> : null}
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
        <Link to={connectionHref} className={BUTTON_CLASS}>
          {t("agentsPage.state.openConnection")}
        </Link>
      ) : null}
    </footer>
  );
}

function QuotaSpinner(): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      data-quota-spinner=""
      className="flex size-3.5 shrink-0 items-center justify-center"
    >
      <span
        className={cn(
          "block size-3 rounded-full border-[1.5px] border-muted-foreground/30 border-t-muted-foreground",
          styles.spinner,
        )}
      />
    </span>
  );
}
