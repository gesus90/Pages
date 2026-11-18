import { CirclePause, Info, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import type { LucideIcon } from "lucide-react";
import type { QuotaAccount } from "@/definition/AgentQuota";
import type { QuotaNoticeKind } from "./quota-card-state";

interface NoticeStyle {
  readonly icon: LucideIcon;
  /** Box and icon classes; static, so Tailwind finds them. */
  readonly boxClass: string;
  readonly iconClass: string;
}

/**
 * Neutral notices for what the provider said or what Pages left out on purpose,
 * warning notices where Pages has nothing it could show.
 */
const NOTICE_STYLES: Readonly<Record<QuotaNoticeKind, NoticeStyle>> = {
  noWindows: {
    icon: Info,
    boxClass: "bg-muted",
    iconClass: "text-muted-foreground",
  },
  skipped: {
    icon: CirclePause,
    boxClass: "bg-muted",
    iconClass: "text-muted-foreground",
  },
  failed: {
    icon: TriangleAlert,
    boxClass: "bg-warning-subtle",
    iconClass: "text-warning",
  },
  signedOut: {
    icon: TriangleAlert,
    boxClass: "bg-warning-subtle",
    iconClass: "text-warning",
  },
};

/**
 * The notice a card shows in place of windows.
 * @remarks
 * It stands centred in the window area and never grows beyond it: longer
 * text is cut with an ellipsis and stands in full in the tooltip. After a
 * failed first query the notice of a Claude card adds that the plan stays
 * unknown, but only while the card shows no plan. A card of another provider
 * has no plan and always says what to expect.
 */
export function QuotaNotice({
  notice,
  provider,
  hasPlan,
}: {
  readonly notice: QuotaNoticeKind;
  readonly provider: QuotaAccount["provider"];
  readonly hasPlan: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const style = NOTICE_STYLES[notice];
  const Icon = style.icon;
  const scope =
    provider === "antigravity"
      ? "agentsPage.antigravity.notice"
      : "agentsPage.notice";
  const title = t(`${scope}.${notice}.title`);
  const detail =
    notice === "failed" && hasPlan ? null : t(`${scope}.${notice}.detail`);
  return (
    <div
      role="status"
      data-quota-notice={notice}
      title={detail === null ? title : `${title}\n${detail}`}
      className={cn(
        "flex max-h-full min-h-0 gap-2.5 overflow-hidden rounded-xl px-3.5 py-3",
        style.boxClass,
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn("mt-0.5 size-3.5 shrink-0", style.iconClass)}
      />
      <div className="min-w-0">
        <p className="line-clamp-3 text-[13px] leading-[18px] text-foreground">
          {title}
        </p>
        {detail === null ? null : (
          <p className="mt-0.5 line-clamp-2 text-xs leading-4 text-muted-foreground">
            {detail}
          </p>
        )}
      </div>
    </div>
  );
}
