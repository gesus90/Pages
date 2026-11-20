import { useTranslation } from "react-i18next";

/*
 * Branding note: the ChatGPT app icon names the vendor of the subscription
 * beside its written name; the file is kept unchanged in `assets/providers/`
 * and only scaled here.
 */
import chatgptUrl from "@/assets/providers/logo-chatgpt.png?no-inline";

import { cn } from "@/app/lib/cn";
import { codexWindowLength } from "@/definition/CodexQuota";

import { QuotaHeaderBadges } from "./quota-card-frame";
import {
  QUOTA_CARD_CLASS,
  QUOTA_WINDOWS_AREA_CLASS,
} from "./quota-card-layout";
import { codexCardView } from "./quota-card-state";
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
  CodexPlan,
  CodexQuotaAccount,
  CodexQuotaWindow as ReportedWindow,
} from "@/definition/CodexQuota";
import type { CodexCardBody } from "./quota-card-state";

/**
 * The window area of a Codex card: the windows, or the notice in their place.
 * @remarks
 * It is the area of the Claude card: it takes the height between head and
 * status line, and one window or a notice stands centred in it, so nothing
 * greyed holds the place of a missing window. `primary` stands before
 * `secondary`.
 */
function CodexCardWindows({
  body,
  targetAt,
  hasPlan,
}: {
  readonly body: CodexCardBody;
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
          <CodexQuotaWindow
            key={quotaWindow.kind}
            quotaWindow={quotaWindow}
            targetAt={targetAt}
            isStale={body.isStale}
          />
        ))
      ) : (
        <QuotaNotice
          notice={body.notice}
          provider="codex_cli"
          hasPlan={hasPlan}
        />
      )}
    </div>
  );
}

/**
 * The card of one Codex connection: its name, the ChatGPT subscription, the
 * windows of the general Codex quota and what happened at the last query.
 * @remarks
 * It has the form of the Claude card: the 44 px head with a 32 px ChatGPT
 * logo, the connection name, "ChatGPT-Abo" and the plan badge, the window
 * area and the 48 px status line, in a card of the same size. A current
 * card shows only reported windows with a remaining or unknown reset. A
 * card without stored figures shows placeholders and "Wird
 * geladen …" until its query answers; a card with stored figures keeps them
 * in full colour while the query runs or fails and names the time of the
 * last answer.
 */
export function CodexQuotaCard({
  account,
  isRetrying,
  targetAt,
  onRetry,
}: {
  readonly account: CodexQuotaAccount;
  readonly isRetrying: boolean;
  readonly targetAt: number;
  readonly onRetry: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const now = new Date();
  const view = codexCardView(account, now);
  useQuotaWindowExpiry(
    view.body.kind === "windows" && !view.body.isStale ? view.body.windows : [],
    now,
  );
  const isLoading = view.status.kind === "stored" && view.status.at === null;

  return (
    <article
      data-quota-card={account.connectionId}
      data-quota-provider="codex_cli"
      data-quota-loading={isLoading ? "true" : "false"}
      aria-busy={isLoading || isRetrying}
      className={QUOTA_CARD_CLASS}
    >
      <header className="flex h-11 shrink-0 items-center gap-3">
        <img
          src={chatgptUrl}
          alt=""
          draggable={false}
          className="size-8 shrink-0 rounded-[9px]"
        />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-bold text-foreground">
            {account.name}
          </h3>
          <p className="truncate text-xs text-muted-foreground">
            {t("agentsPage.card.codex")}
          </p>
        </div>
        <QuotaHeaderBadges location={account.executionLocation ?? null}>
          {isLoading ? (
            <QuotaBadgePlaceholder isWide />
          ) : (
            <CodexPlanBadge plan={account.plan} />
          )}
        </QuotaHeaderBadges>
      </header>
      {isLoading ? (
        <QuotaWindowsPlaceholder />
      ) : (
        <CodexCardWindows
          body={view.body}
          targetAt={targetAt}
          hasPlan={account.plan !== null}
        />
      )}
      <QuotaStatusLine
        status={view.status}
        source={{ provider: "codex_cli", generalLimit: view.limit }}
        isRetrying={isRetrying}
        onRetry={onRetry}
      />
    </article>
  );
}

function codexWindowLabel(
  durationMinutes: number | null,
  t: TFunction,
): string {
  const length = codexWindowLength(durationMinutes);
  switch (length.kind) {
    case "five_hour":
    case "seven_day":
      return t(`agentsPage.window.${length.kind}`);
    case "unknown":
      return t("agentsPage.codex.window.unknown");
    case "days":
    case "hours":
    case "minutes":
      return t(`agentsPage.codex.window.${length.kind}`, {
        count: length.count,
      });
  }
}

function CodexQuotaWindow({
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
        label: codexWindowLabel(quotaWindow.durationMinutes, t),
        usedPercentage: quotaWindow.usedPercent,
        resetsAt: quotaWindow.resetsAt,
        durationMinutes: quotaWindow.durationMinutes,
        pace: quotaWindow.pace,
      }}
      targetAt={targetAt}
      isStale={isStale}
    />
  );
}

function CodexPlanBadge({
  plan,
}: {
  readonly plan: CodexPlan | null;
}): React.ReactElement {
  const { t } = useTranslation();
  const isKnown = plan !== null;
  return (
    <span
      data-codex-plan={plan ?? "unknown"}
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-[7px] border bg-surface py-[2px] pr-2 pl-[2px] text-[11px] leading-none font-semibold",
        isKnown
          ? "w-[88px] border-chatgpt text-foreground"
          : "border-border text-muted-foreground",
      )}
    >
      {isKnown ? (
        <img
          src={chatgptUrl}
          alt=""
          draggable={false}
          className="size-[18px] shrink-0 rounded-[5px]"
        />
      ) : (
        <span
          aria-hidden="true"
          className="size-[18px] shrink-0 rounded-[5px] bg-muted"
        />
      )}
      <span className="whitespace-nowrap">
        {plan === null
          ? t("agentsPage.plan.unknown")
          : t(`agentsPage.codex.plan.${plan}`)}
      </span>
    </span>
  );
}
