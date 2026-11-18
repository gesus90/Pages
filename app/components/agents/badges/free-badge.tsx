import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

/** Where the badge stands: a row of the model choice, or the head of an answer. */
export type FreeBadgeSize = "tag" | "badge";

// Static classes, so Tailwind finds them: the tag of a list row is 20 px high
// with a 6 px radius, the badge beside the model and reasoning badges 24 px
// with a 7 px radius.
const SIZE_CLASSES: Readonly<Record<FreeBadgeSize, string>> = {
  tag: "h-5 rounded-[6px]",
  badge: "h-6 rounded-[7px]",
};

interface FreeBadgeProps {
  readonly size?: FreeBadgeSize;
  readonly className?: string;
}

/**
 * The green "Free" of a model the catalog states as free for exactly this
 * access.
 * @remarks
 * A badge of its own beside the model, never part of the model's name: a
 * 1 px solid border in `success-dot`, the background `success-subtle` and
 * text of 11/600 in `success`, with 8 px of padding on either side, without
 * a tile and on one line. It never shrinks, so only the model name beside it
 * is cut. The caller shows it only where the catalog says so; a "Free" in a
 * model's name is no proof of a price.
 */
export function FreeBadge({
  size = "tag",
  className,
}: FreeBadgeProps): React.ReactElement {
  const { t } = useTranslation();
  return (
    <span
      data-free-badge={size}
      className={cn(
        "inline-flex shrink-0 items-center border border-success-dot bg-success-subtle px-2 text-[11px] leading-none font-semibold whitespace-nowrap text-success",
        SIZE_CLASSES[size],
        className,
      )}
    >
      {t("plans.modelPicker.free")}
    </span>
  );
}
