import { Info, TriangleAlert } from "lucide-react";

import { cn } from "@/app/lib/cn";
import { claudeQuotaTone } from "@/definition/ClaudeQuota";

import {
  QUOTA_BAR_CLASSES,
  QUOTA_WINDOW_SLOT_CLASS,
  QUOTA_WINDOWS_AREA_CLASS,
} from "./quota-card-layout";
import { openRouterLimitShare } from "./openrouter-quota-format";

import type { OpenRouterQuotaAccount } from "@/definition/OpenRouterQuota";
import type { OpenRouterQuotaFormat } from "./openrouter-quota-format";

type KeyReading = NonNullable<OpenRouterQuotaAccount["key"]["reading"]>;
type CreditQuota = NonNullable<OpenRouterQuotaAccount["credits"]>;

function AmountSlot({
  label,
  amount,
  share,
  detail,
  stale,
  isExhausted,
}: {
  readonly label: string;
  readonly amount: string;
  readonly share: number | null;
  readonly detail: string;
  readonly stale: string | null;
  readonly isExhausted: boolean;
}): React.ReactElement {
  return (
    <section
      aria-label={label}
      className={cn(QUOTA_WINDOW_SLOT_CLASS, "gap-1")}
    >
      <div className="flex items-baseline justify-between gap-2 text-[13px] font-semibold">
        <span>{label}</span>
        <span
          className={cn(
            "shrink-0 text-[15px] font-bold tabular-nums",
            isExhausted && "text-destructive",
          )}
        >
          {amount}
        </span>
      </div>
      {share === null ? null : (
        <div
          className="h-2.5 overflow-hidden rounded-full bg-muted"
          aria-hidden="true"
        >
          <div
            className={cn(
              "h-full rounded-full",
              QUOTA_BAR_CLASSES[claudeQuotaTone(share)],
            )}
            style={{ width: `${share}%` }}
          />
        </div>
      )}
      <div className="flex flex-wrap justify-between gap-x-2 text-xs text-muted-foreground">
        <span>{detail}</span>
        {stale ? <span>{stale}</span> : null}
      </div>
    </section>
  );
}

function CreditBalance({
  credits,
  stale,
  format,
}: {
  readonly credits: CreditQuota;
  readonly stale: string | null;
  readonly format: OpenRouterQuotaFormat;
}): React.ReactElement | null {
  const { t, money } = format;
  if (credits.mode === "manual") {
    const remaining = credits.reading?.remaining ?? null;
    const amount =
      remaining === null
        ? t("agentsPage.openRouter.unknown")
        : money(remaining);
    return (
      <AmountSlot
        label={t("agentsPage.openRouter.manualBalance")}
        amount={amount}
        share={balanceShare(remaining, credits.startAmount)}
        detail={t("agentsPage.openRouter.manualStartAmountDetail", {
          amount: money(credits.startAmount),
        })}
        stale={stale}
        isExhausted={remaining === 0}
      />
    );
  }
  if (!credits.reading) return null;
  const { purchased, used, remaining } = credits.reading;
  return (
    <AmountSlot
      label={t("agentsPage.openRouter.balance")}
      amount={money(remaining)}
      share={balanceShare(remaining, purchased)}
      detail={t("agentsPage.openRouter.creditTotals", {
        purchased: money(purchased),
        used: money(used),
      })}
      stale={stale}
      isExhausted={remaining === 0}
    />
  );
}

function balanceShare(
  remaining: number | null,
  startAmount: number,
): number | null {
  if (remaining === null) return null;
  return startAmount === 0 ? 0 : (remaining / startAmount) * 100;
}

function KeyBudget({
  reading,
  limit,
  stale,
  format,
}: {
  readonly reading: KeyReading;
  readonly limit: number;
  readonly stale: string | null;
  readonly format: OpenRouterQuotaFormat;
}): React.ReactElement {
  const { t, money } = format;
  const { remaining, reset } = reading;
  const amount =
    remaining === null ? t("agentsPage.openRouter.unknown") : money(remaining);
  const limitLabel = t("agentsPage.openRouter.limit", { amount: money(limit) });
  const details = [limitLabel];
  if (reset) details.push(t(`agentsPage.openRouter.${reset}`));
  if (remaining === 0 && stale === null)
    details.push(t("agentsPage.openRouter.limitReached"));
  return (
    <AmountSlot
      label={t("agentsPage.openRouter.remaining")}
      amount={amount}
      share={openRouterLimitShare(reading)}
      detail={details.join(" · ")}
      stale={stale}
      isExhausted={remaining === 0}
    />
  );
}

function UsageTotal({
  reading,
  stale,
  showNoLimit,
  format,
}: {
  readonly reading: KeyReading;
  readonly stale: string | null;
  readonly showNoLimit: boolean;
  readonly format: OpenRouterQuotaFormat;
}): React.ReactElement {
  const { t, money } = format;
  const { usage } = reading;
  return (
    <section className={cn(QUOTA_WINDOW_SLOT_CLASS, "gap-0.5")}>
      <span className="text-[13px] font-semibold text-muted-foreground">
        {t("agentsPage.openRouter.usage")}
      </span>
      {usage === null ? (
        <span className="text-sm text-muted-foreground">
          {t("agentsPage.openRouter.unknown")}
        </span>
      ) : (
        <strong className="text-[26px] leading-8 tabular-nums">
          {money(usage)}
        </strong>
      )}
      <div className="flex flex-wrap justify-between gap-x-2 text-xs text-muted-foreground">
        {showNoLimit ? <span>{t("agentsPage.openRouter.noLimit")}</span> : null}
        {stale ? <span>{stale}</span> : null}
      </div>
    </section>
  );
}

