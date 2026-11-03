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
    if (node.type === "decision")
      return node.name ?? translate("plans.nodeType.decision");
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
 * The flow nodes without a number that would run agents or scripts.
 *
 * @remarks
 * Only agents, scripts and the loops that repeat them are steps; a decision,
 * stack, Start or End without a number marks no missing step.
 */
export function workGaps(
  preview: PlanSequencePreview,
  draft: AgentPlanInput,
): PlanSequencePreview["gaps"] {
  const nodes = expandPlanGroups(draft).nodes;
  return preview.gaps.filter((gap) => {
    const type = nodes.find((node) => node.id === gap.id)?.type;
    return type === "agent" || type === "script" || type === "loop";
  });
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

/** Terminal runs never retain an orange active indicator from an interrupted session. */
export function statusTone(
  step: AgentPlanStepResult,
  run: AgentPlanRun,
): string {
  if (step.isBlocked || step.status === "failed")
    return "bg-destructive text-primary-foreground hover:bg-destructive";
  // A node on a branch that was not activated never ran; it stays quiet next to the steps that did, with a muted fill that keeps its number readable.
  if (step.status === "skipped")
    return "bg-muted text-plan-muted-foreground hover:bg-muted";
  if (hasOpenPlanReport(step))
    return "bg-warning-subtle text-warning hover:bg-warning-subtle";
  if (step.status === "succeeded")
    return "bg-plan-progress-done text-plan-progress-label hover:bg-plan-progress-done";
  if (
    step.status === "running" &&
    !isQueuedPlanStep(step) &&
    isActivePlanRun(run.status)
  )
    return "bg-primary text-plan-progress-active-label hover:bg-primary";
  return "bg-plan-progress-waiting text-foreground hover:bg-plan-progress-waiting";
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
