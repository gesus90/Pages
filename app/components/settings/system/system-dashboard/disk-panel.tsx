import { useTranslation } from "react-i18next";

import { DashboardPanel, UsageBar } from "./dashboard-panel";
import { MISSING_VALUE, useDashboardFormat } from "./use-dashboard-format";

import type { TFunction } from "i18next";
import type { DashboardDisk } from "@/definition/SystemDashboard";

/** The name of a file system: the last part of its mount point; `/` is the system. */
function diskName(mountPoint: string, t: TFunction): string {
  if (mountPoint === "/") return t("settings.system.dashboard.disks.root");
  return mountPoint.split("/").findLast((part) => part !== "") ?? mountPoint;
}

function DiskRow({
  disk,
}: {
  readonly disk: DashboardDisk;
}): React.ReactElement {
  const { t } = useTranslation();
  const format = useDashboardFormat();
  const name = diskName(disk.mountPoint, t);
  // The share `df` shows: used against what the processes of Pages may still fill.
  const ratio = disk.isReachable
    ? disk.used / Math.max(1, disk.used + disk.free)
    : null;

  return (
    <li data-disk-reachable={disk.isReachable}>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="truncate font-semibold text-foreground">{name}</span>
        <span className="shrink-0 font-medium text-foreground tabular-nums">
          {format.percent(ratio)}
        </span>
      </div>
      <UsageBar ratio={ratio} className="mt-1.5 h-2 w-full" />
      <div className="mt-1.5 flex justify-between gap-3 text-xs text-muted-foreground tabular-nums">
        <span className="min-w-0 truncate" title={disk.mountPoint}>
          {disk.isReachable
            ? t("settings.system.dashboard.disks.path", {
                path: disk.mountPoint,
                usage: format.usage(disk.used, disk.size),
              })
            : disk.mountPoint}
        </span>
        <span className="shrink-0">
          {disk.isReachable
            ? t("settings.system.dashboard.disks.free", {
                free: format.bytes(disk.free),
              })
            : t("settings.system.dashboard.disks.unreachable")}
        </span>
      </div>
    </li>
  );
}

/**
 * The mounted drives and network shares with their use.
 *
 * @remarks
 * The list follows the mount table of the server: a newly mounted drive
 * appears with the next reading, an unmounted one disappears. A drive that
 * did not answer in time stays with an empty grey bar.
 */
export function DiskPanel({
  disks,
}: {
  readonly disks: readonly DashboardDisk[] | null;
}): React.ReactElement {
  const { t } = useTranslation();

  return (
    <DashboardPanel
      title={t("settings.system.dashboard.disks.title")}
      meta={
        disks === null
          ? MISSING_VALUE
          : t("settings.system.dashboard.disks.mounted", {
              count: disks.length,
            })
      }
    >
      <ul className="flex flex-col gap-4">
        {(disks ?? []).map((disk) => (
          <DiskRow key={disk.mountPoint} disk={disk} />
        ))}
      </ul>
    </DashboardPanel>
  );
}
