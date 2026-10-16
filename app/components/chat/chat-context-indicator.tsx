import { useId } from "react";
import { useTranslation } from "react-i18next";

import { ChatContextDetails } from "./chat-context-details";
import { useChatContextDetails } from "./use-chat-context-details";

import type { ChatContextSize } from "@/definition/Chat";

interface ContextIndicatorProps {
  readonly context: ChatContextSize | null;
}

interface ContextCaptionProps {
  readonly context: ChatContextSize | null;
  readonly percent: number | null;
}

function ContextRing({
  percent,
}: {
  readonly percent: number | null;
}): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      className="relative inline-flex size-7 shrink-0 items-center justify-center"
    >
      <svg className="size-full -rotate-90" viewBox="0 0 36 36" fill="none">
        <circle
          className="stroke-muted-foreground/25"
          cx="18"
          cy="18"
          r="14"
          strokeWidth="4"
        />
        {percent !== null ? (
          <circle
            className="stroke-primary"
            cx="18"
            cy="18"
            r="14"
            pathLength="100"
            strokeDasharray={`${Math.min(percent, 100)} 100`}
            strokeWidth="4"
          />
        ) : null}
      </svg>
      {percent === null ? <span className="absolute text-xs">?</span> : null}
    </span>
  );
}

function ContextCaption({
  context,
  percent,
}: ContextCaptionProps): React.ReactElement {
  const { t, i18n } = useTranslation();
  const tokens = context?.tokens ?? null;
  let label = "—";
  if (tokens !== null) {
    label = t("chat.context.compactTokens", {
      amount: new Intl.NumberFormat(i18n.resolvedLanguage, {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(tokens),
    });
  }
  if (percent !== null) label = t("chat.context.percent", { percent });
  if (context?.isEstimated && tokens !== null) label = `≈ ${label}`;
  return <span>{label}</span>;
}

/** Static occupancy ring with read-only details on hover, focus and repeated tap. */
export function ChatContextIndicator({
  context,
}: ContextIndicatorProps): React.ReactElement {
  const { t } = useTranslation();
  const tooltipId = useId();
  const details = useChatContextDetails();
  const tokens = context?.tokens ?? null;
  const limit = context?.limit ?? null;
  const percent =
    tokens !== null && limit !== null && limit > 0
      ? Math.round((tokens / limit) * 100)
      : null;
  const label =
    tokens !== null
      ? t("chat.context.tokens", { count: tokens })
      : t("chat.context.unavailable");
  const amount =
    context?.isEstimated && tokens !== null
      ? t("chat.context.estimated", { amount: label })
      : label;
  return (
    <span
      ref={details.container}
      className="inline-flex shrink-0"
      onMouseEnter={details.handleMouseEnter}
      onMouseLeave={details.handlePointerLeave}
      onPointerEnter={details.handlePointerEnter}
      onPointerLeave={details.handlePointerLeave}
    >
      <button
        type="button"
        aria-describedby={tooltipId}
        aria-expanded={details.isOpen}
        aria-label={t("chat.context.label", { amount })}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-1.5 text-xs whitespace-nowrap text-muted-foreground hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary xl:min-h-9"
        onFocus={details.open}
        onBlur={details.close}
        onClick={details.toggle}
      >
        <ContextRing percent={percent} />
        <ContextCaption context={context} percent={percent} />
      </button>
      <span
        id={tooltipId}
        role="tooltip"
        hidden={!details.isOpen}
        className="absolute inset-x-0 bottom-full z-50 pb-2"
      >
        <span className="block max-h-[min(22rem,calc(100dvh-16rem))] overflow-y-auto rounded-lg bg-surface p-3 text-xs leading-relaxed text-foreground shadow-panel ring-1 ring-border">
          <ChatContextDetails
            context={context}
            amount={amount}
            percent={percent}
          />
        </span>
      </span>
    </span>
  );
}
