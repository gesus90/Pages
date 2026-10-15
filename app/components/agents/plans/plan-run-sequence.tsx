import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { HorizontalScrollArea } from "@/app/components/ui/horizontal-scroll-area";
import { cn } from "@/app/lib/cn";

import { PlanRunStepDetails } from "./plan-run-step-details";
import { PlanStatusIcon, planStatusClass } from "./plan-status";

import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";

/** Excludes group summaries and checkpoints; child agents retain the recorded run order. */
export function planRunAgents(
  run: AgentPlanRun,
): readonly AgentPlanStepResult[] {
  const groups = new Set(run.steps.map((step) => step.groupId).filter(Boolean));
  return run.steps.filter(
    (step) =>
      !groups.has(step.id) &&
      (Boolean(step.session) ||
        Boolean(step.groupId) ||
        (step.name !== "start" && step.name !== "end")),
  );
}

function SequenceEndpoint({
  run,
  type,
}: {
  readonly run: AgentPlanRun;
  readonly type: "start" | "end";
}): React.ReactElement {
  const { t } = useTranslation();
  const checkpoints = run.steps.filter(
    (step) => step.name === type && !step.session && !step.groupId,
  );
  const status =
    checkpoints.length > 0 &&
    checkpoints.every((step) => step.status === "succeeded")
      ? "succeeded"
      : "waiting";
  return (
    <li className="flex shrink-0 items-center gap-3">
      {type === "end" ? (
        <ArrowRight
          className="size-4 text-muted-foreground"
          aria-hidden="true"
        />
      ) : null}
      <span
        className={cn(
          "relative flex size-12 items-center justify-center rounded-full border text-xs font-medium",
          planStatusClass(status),
        )}
        title={t(`plans.status.${status}`)}
      >
        {t(`plans.nodeType.${type}`)}
        <span className="sr-only"> · {t(`plans.status.${status}`)}</span>
      </span>
    </li>
  );
}

/** One horizontal row of selectable agents, followed by just the selected agent's details. */
export function PlanRunSequence({
  run,
}: {
  readonly run: AgentPlanRun;
}): React.ReactElement {
  const { t } = useTranslation();
  const agents = planRunAgents(run);
  const [selectedId, select] = useState<string | null>(null);
  const selected =
    agents.find((step) => step.id === selectedId) ??
    agents.find((step) => step.status === "running") ??
    agents[0];
  return (
    <div className="min-w-0 space-y-4">
      <p className="text-xs text-muted-foreground">{t("plans.sequenceHint")}</p>
      <HorizontalScrollArea contentClassName="py-2 px-1">
        <ol
          className="flex min-w-max items-center gap-3"
          aria-label={t("plans.sequence")}
        >
          <SequenceEndpoint run={run} type="start" />
          {agents.map((step, index) => (
            <li key={step.id} className="flex shrink-0 items-center gap-3">
              <ArrowRight
                className="size-4 text-muted-foreground"
                aria-hidden="true"
              />
              <button
                type="button"
                aria-pressed={selected?.id === step.id}
                aria-controls="plan-step-details"
                onClick={() => select(step.id)}
                className={cn(
                  "flex w-44 items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm",
                  planStatusClass(step.status),
                  selected?.id === step.id &&
                    "ring-2 ring-info ring-offset-2 ring-offset-surface",
                )}
              >
                <PlanStatusIcon status={step.status} />
                <span className="min-w-0">
                  <span
                    className="block truncate font-medium"
                    title={step.name}
                  >
                    {index + 1}. {step.name}
                  </span>
                  <span className="block truncate text-xs">
                    {t(
                      step.isBlocked
                        ? "plans.blocked"
                        : `plans.status.${step.status}`,
                    )}
                  </span>
                </span>
              </button>
            </li>
          ))}
          <SequenceEndpoint run={run} type="end" />
        </ol>
      </HorizontalScrollArea>
      {selected ? (
        <PlanRunStepDetails key={selected.id} run={run} step={selected} />
      ) : null}
    </div>
  );
}
