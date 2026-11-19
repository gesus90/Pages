import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

import openRouterLogo from "@/assets/providers/logo-openrouter.png?no-inline";
import { cn } from "@/app/lib/cn";

import { OpenRouterBalanceDialog } from "./openrouter-balance-dialog";
import { OpenRouterQuotaContent } from "./openrouter-quota-content";
import { openRouterQuotaFormat } from "./openrouter-quota-format";
import { openRouterQuotaStatus } from "./openrouter-quota-status";
import { QuotaCardFrame, QuotaHeaderBadges } from "./quota-card-frame";
import { QuotaWindowsPlaceholder } from "./quota-placeholders";
import { QuotaStatusFooter } from "./quota-status-line";
import { useRefreshHint } from "./use-refresh-hint";

import type { OpenRouterQuotaAccount } from "@/definition/OpenRouterQuota";
import type { SaveOpenRouterBalance } from "./quota-requests";

/** Shows the OpenRouter balance and key budget for one connection in the shared quota grid. */
export function OpenRouterQuotaCard({
  account,
  pendingQueries,
  now,
  onRetry,
  onSaveBalance,
}: {
  readonly account: OpenRouterQuotaAccount;
  readonly pendingQueries: number;
  readonly now: Date;
  readonly onRetry: (connectionId: string) => void;
  readonly onSaveBalance: SaveOpenRouterBalance;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  const isQuerying = pendingQueries > 0;
  const isLoading =
    account.key.status === "stored" && !account.credits?.reading;
  const isHintShown = useRefreshHint(isQuerying && !isLoading);
  const format = openRouterQuotaFormat(t, i18n.language, now);
  const presentation = openRouterQuotaStatus(account, format, isHintShown);
  const refresh = t("agentsPage.openRouter.refresh");
  const statusKind =
    account.credits?.status === "failed" ? "failed" : account.key.status;

  function handleRetry(): void {
    onRetry(account.connectionId);
  }

  return (
    <QuotaCardFrame
      connectionId={account.connectionId}
      provider="openrouter"
      isLoading={isLoading}
      isQuerying={isQuerying}
    >
      <header className="flex h-11 shrink-0 items-center gap-3">
        <img
          src={openRouterLogo}
          alt=""
          draggable={false}
          className="size-8 shrink-0 rounded-[9px]"
        />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-bold text-foreground">
            {account.name}
          </h3>
          <p className="truncate text-xs text-muted-foreground">
            {t("agentsPage.openRouter.subtitle")}
          </p>
        </div>
        {account.credits ? (
          <OpenRouterBalanceDialog
            connectionId={account.connectionId}
            name={account.name}
            display={account.credits}
            onSave={onSaveBalance}
          />
        ) : null}
        <button
          type="button"
          title={refresh}
          aria-label={refresh}
          onClick={handleRetry}
          disabled={isQuerying}
          className="flex size-8 shrink-0 items-center justify-center rounded-[9px] border border-border-strong text-muted-foreground hover:bg-surface-hover disabled:cursor-default"
        >
          <RefreshCw
            aria-hidden="true"
            className={cn(
              "size-4",
              isHintShown && "animate-spin motion-reduce:animate-none",
            )}
          />
        </button>
        <QuotaHeaderBadges location={null} />
      </header>
      {isLoading ? (
        <QuotaWindowsPlaceholder />
      ) : (
        <OpenRouterQuotaContent account={account} format={format} />
      )}
      <QuotaStatusFooter
        kind={statusKind}
        presentation={presentation}
        progress={{ isQuerying, isHintShown }}
        onRetry={handleRetry}
        connectionHref={`/settings/agents?connection=${encodeURIComponent(account.connectionId)}`}
      />
    </QuotaCardFrame>
  );
}
