import { useTranslation } from "react-i18next";

/*
 * Branding note: the Z.AI app icon names the vendor of the connection
 * beside its written name; the file is kept unchanged in `assets/providers/`
 * and only scaled here.
 */
import zaiUrl from "@/assets/providers/logo-zai.png?no-inline";

import { QuotaCardFrame } from "./quota-card-frame";
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
import { useRefreshHint } from "./use-refresh-hint";
import { ZaiPlanBadge } from "./zai-plan-badge";
import { ZaiQuotaWindow } from "./zai-quota-window";

import type { ZaiQuotaAccount } from "@/definition/ZaiQuota";
import type { ZaiCardBody } from "./quota-card-state";

/** More windows than two stand in the compact slots, so the area keeps its height. */
const REGULAR_WINDOW_LIMIT = 2;

/**
 * The window area of a Z.AI card: the entries, or the notice in their place.
 * @remarks
 * It is the area of the Claude card: it takes the height between head and
 * status line, and one entry or a notice stands centred in it, so nothing
 * greyed holds the place of a missing entry. Three entries, the usual answer
 * of a Coding Plan key, stand in the compact slots.
 */
function ZaiCardWindows({
  body,
  now,
  hasPlan,
}: {
  readonly body: ZaiCardBody;
  readonly now: Date;
  readonly hasPlan: boolean;
}): React.ReactElement {
  if (body.kind === "notice")
    return (
      <div data-quota-windows="notice" className={QUOTA_WINDOWS_AREA_CLASS}>
        <QuotaNotice notice={body.notice} provider="zai" hasPlan={hasPlan} />
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
          now={now}
          state={{
            isStale: body.isStale,
            staleSince: body.staleSince,
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
 * and the tier badge, the window area and the 48 px status line. An entry Z.AI
 * did not report is not shown, and one whose reset passed leaves the card. A
 * card without stored figures shows placeholders and "Wird geladen …" until
 * its query answers; a card with stored figures keeps them in full colour
 * while the query runs, and after a failed query it greys them and names the
 * time of the last answer. A key that is missing or rejected shows a notice
 * and the way to the connection settings.
 */
export function ZaiQuotaCard({
  account,
  pendingQueries,
  now,
  onRetry,
}: {
  readonly account: ZaiQuotaAccount;
  /** Queries of exactly this card that have not answered yet. */
  readonly pendingQueries: number;
  readonly now: Date;
  readonly onRetry: (connectionId: string) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const isQuerying = pendingQueries > 0;
  const view = zaiCardView(account, now);
  const isLoading = view.status.kind === "stored" && view.status.at === null;
  const isHintShown = useRefreshHint(isQuerying && !isLoading);
  const hasTier = account.accountType === "coding-plan";

  function handleRetry(): void {
    onRetry(account.connectionId);
  }

  return (
    <QuotaCardFrame
      connectionId={account.connectionId}
      provider="zai"
      isLoading={isLoading}
      isQuerying={isQuerying}
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
        {isLoading && hasTier ? <QuotaBadgePlaceholder /> : null}
        {!isLoading && (hasTier || account.plan !== null) ? (
          <ZaiPlanBadge plan={account.plan} />
        ) : null}
      </header>
      {isLoading ? (
        <QuotaWindowsPlaceholder />
      ) : (
        <ZaiCardWindows
          body={view.body}
          now={now}
          hasPlan={account.plan !== null}
        />
      )}
      <QuotaStatusLine
        status={view.status}
        now={now}
        source={{ provider: "zai" }}
        progress={{ isQuerying, isHintShown }}
        onRetry={handleRetry}
      />
    </QuotaCardFrame>
  );
}
