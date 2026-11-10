import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { readLoadRatios } from "./load-level";
import { LoadTile } from "./load-tile";
import { MISSING_VALUE, useDashboardFormat } from "./use-dashboard-format";

import type { TFunction } from "i18next";
import type { SystemDashboard } from "@/definition/SystemDashboard";
import type { LoadHistory } from "./load-history";
import type { LoadTileKey } from "./load-level";
import type { DashboardFormat } from "./use-dashboard-format";

/** The two lines of details of one tile. */
interface TileDetails {
  readonly detail: string | null;
  readonly secondDetail: string | null;
}

const NO_RATIOS: Readonly<Record<LoadTileKey, number | null>> = {
  processor: null,
  memory: null,
  swap: null,
  agents: null,
};

const WAITING: TileDetails = { detail: MISSING_VALUE, secondDetail: null };

function processorDetails(
  { processor }: SystemDashboard,
  format: DashboardFormat,
  t: TFunction,
): TileDetails {
  const { load, cores, temperature } = processor;
  return {
    detail:
      load === null
        ? t("settings.system.dashboard.processor.cores", { count: cores })
        : t("settings.system.dashboard.processor.load", {
            load: format.decimal(load, 2),
            count: cores,
          }),
    secondDetail: temperature === null ? null : format.celsius(temperature),
  };
}

function memoryDetails(
  { memory }: SystemDashboard,
  format: DashboardFormat,
  t: TFunction,
): TileDetails {
  if (memory === null) return WAITING;
  return {
    detail: t("settings.system.dashboard.memory.used", {
      used: format.gigabytes(memory.total - memory.available),
      total: format.gigabytes(memory.total),
    }),
    secondDetail: t("settings.system.dashboard.memory.available", {
      available: format.gigabytes(memory.available),
    }),
  };
}

function swapDetails(
  { swap }: SystemDashboard,
  format: DashboardFormat,
  t: TFunction,
): TileDetails {
  if (swap === null) return WAITING;
  const activity = swap.isSwapping ? "swapping" : "idle";
  return {
    detail: format.usage(swap.used, swap.total),
    secondDetail:
      swap.isSwapping === null
        ? null
        : t(`settings.system.dashboard.swap.${activity}`),
  };
}

function agentDetails(
  { agents }: SystemDashboard,
  format: DashboardFormat,
  t: TFunction,
): TileDetails {
  if (agents === null) return WAITING;
  return {
    detail:
      agents.maximum === 0
        ? t("settings.system.dashboard.agents.unlimited")
        : t("settings.system.dashboard.agents.of", {
            maximum: agents.maximum,
          }),
    secondDetail:
      agents.memory === null
        ? MISSING_VALUE
        : t("settings.system.dashboard.agents.memory", {
            memory: format.bytes(agents.memory),
          }),
  };
}

interface LoadTilesProps {
  readonly dashboard: SystemDashboard | null;
  readonly history: LoadHistory;
  /** When the last measurement arrived; the curves end there. */
  readonly end: number | null;
}

/**
 * The tiles of the load section: processor, memory, swap and active agents.
 *
 * @remarks
 * Four in a row where the card is wide, two on a tablet and one on a phone.
 * Without swap space the swap tile is left out.
 */
export function LoadTiles({
  dashboard,
  history,
  end,
}: LoadTilesProps): React.ReactElement {
  const { t } = useTranslation();
  const format = useDashboardFormat();
  const ratios = dashboard ? readLoadRatios(dashboard) : NO_RATIOS;
  const hasSwap = dashboard === null || dashboard.swap !== null;
  function details(
    read: (
      measured: SystemDashboard,
      dashboardFormat: DashboardFormat,
      translate: TFunction,
    ) => TileDetails,
  ): TileDetails {
    return dashboard ? read(dashboard, format, t) : WAITING;
  }
  const agentCount = dashboard?.agents?.active;

  return (
    <div
      className={cn(
        "grid gap-3 @min-[34rem]:grid-cols-2",
        hasSwap ? "@min-[60rem]:grid-cols-4" : "@min-[60rem]:grid-cols-3",
      )}
    >
      <LoadTile
        name={t("settings.system.dashboard.processor.name")}
        value={format.percent(ratios.processor)}
        ratio={ratios.processor}
        {...details(processorDetails)}
        samples={history.processor}
        end={end}
      />
      <LoadTile
        name={t("settings.system.dashboard.memory.name")}
        value={format.percent(ratios.memory)}
        ratio={ratios.memory}
        {...details(memoryDetails)}
        samples={history.memory}
        end={end}
      />
      {hasSwap ? (
        <LoadTile
          name={t("settings.system.dashboard.swap.name")}
          value={format.percent(ratios.swap)}
          ratio={ratios.swap}
          {...details(swapDetails)}
          samples={history.swap}
          end={end}
        />
      ) : null}
      <LoadTile
        name={t("settings.system.dashboard.agents.name")}
        value={
          agentCount === undefined
            ? MISSING_VALUE
            : format.decimal(agentCount, 0)
        }
        ratio={ratios.agents}
        {...details(agentDetails)}
        samples={history.agents}
        end={end}
      />
    </div>
  );
}
