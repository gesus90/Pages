import { RefreshCw, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useRegionFormatter } from "@/app/components/common/region-provider";
import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";

import { PicaMascot } from "./pica-mascot";

import type {
  ChatQuotaDemo,
  ChatQuotaDemoHold,
  ChatQuotaDemoKind,
  ChatQuotaDemoState,
} from "./use-chat-quota-demo";

const SECONDS_PER_MINUTE = 60;

/** A used-up quota warns; a missing budget report only informs. */
const DEMO_TONES: Readonly<Record<ChatQuotaDemoKind, string>> = {
  exhausted: "bg-warning-subtle",
  unreported: "bg-info-subtle",
};

/** The time since the shown state began, as of the last refresh; no countdown. */
function elapsedText(state: ChatQuotaDemoState, language: string): string {
  const seconds = Math.max(
    0,
    Math.floor((state.checkedAt - state.since) / 1000),
  );
  const isMinutes = seconds >= SECONDS_PER_MINUTE;
  return new Intl.NumberFormat(language, {
    style: "unit",
    unit: isMinutes ? "minute" : "second",
    unitDisplay: "short",
  }).format(isMinutes ? Math.floor(seconds / SECONDS_PER_MINUTE) : seconds);
}

/** Marks every part of the simulation, so it never reads as a provider's report. */
function ChatQuotaDemoBadge(): React.ReactElement {
  const { t } = useTranslation();
  return (
    <span className="shrink-0 rounded-full bg-surface px-2 py-0.5 text-xs font-semibold text-foreground ring-1 ring-border">
      {t("chat.quotaDemo.badge")}
    </span>
  );
}

/**
 * The simulated quota state above the input (PAGE-96): what it means, how
 * long it lasts, and the buttons that refresh, switch or reset it.
 */
export function ChatQuotaDemoStatus({
  demo,
}: {
  readonly demo: ChatQuotaDemo;
}): React.ReactElement | null {
  const { t, i18n } = useTranslation();
  const { formatDateTime } = useRegionFormatter();
  const { state } = demo;
  if (state === null) return null;
  const textKey = `chat.quotaDemo.${state.kind}`;
  return (
    <section
      aria-labelledby="pica-quota-demo-title"
      className={cn(
        "mb-2 space-y-1.5 rounded-xl px-3 py-2 text-xs text-foreground ring-1 ring-border",
        DEMO_TONES[state.kind],
      )}
    >
      <h3
        className="flex items-center gap-2 text-sm font-semibold"
        id="pica-quota-demo-title"
      >
        <ChatQuotaDemoBadge />
        {t(`${textKey}.title`)}
      </h3>
      <p>{t(`${textKey}.description`)}</p>
      <p className="text-muted-foreground" role="status">
        {t(`${textKey}.status`, {
          elapsed: elapsedText(state, i18n.language),
          checked: formatDateTime(new Date(state.checkedAt).toISOString()),
        })}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={demo.refresh} size="xs" variant="outline">
          <RefreshCw aria-hidden="true" className="size-3.5" />
          {t("chat.quotaDemo.refresh")}
        </Button>
        <Button onClick={demo.reset} size="xs" variant="outline">
          <RotateCcw aria-hidden="true" className="size-3.5" />
          {t("chat.quotaDemo.reset")}
        </Button>
        <Button onClick={demo.switchKind} size="xs" variant="ghost">
          {t(`${textKey}.switch`)}
        </Button>
      </div>
    </section>
  );
}

/**
 * Pica's simulated answer to a message the used-up quota held back; it is
 * not stored and disappears with the demonstration.
 */
export function ChatQuotaDemoAnswer({
  hold,
}: {
  readonly hold: ChatQuotaDemoHold;
}): React.ReactElement {
  const { t } = useTranslation();
  const { formatDateTime } = useRegionFormatter();
  return (
    <article aria-label={t("chat.title")} className="flex gap-2">
      <PicaMascot className="mt-1 size-7" />
      <div className="min-w-0 max-w-[85%] space-y-1.5 rounded-2xl bg-surface px-3 py-2 ring-1 ring-border">
        <ChatQuotaDemoBadge />
        <p className="text-sm">{t("chat.quotaDemo.answer")}</p>
        <p className="text-xs text-muted-foreground">
          {t("chat.quotaDemo.held", {
            time: formatDateTime(new Date(hold.heldAt).toISOString()),
          })}
        </p>
      </div>
    </article>
  );
}
