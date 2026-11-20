import { useTranslation } from "react-i18next";

/*
 * Branding note: the Z.AI app icon names the vendor of the connection
 * beside its written name; the file is kept unchanged in `assets/providers/`
 * and only scaled here.
 */
import zaiUrl from "@/assets/providers/logo-zai.png?no-inline";

import { cn } from "@/app/lib/cn";

import { zaiWindowDurationMinutes } from "@/definition/ZaiQuota";
import { QuotaCardFrame, QuotaHeaderBadges } from "./quota-card-frame";
import {
  QUOTA_COMPACT_WINDOWS_AREA_CLASS,
  QUOTA_WINDOWS_AREA_CLASS,
} from "./quota-card-layout";
import { zaiCardView } from "./quota-card-state";
import { QuotaNotice } from "./quota-notice";
import {
  QuotaBadgePlaceholder,
  QuotaWindowsPlaceholder,
} from "./quota-placeholders";
import { QuotaStatusLine } from "./quota-status-line";
import { useQuotaWindowExpiry } from "./quota-time";
import { QuotaWindow } from "./quota-window";

import type { TFunction } from "i18next";
import type {
  ZaiPlan,
  ZaiQuotaAccount,
  ZaiQuotaWindow as ReportedWindow,
} from "@/definition/ZaiQuota";
import type { ZaiCardBody } from "./quota-card-state";

/** More windows than two stand in the compact slots, so the area keeps its height. */
const REGULAR_WINDOW_LIMIT = 2;

/** The texts that say why an answered card has no entry; other notices keep their own. */
function absenceReasonKey(
  body: Extract<ZaiCardBody, { readonly kind: "notice" }>,
): string | undefined {
  if (body.notice !== "noWindows" || body.absence === null) return undefined;
  return `agentsPage.zai.absence.${body.absence}`;
}

/**
 * The window area of a Z.AI card: the entries, or the notice in their place.
 * @remarks
 * It is the area of the Claude card: it takes the height between head and
 * status line, and one entry or a notice stands centred in it, so nothing
 * greyed holds the place of a missing entry. Three entries, the usual answer
 * of a Coding Plan key, stand in the compact slots. A notice for a card that
 * answered without an entry says whether Z.AI delivered none, none the card can
 * read, or only entries whose reset has passed.
 */
function ZaiCardWindows({
  body,
  targetAt,
  hasPlan,
}: {
  readonly body: ZaiCardBody;
  readonly targetAt: number;
  readonly hasPlan: boolean;
}): React.ReactElement {
  if (body.kind === "notice")
    return (
      <div data-quota-windows="notice" className={QUOTA_WINDOWS_AREA_CLASS}>
        <QuotaNotice
          notice={body.notice}
          provider="zai"
          hasPlan={hasPlan}
          reasonKey={absenceReasonKey(body)}
        />
      </div>
    );
  const isCompact = body.windows.length > REGULAR_WINDOW_LIMIT;
  return (
    <div
      data-quota-windows={body.windows.length}
      className={
        isCompact ? QUOTA_COMPACT_WINDOWS_AREA_CLASS : QUOTA_WINDOWS_AREA_CLASS
      }
    >
      {body.windows.map((quotaWindow, position) => (
        <ZaiQuotaWindow
          key={`${position}:${quotaWindow.kind}`}
          quotaWindow={quotaWindow}
          targetAt={targetAt}
          state={{
            isStale: body.isStale,
            isCompact,
          }}
        />
      ))}
    </div>
  );
}

/**
 * The card of one Z.AI connection: its name, the account type, the plan tier
 * and the usage entries Z.AI reports for its key.
 * @remarks
 * It has the form of the Claude card: the 44 px head with a 32 px Z.AI logo,
 * the connection name, the account type ("GLM Coding Plan" or "Standard-API")
 * and the tier badge, the window area and the 48 px status line. A current
 * card shows only reported entries with a remaining or unknown reset. A
 * card without stored figures shows placeholders and "Wird geladen …" until
 * its query answers; a card with stored figures keeps them in full colour
 * while the query runs or fails and names the
 * time of the last answer. A key that is missing or rejected shows a notice
 * and the way to the connection settings.
 */
export function ZaiQuotaCard({
  account,
  isRetrying,
  targetAt,
  onRetry,
}: {
  readonly account: ZaiQuotaAccount;
  readonly isRetrying: boolean;
  readonly targetAt: number;
  readonly onRetry: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const now = new Date();
  const view = zaiCardView(account, now);
  useQuotaWindowExpiry(
    view.body.kind === "windows" && !view.body.isStale ? view.body.windows : [],
    now,
  );
  const isLoading = view.status.kind === "stored" && view.status.at === null;
  const hasTier = account.accountType === "coding-plan";

  return (
    <QuotaCardFrame
      connectionId={account.connectionId}
      provider="zai"
      isLoading={isLoading}
      isQuerying={isRetrying}
    >
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
          <p className="truncate text-xs text-muted-foreground">
            {t(`agentsPage.zai.subtitle.${account.accountType}`)}
          </p>
        </div>
        <QuotaHeaderBadges
          location={account.executionLocation ?? null}
          isLocationPending={isLoading}
        >
          {isLoading && hasTier ? <QuotaBadgePlaceholder /> : null}
          {!isLoading && (hasTier || account.plan !== null) ? (
            <ZaiPlanBadge plan={account.plan} />
          ) : null}
        </QuotaHeaderBadges>
      </header>
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
        source={{ provider: "zai", generalLimit: view.limit }}
        isRetrying={isRetrying}
        onRetry={onRetry}
      />
    </QuotaCardFrame>
  );
}

function zaiWindowLabel(quotaWindow: ReportedWindow, t: TFunction): string {
  const name = t(`agentsPage.zai.window.${quotaWindow.kind}`);
  const { length } = quotaWindow;
  if (length === null) return name;
  return t("agentsPage.zai.window.named", {
    name,
    length: t(`agentsPage.zai.length.${length.unit}`, { count: length.count }),
  });
}

function ZaiQuotaWindow({
  quotaWindow,
  targetAt,
  state,
}: {
  readonly quotaWindow: ReportedWindow;
  readonly targetAt: number;
  readonly state: {
    readonly isStale: boolean;
    readonly isCompact: boolean;
  };
}): React.ReactElement {
  const { t } = useTranslation();
  const { counts } = quotaWindow;
  return (
    <QuotaWindow
      figures={{
        kind: quotaWindow.kind,
        label: zaiWindowLabel(quotaWindow, t),
        usedPercentage: quotaWindow.usedPercent,
        resetsAt: quotaWindow.resetsAt,
        durationMinutes: zaiWindowDurationMinutes(quotaWindow),
        pace: quotaWindow.pace,
        usedLabel: counts
          ? t("agentsPage.zai.counts", {
              used: counts.used,
              total: counts.total,
            })
          : undefined,
      }}
      targetAt={targetAt}
      isStale={state.isStale}
      isCompact={state.isCompact}
    />
  );
}

function ZaiPlanBadge({
  plan,
}: {
  readonly plan: ZaiPlan | null;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <span
      data-zai-plan={plan ?? "unknown"}
      className={cn(
        "inline-flex h-6 shrink-0 items-center rounded-[7px] border bg-surface px-2 text-[11px] leading-none font-semibold whitespace-nowrap",
        plan === null
          ? "border-border text-muted-foreground"
          : "border-border-strong text-foreground",
      )}
    >
      {plan === null
        ? t("agentsPage.plan.unknown")
        : t(`agentsPage.zai.plan.${plan}`)}
    </span>
  );
}
