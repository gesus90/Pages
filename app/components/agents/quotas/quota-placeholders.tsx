import { cn } from "@/app/lib/cn";

import {
  QUOTA_CARD_CLASS,
  QUOTA_GROUP_LIST_CLASS,
  QUOTA_GROUP_SLOT_CLASS,
  QUOTA_GROUPS_AREA_CLASS,
  QUOTA_STATUS_LINE_CLASS,
  QUOTA_WINDOW_SLOT_CLASS,
  QUOTA_WINDOWS_AREA_CLASS,
} from "./quota-card-layout";
import styles from "./quota-loading.module.css";

/** A grey face of a placeholder; the light band runs over it. */
function PlaceholderFace({
  className,
}: {
  readonly className: string;
}): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      className={cn("block shrink-0 rounded-[5px]", styles.band, className)}
    />
  );
}

/**
 * The placeholder of one window slot: label and figure, the bar and the two
 * foot lines, on the lines of a real window.
 */
function QuotaWindowPlaceholder(): React.ReactElement {
  return (
    <div
      aria-hidden="true"
      data-quota-placeholder="window"
      className={cn(QUOTA_WINDOW_SLOT_CLASS, "gap-2 md:gap-2.5")}
    >
      <div className="flex h-5 items-center justify-between gap-3">
        <PlaceholderFace className="h-3 w-[84px]" />
        <PlaceholderFace className="h-3.5 w-[58px]" />
      </div>
      <PlaceholderFace className="h-2.5 w-full" />
      <div className="flex h-4 items-center justify-between gap-3">
        <PlaceholderFace className="h-2.5 w-[150px]" />
        <PlaceholderFace className="h-2.5 w-[82px]" />
      </div>
    </div>
  );
}

/**
 * The window area of a card whose figures are not known yet: two slots of
 * placeholders where the windows will stand.
 */
export function QuotaWindowsPlaceholder(): React.ReactElement {
  return (
    <div data-quota-windows="placeholder" className={QUOTA_WINDOWS_AREA_CLASS}>
      <QuotaWindowPlaceholder />
      <QuotaWindowPlaceholder />
    </div>
  );
}

/** The placeholder of one column of a group: label and figure, the bar and the reset line. */
function QuotaGroupColumnPlaceholder(): React.ReactElement {
  return (
    <div className="flex min-w-0 flex-col">
      <div className="mb-1.5 flex h-4 shrink-0 items-center justify-between gap-2">
        <PlaceholderFace className="h-3 w-14" />
        <PlaceholderFace className="h-3.5 w-12" />
      </div>
      <PlaceholderFace className="h-2 w-full" />
      <div className="mt-[5px] flex h-3.5 items-center">
        <PlaceholderFace className="h-2.5 w-24" />
      </div>
      <div className="mt-[3px] flex h-3.5 items-center justify-between gap-1">
        <PlaceholderFace className="h-2 w-12" />
        <PlaceholderFace className="h-2 w-12" />
      </div>
    </div>
  );
}

/**
 * The group area of an Antigravity card whose figures are not known yet: two
 * slots of placeholders where the groups will stand, on the lines of real
 * groups.
 */
export function QuotaGroupsPlaceholder(): React.ReactElement {
  return (
    <div data-quota-groups="placeholder" className={QUOTA_GROUPS_AREA_CLASS}>
      <div className={QUOTA_GROUP_LIST_CLASS}>
        {["first", "second"].map((position) => (
          <div
            key={position}
            aria-hidden="true"
            data-quota-placeholder="group"
            className={QUOTA_GROUP_SLOT_CLASS}
          >
            <div className="flex h-4 items-center">
              <PlaceholderFace className="h-3 w-24" />
            </div>
            <div className="grid min-h-0 grid-cols-2 gap-[18px]">
              <QuotaGroupColumnPlaceholder />
              <QuotaGroupColumnPlaceholder />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The placeholder of the plan badge, 24 px high with a 7 px radius: 68 px
 * wide for a Claude card, 88 px for a Codex card.
 */
export function QuotaBadgePlaceholder({
  isWide = false,
}: {
  readonly isWide?: boolean;
}): React.ReactElement {
  return (
    <PlaceholderFace
      className={cn("h-6 rounded-[7px]", isWide ? "w-[88px]" : "w-[68px]")}
    />
  );
}

/**
 * The placeholder of the location badge: 66 px wide, 24 px high, 7 px radius.
 * It holds the corner of a card whose place is not known yet.
 */
export function QuotaLocationPlaceholder(): React.ReactElement {
  return <PlaceholderFace className="h-6 w-[66px] rounded-[7px]" />;
}

/**
 * A card while the connections are not known yet: logo, name, subtitle, two
 * window slots and the status line as placeholders, without any text.
 * @remarks
 * It has the size of a real card and the lines of its parts, so the real
 * card that replaces it stands exactly where it stood.
 */
export function QuotaPlaceholderCard(): React.ReactElement {
  return (
    <article
      aria-hidden="true"
      data-quota-placeholder="card"
      className={QUOTA_CARD_CLASS}
    >
      <header className="flex h-11 shrink-0 items-center gap-3">
        <PlaceholderFace className="size-8 rounded-[9px]" />
        <div className="min-w-0 flex-1">
          <div className="flex h-6 items-center">
            <PlaceholderFace className="h-4 w-[130px]" />
          </div>
          <div className="flex h-4 items-center">
            <PlaceholderFace className="h-3 w-[90px]" />
          </div>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5 md:gap-2">
          <QuotaLocationPlaceholder />
        </div>
      </header>
      <QuotaWindowsPlaceholder />
      <footer className={QUOTA_STATUS_LINE_CLASS}>
        <PlaceholderFace className="h-3 w-[170px]" />
      </footer>
    </article>
  );
}
