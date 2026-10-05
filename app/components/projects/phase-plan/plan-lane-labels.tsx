import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";

import { LANE_DOT_COLORS } from "@/app/lib/phase-plan/plan-milestones";
import { HEADER_HEIGHT } from "@/app/lib/phase-plan/plan-layout";

import type { LaneLayout } from "@/app/lib/phase-plan/plan-types";

interface PlanLaneLabelsProps {
  readonly lanes: readonly LaneLayout[];
  readonly onShift: (direction: "start" | "end") => void;
}

const SHIFT_BUTTON_CLASS =
  "flex size-7 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary";

/** Renders the shift buttons and the category label of every lane. */
export function PlanLaneLabels({
  lanes,
  onShift,
}: PlanLaneLabelsProps): React.ReactElement {
  const { t } = useTranslation();
  const earlier = t("projectDetail.planning.phasePlan.earlier");
  const later = t("projectDetail.planning.phasePlan.later");

  return (
    <div className="flex w-60 shrink-0 flex-col border-r border-border/60">
      <div
        className="flex shrink-0 items-center gap-1 border-b border-border/60 px-2"
        style={{ height: `${HEADER_HEIGHT}px` }}
      >
        <button
          type="button"
          className={SHIFT_BUTTON_CLASS}
          aria-label={earlier}
          title={earlier}
          onClick={() => onShift("start")}
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          className={SHIFT_BUTTON_CLASS}
          aria-label={later}
          title={later}
          onClick={() => onShift("end")}
        >
          <ChevronRight className="size-4" aria-hidden="true" />
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <div>
          {lanes.map((lane) => (
            <div
              key={lane.key}
              className="flex items-start gap-2.5 border-b border-border/40 px-4 py-3 last:border-b-0"
              style={{ height: `${lane.height}px` }}
            >
              <span
                className="mt-1.5 size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: LANE_DOT_COLORS[lane.key] }}
                aria-hidden="true"
              />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-foreground">
                  {t(`projectDetail.planning.phasePlan.groups.${lane.key}`)}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {t(`projectDetail.planning.phasePlan.groups.${lane.key}Sub`)}
                </span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