function OpenRouterNotice({
  title,
  detail,
  isWarning = false,
}: {
  readonly title: string;
  readonly detail?: string;
  readonly isWarning?: boolean;
}): React.ReactElement {
  const Icon = isWarning ? TriangleAlert : Info;
  return (
    <div className={cn(QUOTA_WINDOW_SLOT_CLASS, "justify-center")}>
      <div
        className={cn(
          "flex items-center gap-2.5 rounded-xl px-3.5 py-2.5",
          isWarning ? "bg-warning-subtle" : "bg-muted",
        )}
      >
        <Icon
          aria-hidden="true"
          className={cn(
            "size-3.5 shrink-0",
            isWarning ? "text-warning" : "text-muted-foreground",
          )}
        />
        <div className="min-w-0">
          <p className="text-[13px] leading-[18px]">{title}</p>
          {detail ? (
            <p className="text-xs text-muted-foreground">{detail}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function KeyDetails({
  account,
  format,
  stale,
}: {
  readonly account: OpenRouterQuotaAccount;
  readonly format: OpenRouterQuotaFormat;
  readonly stale: string | null;
}): React.ReactElement | null {
  const { key, credits } = account;
  const { t } = format;
  if (key.status === "invalid_key")
    return (
      <OpenRouterNotice
        title={t("agentsPage.openRouter.keyNotice")}
        isWarning
      />
    );
  if (key.reading && typeof key.reading.limit === "number")
    return (
      <KeyBudget
        reading={key.reading}
        limit={key.reading.limit}
        stale={stale}
        format={format}
      />
    );
  if (key.reading && credits?.mode === "manual" && !credits.reading)
    return (
      <UsageTotal
        reading={key.reading}
        stale={stale}
        showNoLimit={key.reading.limit === null}
        format={format}
      />
    );
  return <KeyNotices account={account} format={format} />;
}

function KeyNotices({
  account,
  format,
}: {
  readonly account: OpenRouterQuotaAccount;
  readonly format: OpenRouterQuotaFormat;
}): React.ReactElement | null {
  const { key, credits } = account;
  const { t } = format;
  if (credits?.status === "missing_key")
    return (
      <OpenRouterNotice
        title={t("agentsPage.openRouter.creditsUnavailable")}
        detail={t("agentsPage.openRouter.creditsNeedsManagement")}
      />
    );
  if (
    key.status === "failed" &&
    !key.reading &&
    (credits?.reading || credits?.mode === "manual")
  )
    return (
      <OpenRouterNotice
        title={t("agentsPage.openRouter.keyUnknown")}
        isWarning
      />
    );
  return null;
}

function MissingBalanceContent({
  account,
  format,
  staleKey,
  hasBalanceSlot,
}: {
  readonly account: OpenRouterQuotaAccount;
  readonly format: OpenRouterQuotaFormat;
  readonly staleKey: string | null;
  readonly hasBalanceSlot: boolean;
}): React.ReactElement {
  const { key, credits } = account;
  const { t } = format;
  return (
    <>
      {!hasBalanceSlot && key.reading ? (
        <UsageTotal
          reading={key.reading}
          stale={staleKey}
          format={format}
          showNoLimit={
            (credits !== undefined || staleKey !== null) &&
            key.reading.limit === null
          }
        />
      ) : null}
      {!hasBalanceSlot && !key.reading && key.status !== "invalid_key" ? (
        <OpenRouterNotice
          title={t("agentsPage.openRouter.noReading")}
          isWarning
        />
      ) : null}
    </>
  );
}

/** Presents account credits first, with the key's separately reported budget below. */
export function OpenRouterQuotaContent({
  account,
  format,
}: {
  readonly account: OpenRouterQuotaAccount;
  readonly format: OpenRouterQuotaFormat;
}): React.ReactElement {
  const { t, time } = format;
  const { key, credits } = account;
  const staleKey =
    key.status === "failed" && key.reading
      ? t("agentsPage.state.stored", { time: time(key.reading.at) })
      : null;
  const creditReading = credits?.reading;
  const hasBalanceSlot = credits?.mode === "manual" || Boolean(creditReading);
  const staleCredits =
    credits?.status === "failed" && creditReading
      ? t("agentsPage.state.stored", { time: time(creditReading.at) })
      : null;
  return (
    <div className={QUOTA_WINDOWS_AREA_CLASS}>
      {credits && hasBalanceSlot ? (
        <CreditBalance credits={credits} stale={staleCredits} format={format} />
      ) : null}
      <MissingBalanceContent
        account={account}
        format={format}
        staleKey={staleKey}
        hasBalanceSlot={hasBalanceSlot}
      />
      <KeyDetails account={account} format={format} stale={staleKey} />
    </div>
  );
}
