import { useTranslation } from "react-i18next";

import { MilestoneMarkerIcon } from "@/app/components/projects/phase-plan/milestone-symbol";
import {
  getMilestoneColor,
  isArchivedMilestone,
  isPendingMilestoneId,
} from "@/app/lib/phase-plan/plan-milestones";

import type { Milestone } from "@/definition/Task";

interface PlanUndatedListProps {
  readonly milestones: readonly Milestone[];
  readonly selectedId: string | null;
  readonly onSelect: (milestone: Milestone) => void;
}

/** Renders the milestones without a date, which the timeline cannot place. */
export function PlanUndatedList({
  milestones,
  selectedId,
  onSelect,
}: PlanUndatedListProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div className="mt-4 rounded-xl border border-border/60 bg-surface p-4">
      <p className="text-xs font-semibold text-muted-foreground select-none">
        {t("projectDetail.planning.phasePlan.undated")}
      </p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {milestones.map((milestone) => (
          <li
            key={milestone.id}
            className={`flex items-center gap-2.5 rounded-lg px-2 py-1 text-sm ${
              milestone.id === selectedId ? "bg-primary-subtle" : ""
            } ${isArchivedMilestone(milestone) ? "opacity-60" : ""}`}
          >
            <MilestoneMarkerIcon
              icon={milestone.iconKey ?? null}
              color={getMilestoneColor(milestone)}
              className="size-3.5 shrink-0 text-muted-foreground"
            />
            <button
              type="button"
              disabled={isPendingMilestoneId(milestone.id)}
              className="min-w-0 flex-1 truncate text-left text-foreground outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-wait"
              onClick={() => onSelect(milestone)}
            >
              {milestone.name}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
