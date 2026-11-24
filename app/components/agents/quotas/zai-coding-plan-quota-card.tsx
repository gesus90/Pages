import { useTranslation } from "react-i18next";

/*
 * Branding note: the Z.AI tile names the vendor of the subscription beside
 * its written name; the file is kept unchanged in `assets/providers/` and
 * only scaled here.
 */
import zaiUrl from "@/assets/providers/logo-zai.png?no-inline";

import { ProviderBadge } from "@/app/components/agents/plans/plan-agent-console/console-header-badges";
import { cn } from "@/app/lib/cn";
import { zaiWindowMinutes } from "@/definition/ZaiCodingPlanQuota";

import { QuotaCardFrame, QuotaHeaderBadges } from "./quota-card-frame";
import {
  QUOTA_COMPACT_WINDOW_SLOT_CLASS,
  QUOTA_COMPACT_WINDOWS_AREA_CLASS,
  QUOTA_WINDOW_SLOT_CLASS,
  QUOTA_WINDOWS_AREA_CLASS,
} from "./quota-card-layout";
import { zaiCodingPlanCardView } from "./quota-card-state";
import { QuotaNotice } from "./quota-notice";
import { QuotaWindowsPlaceholder } from "./quota-placeholders";
import { QuotaStatusLine } from "./quota-status-line";
import { formatQuotaReset, useQuotaWindowExpiry } from "./quota-time";
import { QuotaWindow } from "./quota-window";

import type { TFunction } from "i18next";
import type {
  ZaiCodingPlanQuotaAccount,
  ZaiCodingPlanQuotaWindow,
} from "@/definition/ZaiCodingPlanQuota";
import type { ZaiCodingPlanCardBody } from "./quota-card-state";

/** More windows than this stand as compact windows in a scrolling area. */
const STANDARD_WINDOW_COUNT = 2;

/** Translation and language of the counts a window line names. */
interface WindowFormat {
  readonly t: TFunction;
  readonly language: string;
}

/** The name of a window: what it counts and its length as Z.AI reported it. */
function windowLabel(
  quotaWindow: ZaiCodingPlanQuotaWindow,
  t: TFunction,
): string {
  const measure = t(`agentsPage.zaiCodingPlan.measure.${quotaWindow.measure}`);
  const { length } = quotaWindow;
  const window =
    length === null
      ? t("agentsPage.zaiCodingPlan.window.unknown")
      : t(`agentsPage.zaiCodingPlan.window.${length.unit}`, {
          count: length.count,
        });
  return t("agentsPage.zaiCodingPlan.windowLabel", { measure, window });
}

/**
 * The counts of a window, when Z.AI reported the limit and the used or the
 * remaining count; `undefined` keeps the used share of the common window.
 */
function countLabel(
  quotaWindow: ZaiCodingPlanQuotaWindow,
  { t, language }: WindowFormat,
): string | undefined {
  const { used, limit, remaining } = quotaWindow;
  if (limit === null) return undefined;
  const format = new Intl.NumberFormat(language, {
    notation: "compact",
    maximumFractionDigits: 1,
  });
  if (used !== null)
    return t("agentsPage.zaiCodingPlan.used", {
      used: format.format(used),
      limit: format.format(limit),
    });
  if (remaining !== null)
    return t("agentsPage.zaiCodingPlan.remaining", {
      remaining: format.format(remaining),
      limit: format.format(limit),
    });
  return undefined;
}

/**
 * A window whose usage Z.AI did not report: its name, "Nutzung unbekannt", an
 * empty bar, the reported reset or "Rücksetzzeit nicht gemeldet" and the
 * reported counts, so a missing share never reads as 0 %.
 */
