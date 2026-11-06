import { CloudOff, LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useRegionFormatter } from "@/app/components/common/region-provider";
import { cn } from "@/app/lib/cn";

import type { LocalStateMark } from "@/app/lib/local-state/local-state-loader";

/**
 * Tells that the plan shows the browser's last known state, and why.
 *
 * @remarks
 * While the server's answer is pending the notice says it updates; while
 * the backend is unreachable it says so as an alert. Nothing shows for a
 * current answer.
 */
export function PlanLocalStateNotice({
  mark,
}: {
  readonly mark?: LocalStateMark;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const { formatDateTime } = useRegionFormatter();
  if (!mark) return null;
  const isOffline = mark.state === "offline";
  const Icon = isOffline ? CloudOff : LoaderCircle;
  return (
    <p
      role={isOffline ? "alert" : "status"}
      data-local-state={mark.state}
      className={cn(
        "pointer-events-auto flex max-w-[min(36rem,calc(100vw-2rem))] items-center gap-2 rounded-lg border px-3 py-2 text-sm shadow-xs",
        isOffline
          ? "border-warning/40 bg-warning-subtle text-warning"
          : "border-border bg-surface text-muted-foreground",
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn("size-4 shrink-0", !isOffline && "animate-spin")}
      />
      {t(`plans.localState.${mark.state}`, {
        time: formatDateTime(new Date(mark.savedAt).toISOString()),
      })}
    </p>
  );
}
