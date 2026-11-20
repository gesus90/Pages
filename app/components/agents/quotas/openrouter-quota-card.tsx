import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

import openRouterLogo from "@/assets/providers/logo-openrouter.png?no-inline";
import { openRouterExecutionLocation } from "@/definition/OpenRouterQuota";

import { OpenRouterBalanceDialog } from "./openrouter-balance-dialog";
import { OpenRouterQuotaContent } from "./openrouter-quota-content";
import { openRouterQuotaFormat } from "./openrouter-quota-format";
import { openRouterQuotaStatus } from "./openrouter-quota-status";
import { QuotaCardFrame, QuotaHeaderBadges } from "./quota-card-frame";
import { QuotaWindowsPlaceholder } from "./quota-placeholders";
import { QuotaStatusFooter } from "./quota-status-line";
import { useQuotaCalendarDate } from "./quota-time";

import type { OpenRouterQuotaAccount } from "@/definition/OpenRouterQuota";
import type { SaveOpenRouterBalance } from "./quota-requests";

/** Shows the OpenRouter balance and key budget for one connection in the shared quota grid. */
export function OpenRouterQuotaCard({
  account,
  isRetrying,
  onRetry,
  onSaveBalance,
}: {
  readonly account: OpenRouterQuotaAccount;
  readonly isRetrying: boolean;
  readonly onRetry: () => void;
  readonly onSaveBalance: SaveOpenRouterBalance;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  const isLoading =
    account.key.status === "stored" &&
    !account.key.reading &&
    !account.credits?.reading;
  const now = useQuotaCalendarDate(
    Boolean(account.key.reading ?? account.credits?.reading),
  );
  const format = openRouterQuotaFormat(t, i18n.language, now);
  const presentation = openRouterQuotaStatus(account, format);
  const refresh = t("agentsPage.openRouter.refresh");
  const statusKind =
    account.credits?.status === "failed" ? "failed" : account.key.status;

  return (
    <QuotaCardFrame
      connectionId={account.connectionId}
      provider="openrouter"
      isLoading={isLoading}
      isQuerying={isRetrying}
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
          onClick={onRetry}
          disabled={isLoading || isRetrying}
          className="flex size-8 shrink-0 items-center justify-center rounded-[9px] border border-border-strong text-muted-foreground hover:bg-surface-hover disabled:cursor-default"
        >
          <RefreshCw aria-hidden="true" className="size-4" />
        </button>
        <QuotaHeaderBadges
          location={openRouterExecutionLocation(account)}
          isLocationPending={isLoading}
        />
      </header>
      {isLoading ? (
        <QuotaWindowsPlaceholder />
      ) : (
        <OpenRouterQuotaContent account={account} format={format} />
      )}
      <QuotaStatusFooter
        kind={statusKind}
        presentation={presentation}
        isRetrying={isRetrying}
        onRetry={onRetry}
        connectionHref={`/settings/agents?connection=${encodeURIComponent(account.connectionId)}`}
      />
    </QuotaCardFrame>
  );
}