function ZaiUnknownUsageWindow({
  quotaWindow,
  isCompact,
}: {
  readonly quotaWindow: ZaiCodingPlanQuotaWindow;
  readonly isCompact: boolean;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  const format = { t, language: i18n.language };
  const label = windowLabel(quotaWindow, t);
  const reset = formatQuotaReset(quotaWindow.resetsAt, new Date(), format);
  const counts = countLabel(quotaWindow, format);
  return (
    <section
      data-quota-window={quotaWindow.key}
      data-quota-usage="unknown"
      aria-label={label}
      className={cn(
        isCompact ? QUOTA_COMPACT_WINDOW_SLOT_CLASS : QUOTA_WINDOW_SLOT_CLASS,
        !isCompact && "gap-2 md:gap-2.5",
      )}
    >
      <div
        className={cn(
          "flex shrink-0 items-center gap-2",
          isCompact ? "h-[18px]" : "h-5",
        )}
      >
        <h4
          className="min-w-0 truncate text-[13px] font-semibold text-foreground"
          title={label}
        >
          {label}
        </h4>
        <span className="ml-auto shrink-0 whitespace-nowrap text-[13px] font-semibold text-muted-foreground">
          {t("agentsPage.zaiCodingPlan.usageUnknown")}
        </span>
      </div>
      <div
        aria-hidden="true"
        className="h-2.5 shrink-0 rounded-[5px] bg-muted"
      />
      <div className="flex h-4 items-center justify-between gap-2 text-xs leading-4 text-muted-foreground">
        <span className="min-w-0 truncate" title={reset.full}>
          {reset.full}
        </span>
        {counts === undefined ? null : (
          <span className="min-w-0 truncate" title={counts}>
            {counts}
          </span>
        )}
      </div>
    </section>
  );
}

function ZaiQuotaWindow({
  quotaWindow,
  targetAt,
  isStale,
  isCompact,
}: {
  readonly quotaWindow: ZaiCodingPlanQuotaWindow;
  readonly targetAt: number;
  readonly isStale: boolean;
  readonly isCompact: boolean;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  if (quotaWindow.usedPercent === null)
    return (
      <ZaiUnknownUsageWindow quotaWindow={quotaWindow} isCompact={isCompact} />
    );
  return (
    <QuotaWindow
      figures={{
        kind: quotaWindow.key,
        label: windowLabel(quotaWindow, t),
        usedPercentage: quotaWindow.usedPercent,
        usedLabel: countLabel(quotaWindow, { t, language: i18n.language }),
        resetsAt: quotaWindow.resetsAt,
        durationMinutes: zaiWindowMinutes(quotaWindow.length),
        pace: quotaWindow.pace,
      }}
      targetAt={targetAt}
      isStale={isStale}
      isCompact={isCompact}
    />
  );
}

/**
 * The window area of a Coding Plan card: the windows, or the notice in their place.
 * @remarks
 * One or two windows stand in the area of the Codex card. Three windows, such
 * as the 5-hour, weekly and MCP windows, stand as compact windows in the
 * shared compact area, which scrolls for any further window. Token windows
 * stand before the MCP window.
 */
function ZaiCardWindows({
  body,
  targetAt,
  hasPlan,
}: {
  readonly body: ZaiCodingPlanCardBody;
  readonly targetAt: number;
  readonly hasPlan: boolean;
}): React.ReactElement {
  const isCompact =
    body.kind === "windows" && body.windows.length > STANDARD_WINDOW_COUNT;
  return (
    <div
      data-quota-windows={
        body.kind === "windows" ? body.windows.length : "notice"
      }
      className={
        isCompact ? QUOTA_COMPACT_WINDOWS_AREA_CLASS : QUOTA_WINDOWS_AREA_CLASS
      }
    >
      {body.kind === "windows" ? (
        body.windows.map((quotaWindow) => (
          <ZaiQuotaWindow
            key={quotaWindow.key}
            quotaWindow={quotaWindow}
            targetAt={targetAt}
            isStale={body.isStale}
            isCompact={isCompact}
          />
        ))
      ) : (
        <QuotaNotice
          notice={body.notice}
          provider="zai_coding_plan"
          hasPlan={hasPlan}
          reasonKey={
            body.reason === null
              ? undefined
              : `agentsPage.zaiCodingPlan.notice.${body.reason}`
          }
        />
      )}
    </div>
  );
}

/** The subscription level as Z.AI reported it, with its first letter in capitals. */
function planName(plan: string): string {
  return `${plan.charAt(0).toLocaleUpperCase()}${plan.slice(1)}`;
}

function ZaiCardHeader({
  account,
  isLoading,
}: {
  readonly account: ZaiCodingPlanQuotaAccount;
  readonly isLoading: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const plan =
    account.plan === null
      ? t("agentsPage.plan.unknown")
      : t("agentsPage.zaiCodingPlan.plan", { plan: planName(account.plan) });
  return (
    <header className="flex h-11 shrink-0 items-center gap-3">
      <img
        src={zaiUrl}
        alt=""
        draggable={false}
        className="size-8 shrink-0 rounded-[9px]"
      />
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-base font-bold text-foreground">
          {account.name}
        </h3>
        <p
          data-zai-plan={account.plan ?? "unknown"}
          className="truncate text-xs text-muted-foreground"
        >
          {isLoading
            ? t("agentsPage.card.zaiCodingPlan")
            : t("agentsPage.zaiCodingPlan.subtitle", { plan })}
        </p>
      </div>
      <QuotaHeaderBadges location={account.executionLocation ?? null}>
        <span className="hidden sm:inline-flex">
          <ProviderBadge provider="zai_coding_plan" />
        </span>
      </QuotaHeaderBadges>
    </header>
  );
}

/**
 * The card of one OpenCode connection with a Z.AI Coding Plan key: its name,
 * the Coding Plan badge, the reported plan, the windows Z.AI reported and
 * what happened at the last query.
 * @remarks
 * It has the frame, head, window area and 48 px status line of the Codex
 * card. The head shows the Z.AI tile, the connection name and the plan when
 * Z.AI reported one, otherwise "Tarif unbekannt"; from the small width on it
 * also carries the "Z.AI │ Coding Plan" badge. Each window names what it
 * counts, its length, its used share and, when reported, its counts and
 * reset; a length, usage or reset Z.AI did not report reads as unknown. A
 * successful query without a window to show says whether Z.AI reported no
 * entry, only expired windows or only entries Pages cannot read. A card
 * without figures shows placeholders and "Wird geladen …"; after a failed
 * query the last figures stay with the time of their answer.
 */
export function ZaiCodingPlanQuotaCard({
  account,
  isRetrying,
  targetAt,
  onRetry,
}: {
  readonly account: ZaiCodingPlanQuotaAccount;
  readonly isRetrying: boolean;
  readonly targetAt: number;
  readonly onRetry: () => void;
}): React.ReactElement {
  const now = new Date();
  const view = zaiCodingPlanCardView(account, now);
  useQuotaWindowExpiry(
    view.body.kind === "windows" && !view.body.isStale ? view.body.windows : [],
    now,
  );
  const isLoading = view.status.kind === "stored" && view.status.at === null;

  return (
    <QuotaCardFrame
      connectionId={account.connectionId}
      provider="zai_coding_plan"
      isLoading={isLoading}
      isQuerying={isRetrying}
    >
      <ZaiCardHeader account={account} isLoading={isLoading} />
      {isLoading ? (
        <QuotaWindowsPlaceholder />
      ) : (
        <ZaiCardWindows
          body={view.body}
          targetAt={targetAt}
          hasPlan={account.plan !== null}
        />
      )}
      <QuotaStatusLine
        status={view.status}
        source={{ provider: "zai_coding_plan", generalLimit: view.limit }}
        isRetrying={isRetrying}
        onRetry={onRetry}
      />
    </QuotaCardFrame>
  );
}
