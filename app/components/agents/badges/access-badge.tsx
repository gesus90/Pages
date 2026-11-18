import { CircleAlert, Eye, ShieldQuestion } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import type { AgentRunAccess } from "@/definition/AgentConfiguration";

const BADGE_CLASS =
  "inline-flex h-6 max-w-full shrink-0 items-center gap-1.5 rounded-[7px] border px-2 text-[11px] leading-none font-semibold";

/**
 * The access of a session as a badge with a symbol and a word.
 * @remarks
 * YOLO runs natively with the account's rights and is shown as a warning,
 * read-only access as information. Earlier modes keep their own name in a
 * neutral badge. Like every agent badge it has a 1 px solid border in its own
 * color. The same badge stands wherever a session's access is shown.
 */
export function AccessBadge({
  access,
  className,
}: {
  readonly access: AgentRunAccess;
  readonly className?: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const label = t(`agentBadges.access.${access}`);
  if (access === "yolo")
    return (
      <span
        data-access-badge={access}
        className={cn(
          BADGE_CLASS,
          "border-warning bg-warning-subtle text-warning",
          className,
        )}
      >
        <CircleAlert aria-hidden="true" className="size-3 shrink-0" />
        {label}
      </span>
    );
  if (access === "read_only")
    return (
      <span
        data-access-badge={access}
        className={cn(
          BADGE_CLASS,
          "border-info bg-info-subtle text-info",
          className,
        )}
      >
        <Eye aria-hidden="true" className="size-3 shrink-0" />
        {label}
      </span>
    );
  return (
    <span
      data-access-badge={access}
      className={cn(
        BADGE_CLASS,
        "border-border bg-muted text-muted-foreground",
        className,
      )}
    >
      <ShieldQuestion aria-hidden="true" className="size-3 shrink-0" />
      {label}
    </span>
  );
}
