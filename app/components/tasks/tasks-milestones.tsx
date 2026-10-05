import { useState } from "react";
import { useTranslation } from "react-i18next";

import { MilestoneCard } from "./milestones/milestone-card";

import type { Milestone, WorkItemDetail } from "@/definition/Task";

interface TasksMilestonesProps {
  readonly milestones: readonly Milestone[];
  readonly workItems: readonly WorkItemDetail[];
  readonly onSelectTask: (key: string) => void;
  readonly onOpenTask: (key: string) => void;
}

// Task rows rendered per milestone before progressive disclosure; progress
// totals always come from the full item list.
const MILESTONE_TASK_PAGE_SIZE = 10;

/** Renders milestones as temporal checkpoints with their referenced tasks. */
export function TasksMilestones({
  milestones,
  workItems,
  onSelectTask,
  onOpenTask,
}: TasksMilestonesProps): React.ReactElement {
  const { t } = useTranslation();
  const [visibleTaskCount, setVisibleTaskCount] = useState<number>(
    MILESTONE_TASK_PAGE_SIZE,
  );

  function handleShowMore(): void {
    setVisibleTaskCount((count) => count + MILESTONE_TASK_PAGE_SIZE);
  }

  if (milestones.length === 0) {
    return (
      <p className="rounded-2xl bg-muted/40 p-10 text-center text-sm text-muted-foreground">
        {t("tasks.milestones.empty")}
      </p>
    );
  }

  return (
    <ul className="grid gap-4 lg:grid-cols-2">
      {milestones.map((milestone) => (
        <MilestoneCard
          key={milestone.id}
          milestone={milestone}
          onOpenTask={onOpenTask}
          onSelectTask={onSelectTask}
          onShowMore={handleShowMore}
          visibleTaskCount={visibleTaskCount}
          workItems={workItems}
        />
      ))}
    </ul>
  );
}
