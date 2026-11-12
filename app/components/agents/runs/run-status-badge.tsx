import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

const STATUS_TONES: Readonly<Record<string, string>> = {
  running: "bg-info-subtle text-info",
  pausing: "bg-warning-subtle text-warning",
  paused: "bg-warning-subtle text-warning",
  stopping: "bg-warning-subtle text-warning",
  succeeded: "bg-success-subtle text-success",
  failed: "bg-destructive-subtle text-destructive",
  cancelled: "bg-muted text-muted-foreground",
  work_done_closeout_open: "bg-warning-subtle text-warning",
};

/** The status of a run or step as a small label. */
export function RunStatusBadge({
  status,
}: {
  readonly status: string;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium",
        STATUS_TONES[status] ?? "bg-muted text-muted-foreground",
      )}
    >
      {t(`runDiagnosis.status.${status}`, { defaultValue: status })}
    </span>
  );
}
