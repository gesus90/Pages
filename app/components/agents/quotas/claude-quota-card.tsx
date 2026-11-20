import { useTranslation } from "react-i18next";

/*
 * Branding note: Claude's app icon names the vendor of the subscription
 * beside its written name; the file is kept unchanged in
 * `assets/providers/` and only scaled here.
 */
import claudeUrl from "@/assets/providers/logo-claude.png?no-inline";

import { cn } from "@/app/lib/cn";
import { claudePlanTier } from "@/definition/ClaudeQuota";
import { FIXED_QUOTA_MINUTES } from "@/definition/QuotaForecast";

import { QuotaCardFrame, QuotaHeaderBadges } from "./quota-card-frame";
import { QUOTA_WINDOWS_AREA_CLASS } from "./quota-card-layout";
import { quotaCardView } from "./quota-card-state";
import { QuotaNotice } from "./quota-notice";
import {
  QuotaBadgePlaceholder,
  QuotaWindowsPlaceholder,
} from "./quota-placeholders";
import { QuotaStatusLine } from "./quota-status-line";
import { useQuotaWindowExpiry } from "./quota-time";
import { QuotaWindow } from "./quota-window";

import type {
  ClaudePlan,
  ClaudeQuotaAccount,
  ClaudeQuotaWindow as ReportedWindow,
} from "@/definition/ClaudeQuota";
import type { QuotaCardBody } from "./quota-card-state";

/**
 * The window area of a card: the windows, or the notice in their place.
 * @remarks
 * The area takes the height the card leaves between head and status line,
 * 204 px on a wide card. Two windows fill both
 * 66 px slots with a 28 px gap, five hours first; on a phone the slots are
 * 76 px with 24 px above and below and 20 px between. A single window and a
 * notice stand centred, so nothing greyed holds the place of a missing
 * window.
 */
function QuotaCardWindows({
  body,
  targetAt,
  hasPlan,
}: {
  readonly body: QuotaCardBody;
  readonly targetAt: number;
  readonly hasPlan: boolean;
}): React.ReactElement {
  return (
    <div
      data-quota-windows={
        body.kind === "windows" ? body.windows.length : "notice"
      }
      className={QUOTA_WINDOWS_AREA_CLASS}
    >
      {body.kind === "windows" ? (
        body.windows.map((quotaWindow) => (
          <ClaudeQuotaWindow
            key={quotaWindow.kind}
            quotaWindow={quotaWindow}
            targetAt={targetAt}
            isStale={body.isStale}
          />
        ))
      ) : (
        <QuotaNotice
          notice={body.notice}
          provider="claude_code"
          hasPlan={hasPlan}
        />
      )}
    </div>
  );
}

/**
 * The card of one Claude connection: its name, the subscription, every
 * window Claude reported and what happened at the last query.
 * @remarks
 * Every card has the same size whatever it holds, so the status lines of a
 * row stand on one line; the grid sets the height. The outline is drawn
 * inside the card and takes no room, so head, window area and status line
 * add up to the card's height exactly. A window Claude did not
 * report is not shown. A window whose reset passed leaves a current card;
 * after a failed query the card keeps the last measurements with their time.
 * Logo, name and subtitle come from the connection, so they stand from the
 * first moment. A card without stored figures shows placeholders for plan
 * and windows and "Wird geladen …" until its query answers; a card with
 * stored figures keeps them in full colour while the query runs or fails.
 */
export function ClaudeQuotaCard({
  account,
  isRetrying,
  targetAt,
  onRetry,
}: {
  readonly account: ClaudeQuotaAccount;
  readonly isRetrying: boolean;
  readonly targetAt: number;
  readonly onRetry: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const now = new Date();
  const view = quotaCardView(account, now);
  useQuotaWindowExpiry(
    view.body.kind === "windows" && !view.body.isStale ? view.body.windows : [],
    now,
  );
  const isLoading = view.status.kind === "stored" && view.status.at === null;

  return (
    <QuotaCardFrame
      connectionId={account.connectionId}
      isLoading={isLoading}
      isQuerying={isRetrying}
    >
      <header className="flex h-11 shrink-0 items-center gap-3">
        <img
          src={claudeUrl}
          alt=""
          draggable={false}
          className="size-8 shrink-0 rounded-[9px]"
        />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-bold text-foreground">
            {account.name}
          </h3>
          <p className="truncate text-xs text-muted-foreground">
            {t("agentsPage.card.subscription")}
          </p>
        </div>
        <QuotaHeaderBadges location={account.executionLocation ?? null}>
          {isLoading ? (
            <QuotaBadgePlaceholder />
          ) : (
            <ClaudePlanBadge plan={account.plan} />
          )}
        </QuotaHeaderBadges>
      </header>
      {isLoading ? (
        <QuotaWindowsPlaceholder />
      ) : (
        <QuotaCardWindows
          body={view.body}
          targetAt={targetAt}
          hasPlan={account.plan !== null}
        />
      )}
      <QuotaStatusLine
        status={view.status}
        source={{ provider: "claude_code", generalLimit: view.limit }}
        isRetrying={isRetrying}
        onRetry={onRetry}
      />
    </QuotaCardFrame>
  );
}

function ClaudeQuotaWindow({
  quotaWindow,
  targetAt,
  isStale = false,
}: {
  readonly quotaWindow: ReportedWindow;
  readonly targetAt: number;
  readonly isStale?: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <QuotaWindow
      figures={{
        kind: quotaWindow.kind,
        label: t(`agentsPage.window.${quotaWindow.kind}`),
        usedPercentage: quotaWindow.usedPercentage,
        resetsAt: quotaWindow.resetsAt,
        durationMinutes: FIXED_QUOTA_MINUTES[quotaWindow.kind],
        pace: quotaWindow.pace,
      }}
      targetAt={targetAt}
      isStale={isStale}
    />
  );
}

const TIER_BAR_HEIGHTS = [5, 8, 11, 14] as const;

function PlanTierMark({ tier }: { readonly tier: number }): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 14 14"
      className="size-3.5"
      fill="currentColor"
    >
      {TIER_BAR_HEIGHTS.map((height, index) => (
        <rect
          key={height}
          data-plan-bar={index < tier ? "filled" : "empty"}
          x={index * 3.67}
          y={14 - height}
          width={3}
          height={height}
          rx={0.75}
          opacity={index < tier ? 1 : 0.3}
        />
      ))}
    </svg>
  );
}

function ClaudePlanBadge({
  plan,
}: {
  readonly plan: ClaudePlan | null;
}): React.ReactElement {
  const { t } = useTranslation();
  const isKnown = plan !== null;
  return (
    <span
      data-claude-plan={plan ?? "unknown"}
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-[7px] border bg-surface py-[2px] pr-2 pl-[2px] text-[11px] leading-none font-semibold",
        isKnown
          ? "w-[68px] border-claude text-foreground"
          : "border-border text-muted-foreground",
      )}
    >
      <span
        className={cn(
          "inline-flex size-[18px] shrink-0 items-center justify-center rounded-[5px]",
          isKnown ? "bg-claude/15 text-claude" : "bg-muted",
        )}
      >
        <PlanTierMark tier={claudePlanTier(plan)} />
      </span>
      <span className="whitespace-nowrap">
        {t(`agentsPage.plan.${plan ?? "unknown"}`)}
      </span>
    </span>
  );
}
