import { Plus, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { SegmentedControl } from "@/app/components/ui/segmented-control";

import type { PlanView } from "@/app/lib/phase-plan/plan-types";

interface PlanToolbarProps {
  readonly view: PlanView;
  readonly canWrite: boolean;
  readonly onViewChange: (view: PlanView) => void;
  readonly onReset: () => void;
  readonly onAdd: () => void;
}

/** Renders the view switch, the reset button and the add button of the plan. */
export function PlanToolbar({
  view,
  canWrite,
  onViewChange,
  onReset,
  onAdd,
}: PlanToolbarProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2.5">
      <SegmentedControl
        value={view}
        onValueChange={onViewChange}
        ariaLabel={t("projectDetail.planning.phasePlan.title")}
        options={[
          {
            value: "weeks",
            label: t("projectDetail.planning.phasePlan.weeks"),
          },
          {
            value: "months",
            label: t("projectDetail.planning.phasePlan.months"),
          },
          {
            value: "quarter",
            label: t("projectDetail.planning.phasePlan.quarter"),
          },
        ]}
      />
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          className="h-9 shrink-0 px-3 text-sm"
          type="button"
          onClick={onReset}
        >
          <RotateCcw className="size-4" aria-hidden="true" />
          {t("projectDetail.planning.phasePlan.reset")}
        </Button>
        {canWrite ? (
          <Button
            className="h-9 shrink-0 px-3 text-sm"
            type="button"
            onClick={onAdd}
          >
            <Plus className="size-4" aria-hidden="true" />
            {t("projectDetail.planning.phasePlan.addMilestone")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
