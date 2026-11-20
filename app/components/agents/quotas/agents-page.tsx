import { RefreshCw } from "lucide-react";
import {
  startTransition,
  useCallback,
  useEffect,
  useReducer,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { QuotaCardGrid } from "./quota-card-grid";
import { followQuotaPushes, QuotaRequests } from "./quota-requests";
import { INITIAL_QUOTA_STATE, reduceQuotas } from "./quota-state";
import { useQuotaCardOrder } from "./use-quota-card-order";

import type { SaveOpenRouterBalance } from "./quota-requests";
import type { ClaudeQuotaState, QuotaAction } from "./quota-state";
import type { SortedQuotaCards } from "./use-quota-card-order";

/**
 * The page "Agents": what is left of the AI accounts a person may use.
 * Agent Plan, runs and the working directory stand below "Agents" in the
 * main navigation.
 * @remarks
 * It shows one card per supported connection the person may use. The page
 * stands with its cards at once: three placeholder cards while the connections are
 * unknown, then a card per connection with its last stored figures, which
 * the current figures replace card by card as each query answers. The
 * figures stay while a query runs or fails, so the page never falls back to
 * an empty state once it has cards; the empty state appears only when it is
 * certain that no card is available. The cards fill as many columns as fit
 * with at least 518 px per card and grow with the window at a fixed gap; the
 * header of the section and the grid share one width. All cards have the same
 * height, 340 px from the medium breakpoint and 344 px below it, also in a row
 * with fewer cards. A person arranges the cards by drag and drop or by
 * keyboard; Pages stores that order per account, so it holds after a reload
 * and on every device, and a list, a query or the push of the minute never
 * changes it. Until the person sorts, the cards stand in the default order,
 * and a card the order does not know yet stands at the end.
 */
export function AgentsPage(): React.ReactElement {
  const { t } = useTranslation();
  const quotas = useAgentQuotas();
  const { cards, hasListFailed, isLive } = quotas.state;
  const order = useQuotaCardOrder(cards);
  const hasNoCards = cards !== null && cards.length === 0;
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
        className="@container mt-8 flex flex-col gap-4"
      >
        <QuotaSectionHeader
          isRefreshing={quotas.isRefreshing}
          isLive={isLive}
          onRefresh={quotas.refresh}
        />
        {hasNoCards ? (
          <p className="text-[13px] text-muted-foreground">
            {t("agentsPage.quotas.noConnections")}
          </p>
        ) : null}
        {hasListFailed ? (
          <p role="alert" className="text-[13px] text-warning">
            {t("agentsPage.quotas.loadFailed")}
          </p>
        ) : null}
        {hasNoCards || hasListFailed ? null : (
          <>
            <QuotaOrderNotice order={order} />
            <QuotaCardGrid
              cards={order.cards}
              onRetry={quotas.retryCard}
              onMove={order.move}
              onSaveOpenRouterBalance={quotas.saveOpenRouterBalance}
            />
          </>
        )}
      </section>
    </div>
  );
}

interface AgentQuotas {
  readonly state: ClaudeQuotaState;
  readonly isRefreshing: boolean;
  readonly refresh: () => void;
  readonly retryCard: (connectionId: string) => Promise<void>;
  readonly saveOpenRouterBalance: SaveOpenRouterBalance;
}

function useAgentQuotas(): AgentQuotas {
  const [state, dispatch] = useReducer(reduceQuotas, INITIAL_QUOTA_STATE);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const applyQuotaAction = useCallback((action: QuotaAction): void => {
    startTransition(() => dispatch(action));
  }, []);
  const [requests] = useState(() => new QuotaRequests(applyQuotaAction));

  useEffect(() => {
    function refreshVisibleQuotas(): void {
      if (document.visibilityState === "visible") void requests.load();
    }

    void requests.load();
    const stopPushes = followQuotaPushes(applyQuotaAction, () =>
      requests.nextRequestNumber(),
    );
    document.addEventListener("visibilitychange", refreshVisibleQuotas);
    return () => {
      document.removeEventListener("visibilitychange", refreshVisibleQuotas);
      stopPushes();
      requests.abort();
    };
  }, [applyQuotaAction, requests]);

  async function refreshQuotas(): Promise<void> {
    setIsRefreshing(true);
    try {
      await requests.load();
    } finally {
      startTransition(() => setIsRefreshing(false));
    }
  }

  function refresh(): void {
    void refreshQuotas();
  }

  const retryCard = useCallback(
    (connectionId: string) => requests.query(connectionId),
    [requests],
  );
  const saveOpenRouterBalance = useCallback<SaveOpenRouterBalance>(
    (connectionId, display) =>
      requests.saveOpenRouterBalance(connectionId, display),
    [requests],
  );

  return {
    state,
    isRefreshing,
    refresh,
    retryCard,
    saveOpenRouterBalance,
  };
}

