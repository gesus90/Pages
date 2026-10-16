import { useTranslation } from "react-i18next";

import type { ChatContextSize } from "@/definition/Chat";

interface ChatContextDetailsProps {
  readonly context: ChatContextSize | null;
  readonly amount: string;
  readonly percent: number | null;
}

/** Explains the reported or estimated occupancy without assuming an automatic threshold. */
export function ChatContextDetails({
  context,
  amount,
  percent,
}: ChatContextDetailsProps): React.ReactElement {
  const { t } = useTranslation();
  const tokens = context?.tokens ?? null;
  const limit = context?.limit ?? null;
  const remaining =
    tokens !== null && limit !== null ? Math.max(0, limit - tokens) : null;

  function estimate(label: string): string {
    return context?.isEstimated
      ? t("chat.context.estimated", { amount: label })
      : label;
  }

  return (
    <>
      <span className="block font-semibold">{t("chat.context.title")}</span>
      <span className="mt-2 block">{amount}</span>
      <span className="mt-1 block">
        {limit !== null
          ? t("chat.context.limit", { count: limit })
          : t("chat.context.limitUnknown")}
      </span>
      <span className="mt-1 block">
        {percent !== null
          ? estimate(t("chat.context.utilization", { percent }))
          : t("chat.context.utilizationUnknown")}
      </span>
      <span className="mt-1 block">
        {remaining !== null
          ? estimate(t("chat.context.remaining", { count: remaining }))
          : t("chat.context.remainingUnknown")}
      </span>
      <span className="mt-1 block">
        {context !== null && context.source !== "adapter"
          ? t("chat.context.manualCompaction")
          : t("chat.context.compactionUnknown")}
      </span>
      <span className="mt-2 block text-muted-foreground">
        {t(
          context?.source === "adapter"
            ? "chat.context.adapterExplanation"
            : "chat.context.explanation",
        )}
      </span>
      <span className="mt-2 block text-muted-foreground">
        {t("chat.context.dismissHint")}
      </span>
    </>
  );
}
