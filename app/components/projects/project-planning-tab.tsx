import { PhaseMilestonePlan } from "@/app/components/projects/phase-milestone-plan";

import type { Milestone, MilestoneDependency } from "@/definition/Task";

interface ProjectPlanningTabProps {
  readonly milestones: readonly Milestone[];
  readonly milestoneLinks: readonly MilestoneDependency[];
  readonly canWrite: boolean;
}

/** Renders the milestone timeline of the project planning. */
export function ProjectPlanningTab({
  milestones,
  milestoneLinks,
  canWrite,
}: ProjectPlanningTabProps): React.ReactElement {
  return (
    <PhaseMilestonePlan
      milestones={milestones}
      milestoneLinks={milestoneLinks}
      canWrite={canWrite}
    />
  );
}
