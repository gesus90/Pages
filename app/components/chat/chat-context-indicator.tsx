import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import type { ChatContextSize } from "@/definition/Chat";

interface ContextIndicatorProps {
  readonly context: ChatContextSize | null;
}

/** Small context estimate with the same explanation on hover, keyboard focus and touch. */
export function ChatContextIndicator({
  context,
}: ContextIndicatorProps): React.ReactElement {
  const { t } = useTranslation();
  const tooltipId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const tokens = context?.tokens;
  const hasTokens = tokens !== null && tokens !== undefined;
  const label = hasTokens
    ? t("chat.context.tokens", { count: tokens })
    : t("chat.context.unavailable");
  const amount =
    context?.isEstimated && hasTokens
      ? t("chat.context.estimated", { amount: label })
      : label;
  const limit = context?.limit;
  const hasLimit = limit !== null && limit !== undefined;

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>): void {
    if (event.key !== "Escape" || !isOpen) return;
    event.stopPropagation();
    setIsOpen(false);
  }

  return (
    <span
      className="relative shrink-0"
      onMouseEnter={() => setIsOpen(true)}
      onMouseLeave={() => setIsOpen(false)}
    >
      <button
        type="button"
        aria-describedby={tooltipId}
        aria-label={t("chat.context.label", { amount })}
        className="rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-primary"
        onFocus={() => setIsOpen(true)}
        onBlur={() => setIsOpen(false)}
        onClick={() => setIsOpen(true)}
        onKeyDown={handleKeyDown}
      >
        {hasTokens
          ? `${context?.isEstimated ? "≈ " : ""}${t("chat.context.tokens", { count: tokens })}`
          : t("chat.context.shortUnavailable")}
      </button>
      <span
        id={tooltipId}
        role="tooltip"
        hidden={!isOpen}
        className="absolute top-full right-0 z-50 mt-1 w-64 max-w-[calc(100vw-3rem)] rounded-lg bg-surface p-3 text-xs text-foreground shadow-panel ring-1 ring-border"
      >
        <span className="block">{t("chat.context.explanation")}</span>
        <span className="mt-1 block">{amount}</span>
        <span className="mt-1 block">
          {hasLimit
            ? t("chat.context.limit", { count: limit })
            : t("chat.context.limitUnknown")}
        </span>
        {hasTokens && hasLimit ? (
          <span className="mt-1 block">
            {t("chat.context.utilization", {
              percent: Math.round((tokens / limit) * 100),
            })}
          </span>
        ) : null}
      </span>
    </span>
  );
}
