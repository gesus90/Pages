import {
  CircleCheck,
  CirclePause,
  Info,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { cn } from "@/app/lib/cn";

import { formatQuotaMoment } from "./quota-time";

import type { TFunction } from "i18next";
import type { LucideIcon } from "lucide-react";
import type { ClaudeQuotaStatus } from "@/definition/ClaudeQuota";

/** The colour of a status line; static, so Tailwind finds the classes. */
type StatusTone = "success" | "muted" | "warning";

const TONE_CLASSES: Readonly<Record<StatusTone, string>> = {
  success: "text-success",
  muted: "text-muted-foreground",
  warning: "text-warning",
};

/** What the line offers on its right: nothing, a new query or the settings. */
type StatusAction = "none" | "retry" | "openConnection";

interface StatusPresentation {
  readonly icon: LucideIcon;
  readonly tone: StatusTone;
  readonly text: string;
  readonly action: StatusAction;
}

const BUTTON_CLASS =
  "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[9px] border border-border bg-surface px-2.5 text-xs font-semibold text-foreground transition-colors hover:bg-surface-hover disabled:cursor-default";

/**
 * Word, symbol, colour and action of each status.
 * @remarks
 * "Keine Fenster gemeldet" (Claude answered without a window) and
 * "Abfrage fehlgeschlagen" (Pages got no answer) never share a word, a
 * symbol or a colour. A missing sign-in is no failed query, so it offers the
 * connection settings instead of another attempt.
 */
function statusPresentation(
  status: ClaudeQuotaStatus,
  format: { readonly t: TFunction; readonly time: (iso: string) => string },
): StatusPresentation {
  const { t, time } = format;
  switch (status.kind) {
    case "reported":
      return {
        icon: CircleCheck,
        tone: "success",
        text: t("agentsPage.state.reported", { time: time(status.at) }),
        action: "none",
      };
    case "no_windows":
      return {
        icon: Info,
        tone: "muted",
        text: t("agentsPage.state.noWindows", { time: time(status.at) }),
        action: "none",
      };
    case "failed":
      return {
        icon: TriangleAlert,
        tone: "warning",
        text:
          status.lastSuccessAt === null
            ? t("agentsPage.state.failedNever")
            : t("agentsPage.state.failedSince", {
                time: time(status.lastSuccessAt),
              }),
        action: "retry",
      };
    case "skipped":
      return {
        icon: CirclePause,
        tone: "muted",
        text: t("agentsPage.state.skipped"),
        action: "none",
      };
    case "signed_out":
      return {
        icon: TriangleAlert,
        tone: "warning",
        text: t("agentsPage.state.signedOut"),
        action: "openConnection",
      };
  }
}

/**
 * The status line at the foot of every card: what happened at the last query.
 * @remarks
 * 48 px high below a 1 px border, so it stands on the same line in every
 * card. On a narrow card the text wraps while the button stays whole. The
 * retry button queries once more without moving the minute beat.
 */
export function QuotaStatusLine({
  status,
  now,
  isRefreshing,
  onRetry,
}: {
  readonly status: ClaudeQuotaStatus;
  readonly now: Date;
  readonly isRefreshing: boolean;
  readonly onRetry: () => void;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  const presentation = statusPresentation(status, {
    t,
    time: (iso) =>
      formatQuotaMoment(new Date(iso), now, { t, language: i18n.language }),
  });
  const Icon = presentation.icon;
  return (
    <footer
      data-quota-state={status.kind}
      data-quota-state-tone={presentation.tone}
      className="flex h-12 shrink-0 items-center gap-3 border-t border-border"
    >
      <p
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2 text-xs leading-4",
          TONE_CLASSES[presentation.tone],
        )}
      >
        <Icon aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="line-clamp-2 min-w-0">{presentation.text}</span>
      </p>
      {presentation.action === "retry" ? (
        <button
          type="button"
          onClick={onRetry}
          disabled={isRefreshing}
          className={BUTTON_CLASS}
        >
          <RefreshCw
            aria-hidden="true"
            className={cn("size-[13px]", isRefreshing && "animate-spin")}
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
