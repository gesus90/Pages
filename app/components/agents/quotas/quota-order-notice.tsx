import { useTranslation } from "react-i18next";

import type { SortedQuotaCards } from "./use-quota-card-order";

const NOTICE_BUTTON_CLASS =
  "inline-flex h-8 items-center rounded-[10px] border border-border bg-surface px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-surface-hover";

/**
 * Tells the person when the order of the cards is not stored.
 * @remarks
 * After a failed store the cards keep the new order, because the person just
 * chose it, and the notice says that the stored order is the earlier one. It
 * offers to store the new order again or to show the stored one, so it is
 * always clear which order holds after a reload. When the stored order could
 * not be read at all, the notice says that the default order stands and that
 * the next move is stored.
 */
export function QuotaOrderNotice({
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
