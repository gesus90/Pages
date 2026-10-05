import { ChartColumn } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  countOpenSubtasks,
  getMilestoneCompletion,
  getTaskCompletion,
} from "@/app/components/projects/project-progress";

import type { Milestone, WorkItemDetail } from "@/definition/Task";

interface ProgressRingProps {
  readonly percentage: number;
}

const RING_RADIUS = 40;

/** Renders the task completion as a ring with a centered percentage. */
function ProgressRing({ percentage }: ProgressRingProps): React.ReactElement {
  const circumference = 2 * Math.PI * RING_RADIUS;
  const clamped = Math.min(100, Math.max(0, percentage));

  return (
    <div
      className="relative size-[88px] shrink-0"
      role="img"
      aria-label={`${clamped} %`}
    >
      <svg
        viewBox="0 0 88 88"
        className="size-full -rotate-90"
        aria-hidden="true"
      >
        <circle
          cx="44"
          cy="44"
          r={RING_RADIUS}
          fill="none"
          strokeWidth="8"
          className="stroke-muted"
        />
        <circle
          cx="44"
          cy="44"
          r={RING_RADIUS}
          fill="none"
          strokeWidth="8"
          strokeLinecap="round"
          className="stroke-primary"
          strokeDasharray={circumference}
          strokeDashoffset={circumference - (clamped / 100) * circumference}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-lg font-bold text-foreground">
        {clamped} %
      </span>
    </div>
  );
}

interface ProgressRowProps {
  readonly label: string;
  readonly value: string;
}

function ProgressRow({ label, value }: ProgressRowProps): React.ReactElement {
  return (
    <div className="flex items-center justify-between gap-3  pt-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium text-foreground">{value}</dd>
    </div>
  );
}

interface GeneralProgressSectionProps {
  readonly workItems: readonly WorkItemDetail[];
  readonly milestones: readonly Milestone[];
}

/** Renders the task ring and the done counters of tasks, milestones and subtasks. */
export function GeneralProgressSection({
  workItems,
  milestones,
}: GeneralProgressSectionProps): React.ReactElement {
  const { t } = useTranslation();
  const taskCompletion = getTaskCompletion(workItems);
  const milestoneCompletion = getMilestoneCompletion(milestones);

  return (
    <section className="rounded-2xl bg-muted/40 p-6">
      <h2 className="flex select-none items-center gap-2 font-semibold text-foreground">
        <ChartColumn className="size-5 text-primary" aria-hidden="true" />
        {t("projectDetail.general.progress")}
      </h2>
      <div className="mt-4 flex items-center gap-5">
        <ProgressRing percentage={taskCompletion.percentage} />
        <p className="min-w-0 text-sm leading-relaxed text-muted-foreground">
          {t("projectDetail.general.progressHint")}
        </p>
      </div>
      <dl className="mt-4 flex flex-col gap-2 text-sm">
        <ProgressRow
          label={t("projectDetail.general.tasksDone")}
          value={`${taskCompletion.done} / ${taskCompletion.total}`}
        />
        <ProgressRow
          label={t("projectDetail.general.milestonesDone")}
          value={`${milestoneCompletion.done} / ${milestoneCompletion.total}`}
        />
        <ProgressRow
          label={t("projectDetail.general.openSubtasks")}
          value={String(countOpenSubtasks(workItems))}
        />
      </dl>
    </section>
  );
}
