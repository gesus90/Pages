import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";
import {
  ANTIGRAVITY_QUOTA_WINDOWS,
  antigravityGroupFamily,
} from "@/definition/AntigravityQuota";

import {
  antigravityGroupLabel,
  GROUP_DOT_CLASSES,
} from "./antigravity-group-label";
import { AntigravityQuotaWindow } from "./antigravity-quota-window";
import { QUOTA_GROUP_SLOT_CLASS } from "./quota-card-layout";

import type { AntigravityQuotaGroup as QuotaGroup } from "@/definition/AntigravityQuota";

/**
 * One group of a card: the group name with its dot and two columns, the
 * five-hour window left and the seven-day window right.
 * @remarks
 * The group fills a slot of the card, 68 px on a wide card and 76 px on a
 * phone, and starts a scroll-snap position. Only the windows Antigravity
 * reported for the group stand in their own column; a window it did not
 * report leaves its column empty, so the other one keeps its place.
 */
export function AntigravityQuotaGroupSlot({
  group,
  now,
  isStale,
}: {
  readonly group: QuotaGroup;
  readonly now: Date;
  readonly isStale: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const label = antigravityGroupLabel(group.name, t);
  return (
    <li
      data-quota-group={group.name}
      className={cn(QUOTA_GROUP_SLOT_CLASS, "snap-start")}
    >
      <div className="flex h-4 items-center gap-2">
        <span
          aria-hidden="true"
          className={cn(
            "size-2 shrink-0 rounded-full",
            GROUP_DOT_CLASSES[antigravityGroupFamily(group.name)],
          )}
        />
        <h4 className="truncate text-xs font-bold text-foreground">{label}</h4>
      </div>
      <div className="grid min-h-0 grid-cols-2 gap-[18px]">
        {ANTIGRAVITY_QUOTA_WINDOWS.map((kind) => {
          const quotaWindow = group.windows.find(
            (window) => window.kind === kind,
          );
          return quotaWindow ? (
            <AntigravityQuotaWindow
              key={kind}
              quotaWindow={quotaWindow}
              groupLabel={label}
              now={now}
              isStale={isStale}
            />
          ) : (
            <div key={kind} aria-hidden="true" />
          );
        })}
      </div>
    </li>
  );
}
