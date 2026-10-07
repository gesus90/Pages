import { Laptop, MoreHorizontal, Smartphone } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useRegionFormatter } from "@/app/components/common/region-provider";
import { Button } from "@/app/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";

import { parseInstant } from "@/app/lib/region-format";

import type { RegionFormatter } from "@/app/components/common/region-provider";
import type { SessionSummary } from "@/definition/Session";
import type { TFunction } from "i18next";

/** Formats the last activity of a session: how long ago, or the date of an older use. */
function formatSessionActivity(
  value: string,
  translate: TFunction,
  formatDateTime: RegionFormatter["formatDateTime"],
  now: Date,
): string {
  const date = parseInstant(value);
  const minutes = date
    ? Math.floor((now.getTime() - date.getTime()) / 60000)
    : 0;

  if (minutes < 1) {
    return translate("settings.security.sessions.activity.now");
  }

  if (minutes < 60) {
    return translate("settings.security.sessions.activity.minutesAgo", {
      count: minutes,
    });
  }

  if (minutes < 60 * 24) {
    return translate("settings.security.sessions.activity.hoursAgo", {
      count: Math.floor(minutes / 60),
    });
  }

  return formatDateTime(value);
}

/** One signed-in session with its device, last use and the way to revoke it. */
export function SessionRow({
  session,
  onRevoke,
}: {
  readonly session: SessionSummary;
  readonly onRevoke: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { formatDateTime } = useRegionFormatter();
  const deviceLabel = [session.browser, session.operatingSystem]
    .filter((part): part is string => part !== null)
    .join(" · ");
  const isMobileDevice =
    session.operatingSystem === "iOS" || session.operatingSystem === "Android";

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-border/60 bg-card p-3">
      <div className="flex min-w-0 items-center gap-3">
        <span
          className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
          aria-hidden="true"
        >
          {isMobileDevice ? (
            <Smartphone className="size-4" aria-hidden="true" />
          ) : (
            <Laptop className="size-4" aria-hidden="true" />
          )}
        </span>
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
            <span className="truncate">
              {deviceLabel || t("settings.security.sessions.unknownDevice")}
            </span>
            {session.isCurrent ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                <span
                  className="size-1.5 rounded-full bg-emerald-500"
                  aria-hidden="true"
                />
                {t("settings.security.sessions.current")}
              </span>
            ) : null}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {session.isCurrent
              ? t("settings.security.sessions.activity.now")
              : formatSessionActivity(
                  session.lastUsedAt,
                  t,
                  formatDateTime,
                  new Date(),
                )}
          </p>
        </div>
      </div>

      {!session.isCurrent ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label={t("settings.security.sessions.menu")}
              className="size-8 min-h-0 p-0"
              variant="ghost"
            >
              <MoreHorizontal className="size-4" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              className="text-destructive data-highlighted:bg-destructive/10 data-highlighted:text-destructive"
              onSelect={onRevoke}
            >
              {t("settings.security.sessions.revoke")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
