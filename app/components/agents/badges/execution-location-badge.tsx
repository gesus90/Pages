import { CircleHelp, Monitor, Server } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";
import { EXECUTION_LOCATIONS } from "@/definition/ExecutionLocation";

import type { LucideIcon } from "lucide-react";
import type { ExecutionLocation } from "@/definition/ExecutionLocation";

const BADGE_CLASS =
  "inline-flex h-6 max-w-full shrink-0 items-center gap-1.5 rounded-[7px] border px-2 text-[11px] leading-4 font-semibold whitespace-nowrap";

/** Symbol and colors of each place; the unknown place is not a location. */
const BADGE_LOOKS: Readonly<
  Record<ExecutionLocation | "unknown", { icon: LucideIcon; className: string }>
> = {
  local: {
    icon: Monitor,
    className: "border-border-strong bg-muted text-muted-foreground",
  },
  remote: {
    icon: Server,
    className: "border-info bg-info-subtle text-info",
  },
  unknown: {
    icon: CircleHelp,
    className:
      "border-dashed border-border-strong bg-surface text-muted-foreground",
  },
};

function isExecutionLocation(value: unknown): value is ExecutionLocation {
  return EXECUTION_LOCATIONS.some((location) => location === value);
}

/**
 * Where the runner of an agent executes it, as a badge with a symbol and a word.
 * @remarks
 * The place belongs to the runner; provider, API key, access and plan never
 * decide it. Only a location the data names shows "Lokal" or "Remote"; a
 * missing or unrecognised one shows "Unbekannt", never "Lokal". The word
 * carries the statement, the color only supports it. The same badge stands
 * wherever the place of an agent is shown.
 */
export function ExecutionLocationBadge({
  location,
  className,
}: {
  /** The place the card's data names, or `null` or absent when it names none. */
  readonly location?: ExecutionLocation | null;
  readonly className?: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const place = isExecutionLocation(location) ? location : "unknown";
  const { icon: Icon, className: looks } = BADGE_LOOKS[place];
  return (
    <span
      data-execution-location={place}
      className={cn(BADGE_CLASS, looks, className)}
    >
      <Icon aria-hidden="true" className="size-3 shrink-0" />
      {t(`agentBadges.executionLocation.${place}`)}
    </span>
  );
}
