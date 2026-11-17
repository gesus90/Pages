import { useTranslation } from "react-i18next";

import { allPlanRunResults } from "@/definition/AgentPlanLoopResults";

import { useRegionFormatter } from "@/app/components/common/region-provider";

import { showsPass } from "./plan-status-sequence";

import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { PlanStepSequence } from "./plan-step-sequence";
import type { PlanWorkspaceWait } from "./plan-workspace-wait-model";

interface PlanStatusNowProps {
  readonly run: AgentPlanRun | null;
  readonly sequence: PlanStepSequence;
  readonly workspaceWait: PlanWorkspaceWait | null | undefined;
}

/** The newest time a session of the run reported activity; `null` while none did. */
function lastActivityAt(run: AgentPlanRun): string | null {
  const reported = allPlanRunResults(run)
    .map((step) => step.session?.activity?.reportedAt)
    .filter((time): time is string => typeof time === "string")
    .sort();
  return reported.at(-1) ?? null;
}

/**
 * Names what an active run does now, apart from its stored status: the current
 * step with its loop iteration, the executions that completed, and the last activity.
 * @remarks
 * A run that waits for its workspace has no work to name; its indicator says so.
 * The total of loop iterations stays an estimate in the counter, so this line
 * names only what the run recorded.
 */
export function PlanStatusNow({
  run,
  sequence,
  workspaceWait,
}: PlanStatusNowProps): React.ReactElement | null {
  const { t } = useTranslation();
  const { formatDateTime } = useRegionFormatter();
  if (!run || workspaceWait) return null;
  if (run.status !== "running" && run.status !== "pausing") return null;
  const block = sequence.blocks.find(
    (entry) => entry.key === sequence.anchorKey,
  );
  const step =
    block?.kind === "actual" ? block.name : t("plans.progress.now.noStep");
  const activityAt = lastActivityAt(run);
  const pass =
    block && showsPass(block, sequence.blocks)
      ? ` · ${t("plans.progress.pass", { pass: block.pass })}`
      : "";
  return (
    <p
      role="status"
      className="border-t border-border bg-muted/50 px-3 py-2 text-xs wrap-anywhere text-muted-foreground"
    >
      {t("plans.progress.now.line", {
        step: `${step}${pass}`,
        completed: sequence.completed,
        activity: activityAt
          ? formatDateTime(activityAt)
          : t("plans.progress.notReported"),
      })}
    </p>
  );
}
