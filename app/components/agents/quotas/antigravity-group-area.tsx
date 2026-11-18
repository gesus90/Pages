import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { AntigravityQuotaGroupSlot } from "./antigravity-quota-group";
import styles from "./antigravity-quota-card.module.css";
import {
  QUOTA_GROUP_LIST_CLASS,
  QUOTA_GROUPS_AREA_CLASS,
  VISIBLE_GROUPS,
} from "./quota-card-layout";
import { QuotaNotice } from "./quota-notice";

import type { AntigravityCardBody } from "./quota-card-state";

/**
 * The area of a card between head and status line: the groups, or the notice
 * in their place.
 * @remarks
 * Up to two groups stand in their slots, one group in the middle. From three
 * groups on only the list scrolls vertically, so head, card height and status
 * line stay: it shows two groups, starts 12 px (24 px on a phone) below the
 * head and ends as far above the status line, and snaps to the start of a
 * group. It is a focusable region, so the arrow keys and Page Up and Page
 * Down reach every group, and touch scrolls it as well. It never scrolls by
 * itself, and its bar stands 14 px (10 px on a phone) right of the list in
 * the padding of the card.
 */
export function AntigravityGroupArea({
  body,
  now,
}: {
  readonly body: AntigravityCardBody;
  readonly now: Date;
}): React.ReactElement {
  const { t } = useTranslation();
  if (body.kind === "notice")
    return (
      <div data-quota-groups="notice" className={QUOTA_GROUPS_AREA_CLASS}>
        <QuotaNotice
          notice={body.notice}
          provider="antigravity"
          hasPlan={false}
        />
      </div>
    );
  const items = (
    <ul className={QUOTA_GROUP_LIST_CLASS}>
      {body.groups.map((group, position) => (
        <AntigravityQuotaGroupSlot
          key={`${position}:${group.name}`}
          group={group}
          now={now}
          isStale={body.isStale}
        />
      ))}
    </ul>
  );
  const isScrollable = body.groups.length > VISIBLE_GROUPS;
  return (
    <div
      data-quota-groups={body.groups.length}
      className={QUOTA_GROUPS_AREA_CLASS}
    >
      {isScrollable ? (
        <div
          role="region"
          tabIndex={0}
          aria-label={t("agentsPage.antigravity.groupList")}
          data-quota-group-list="scroll"
          className={cn(
            styles.groupList,
            "-mr-[14px] h-[172px] shrink-0 snap-y snap-mandatory overflow-y-auto overscroll-contain pr-[10px] focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring md:-mr-[18px] md:h-[148px] md:pr-[14px]",
          )}
        >
          {items}
        </div>
      ) : (
        items
      )}
    </div>
  );
}
