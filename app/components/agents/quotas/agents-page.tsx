import { useTranslation } from "react-i18next";

import { ClaudeQuotaCard } from "./claude-quota-card";
import { QuotaSectionHeader } from "./quota-section-header";
import { useClaudeQuotas } from "./use-claude-quotas";
import { useQuotaClock } from "./use-quota-clock";

/**
 * The page "Agents": what is left of the AI accounts a person may use.
 * Agent Plan, runs and the working directory stand below "Agents" in the
 * main navigation.
 * @remarks
 * The first version shows one card per Claude connection. The figures stay
 * while a query runs or fails, so the page never falls back to an empty
 * state once it has figures. All cards have the same height, 308 px on a
 * wide screen and 344 px in the single column of a phone, also in a row
 * with fewer cards.
 */
export function AgentsPage(): React.ReactElement {
  const { t } = useTranslation();
  const quotas = useClaudeQuotas();
  const now = useQuotaClock();
  const accounts = quotas.snapshot?.accounts ?? null;
  return (
    <div className="flex w-full flex-col">
      <header>
        <h1 className="text-[28px] leading-[34px] font-bold tracking-tight text-foreground xl:text-4xl">
          {t("agentsPage.title")}
        </h1>
        <p className="mt-1 text-base text-muted-foreground">
          {t("agentsPage.subtitle")}
        </p>
      </header>
      <section
        aria-label={t("agentsPage.quotas.title")}
        className="mt-8 flex flex-col gap-4"
      >
        <QuotaSectionHeader state={quotas} onRefresh={quotas.refresh} />
        {accounts !== null && accounts.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            {t("agentsPage.quotas.noConnections")}
          </p>
        ) : null}
        {accounts !== null && accounts.length > 0 ? (
          <div className="grid auto-rows-[344px] grid-cols-1 gap-5 md:auto-rows-[308px] md:grid-cols-2 xl:grid-cols-3">
            {accounts.map((account) => (
              <ClaudeQuotaCard
                key={account.connectionId}
                account={account}
                now={now}
                isRefreshing={quotas.pendingQueries > 0}
                onRetry={quotas.refresh}
              />
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}
