import { isActivePlanRun } from "@/definition/AgentPlanRunState";
import { expandPlanGroups } from "@/definition/AgentPlanGroup";
import {
  inPlanSequence,
  planRunSequence,
} from "@/definition/AgentPlanSequence";

import { planNodeLabel } from "./plan-layout";
import { hasOpenPlanReport, isQueuedPlanStep } from "./plan-status";

import type { TFunction } from "i18next";
import type {
  AgentPlanInput,
  AgentPlanNode,
  AgentPlanRun,
  AgentPlanSources,
  AgentPlanStepResult,
} from "@/definition/AgentPlan";
import type { AgentPlanSequenceGap } from "@/definition/AgentPlanSequence";

/** The numbered steps of a plan before it runs, and the flow nodes without a number. */
export interface PlanSequencePreview {
  readonly steps: readonly { readonly id: string; readonly name: string }[];
  readonly gaps: readonly {
    readonly id: string;
    readonly name: string;
    readonly reason: AgentPlanSequenceGap;
  }[];
}

/**
 * Numbers the draft's flow nodes along its flow edges, as a run would.
 *
 * @remarks
 * A preview only: it synthesizes no run and no execution evidence.
 */
export function planSequencePreview(
  draft: AgentPlanInput,
  sources: AgentPlanSources,
  translate: TFunction,
): PlanSequencePreview {
  const nodes = expandPlanGroups(draft).nodes;
  const sequence = planRunSequence(draft);
  function name(id: string): string {
    const node: AgentPlanNode | undefined = nodes.find(
      (entry) => entry.id === id,
    );
    if (!node) return id;
    return node.type === "start" || node.type === "end"
      ? translate(`plans.nodeType.${node.type}`)
      : planNodeLabel(node, sources);
  }
  return {
    steps: sequence.order.map((id) => ({ id, name: name(id) })),
    gaps: sequence.gaps.map((gap) => ({ ...gap, name: name(gap.id) })),
  };
}

/**
 * A run recorded before its steps followed the flow edges, ordered like a new one.
 *
 * @remarks
 * Only the saved revision the run executed may order it; a run of another
 * revision keeps its stored order, because its graph is not known here.
 */
export function sequencedRun(
  run: AgentPlanRun | null,
  saved: (AgentPlanInput & { readonly revision: number }) | null,
): AgentPlanRun | null {
  const revision = run?.continuation?.planRevision ?? run?.planRevision;
  if (!run || !saved || saved.revision !== revision) return run;
  const steps = inPlanSequence(run.steps, planRunSequence(saved).order);
  return steps.every((step, index) => step === run.steps[index])
    ? run
    : { ...run, steps };
}

/** Counts the executed revision's flow steps once, omitting derived group summaries. */
export function statusSteps(
  run: AgentPlanRun | null,
): readonly AgentPlanStepResult[] {
  const groups = new Set(
    run?.steps.flatMap((step) => (step.groupId ? [step.groupId] : [])),
  );
  return run?.steps.filter((step) => !groups.has(step.id)) ?? [];
}

/** Uses the first active frontier member in persisted order, then the recorded pause frontier. */
export function statusAnchor(
  run: AgentPlanRun | null,
  steps: readonly AgentPlanStepResult[],
): string | null {
  if (!run) return null;
  if (isActivePlanRun(run.status)) {
    return (
      steps.find((step) => step.status === "running")?.id ??
      steps.find((step) => run.pauseBoundary?.frontierStepIds.includes(step.id))
        ?.id ??
      steps.find(
        (step) =>
          step.isBlocked ||
          step.status === "paused" ||
          step.status === "waiting",
      )?.id ??
      steps.at(-1)?.id ??
      null
    );
  }
  return steps.at(-1)?.id ?? null;
}

/** Terminal runs never retain an orange active indicator from an interrupted session. */
export function statusTone(
  step: AgentPlanStepResult,
  run: AgentPlanRun,
): string {
  if (step.isBlocked || step.status === "failed")
    return "bg-destructive text-primary-foreground hover:bg-destructive";
  if (hasOpenPlanReport(step))
    return "bg-warning-subtle text-warning hover:bg-warning-subtle";
  if (step.status === "succeeded")
    return "bg-plan-progress-done bg-linear-to-br from-plan-progress-shade/50 to-plan-progress-shade/35 text-plan-progress-label hover:bg-plan-progress-done";
  if (
    step.status === "running" &&
    !isQueuedPlanStep(step) &&
    isActivePlanRun(run.status)
  )
    return "bg-primary text-plan-progress-active-label hover:bg-primary";
  return "bg-plan-progress-waiting bg-linear-to-br from-plan-progress-surface/10 to-plan-progress-surface/25 text-foreground hover:bg-plan-progress-waiting";
}

/** Formats measured wall time, including pauses, without estimating a finish. */
export function elapsedTime(
  start: string | null | undefined,
  end: string | null | undefined,
): string {
  if (!start || !end) return "—";
  const seconds = Math.floor((Date.parse(end) - Date.parse(start)) / 1000);
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const minutes = Math.floor(seconds / 60);
  const remainder = `${String(minutes % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  return seconds < 3600
    ? remainder
    : `${Math.floor(seconds / 3600)}:${remainder}`;
}