const NOTICE_BUTTON_CLASS =
  "inline-flex h-8 items-center rounded-[10px] border border-border bg-surface px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-surface-hover";

function QuotaOrderNotice({
  order,
}: {
  readonly order: SortedQuotaCards;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (order.saveState === "failed")
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[10px] border border-border bg-warning-subtle px-3 py-2 text-[13px] text-foreground"
      >
        <p className="mr-auto text-warning">
          {order.hasLoadFailed
            ? t("agentsPage.order.saveFailedUnknown")
            : t("agentsPage.order.saveFailed")}
        </p>
        <button
          type="button"
          onClick={order.retrySave}
          className={NOTICE_BUTTON_CLASS}
        >
          {t("agentsPage.order.retry")}
        </button>
        {order.hasLoadFailed ? null : (
          <button
            type="button"
            onClick={order.restoreSaved}
            className={NOTICE_BUTTON_CLASS}
          >
            {t("agentsPage.order.showSaved")}
          </button>
        )}
      </div>
    );
  if (!order.hasLoadFailed) return null;
  return (
    <p role="status" className="text-[13px] text-warning">
      {t("agentsPage.order.loadFailed")}
    </p>
  );
}

function QuotaSectionHeader({
  isRefreshing,
  isLive,
  onRefresh,
}: {
  readonly isRefreshing: boolean;
  readonly isLive: boolean;
  readonly onRefresh: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-9 max-w-[720px] flex-wrap items-center gap-x-3 gap-y-1 pb-5 @min-[1056px]:max-w-none md:pb-0">
      <h2 className="mr-auto text-lg font-bold text-foreground">
        <span className="md:hidden">{t("agentsPage.quotas.shortTitle")}</span>
        <span className="hidden md:inline">{t("agentsPage.quotas.title")}</span>
      </h2>
      {isLive ? (
        <span className="inline-flex h-6 items-center gap-1.5 rounded-[7px] border border-border bg-surface px-2 text-[11px] font-semibold text-foreground">
          <span
            aria-hidden="true"
            className="size-1.5 rounded-full bg-success"
          />
          {t("agentsPage.status.live")}
        </span>
      ) : null}
      <RefreshButton isRefreshing={isRefreshing} onRefresh={onRefresh} />
    </div>
  );
}

/**
 * The two button labels share a grid cell so the header keeps its width
 * while the refresh is running.
 */
function RefreshButton({
  isRefreshing,
  onRefresh,
}: {
  readonly isRefreshing: boolean;
  readonly onRefresh: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const label = t(
    isRefreshing
      ? "agentsPage.status.refreshingAll"
      : "agentsPage.status.refresh",
  );
  return (
    <button
      type="button"
      onClick={onRefresh}
      disabled={isRefreshing}
      aria-busy={isRefreshing}
      aria-label={label}
      title={label}
      className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-border bg-surface px-3 text-[13px] font-semibold text-foreground transition-colors hover:bg-surface-hover disabled:cursor-default"
    >
      <RefreshCw
        className={cn(
          "size-4 shrink-0",
          isRefreshing && "animate-spin motion-reduce:animate-none",
        )}
        aria-hidden="true"
      />
      <span aria-hidden="true" className="inline-grid whitespace-nowrap">
        <span
          className={cn("col-start-1 row-start-1", isRefreshing && "invisible")}
        >
          {t("agentsPage.status.refreshAll")}
        </span>
        <span
          className={cn(
            "col-start-1 row-start-1",
            !isRefreshing && "invisible",
          )}
        >
          {t("agentsPage.status.refreshingAll")}
        </span>
      </span>
    </button>
  );
}
