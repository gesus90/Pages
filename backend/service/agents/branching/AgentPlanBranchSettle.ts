import {
  PLAN_ACTIVATION_LIMIT,
  PLAN_EVENT_PROMPT_LIMIT,
  hasPlanBranching,
  planConditionSource,
  planEdgeKind,
  planRegion,
} from "@/definition/AgentPlanBranching";

import { AgentError } from "@/backend/error/AgentErrors";
import { logDiagnostic } from "@/backend/logging/Logger";

import { patchStep } from "../AgentPlanRunState";
import { planReadiness } from "./AgentPlanBranchEdges";
import { newPlanBranchingState } from "./AgentPlanBranchState";

import type {
  AgentPlanActivationTrigger,
  AgentPlanStepActivation,
  AgentPlanStepResult,
} from "@/definition/AgentPlan";
import type { ActivePlanRun } from "../AgentPlanRunState";
import type {
  PendingPlanEvent,
  PlanBranchingState,
} from "./AgentPlanBranchState";

const REPORT_BLOCK = /```pages-report[^\n]*\n[\s\S]*?\n```/gu;
/** The longest result a record of an earlier start keeps. */
const HISTORY_OUTPUT_LIMIT = 4_000;

/**
 * The part of a node's result that is new information for another node.
 *
 * @param output - The final answer of the node.
 * @returns The answer without its closing report; empty when nothing is left.
 */
export function eventPrompt(output: string | null): string {
  return (output ?? "").replace(REPORT_BLOCK, "").trim();
}

function branchingOf(active: ActivePlanRun): PlanBranchingState {
  active.branching ??= newPlanBranchingState();
  return active.branching;
}

function resultsOf(
  active: ActivePlanRun,
): ReadonlyMap<string, AgentPlanStepResult> {
  return new Map(active.view.steps.map((step) => [step.id, step]));
}

/** Queues the result of every node that finished a start behind an event edge, once. */
function queueEvents(active: ActivePlanRun, state: PlanBranchingState): void {
  const results = resultsOf(active);
  for (const edge of active.snapshot.plan.edges) {
    if (planEdgeKind(edge) !== "event") continue;
    const source = results.get(edge.from);
    if (source?.status !== "succeeded") continue;
    const activation = source.activation ?? 1;
    const key = `${edge.from}#${activation}>${edge.to}`;
    if (state.queued.has(key)) continue;
    state.queued.add(key);
    state.pending.push({
      targetId: edge.to,
      sourceId: edge.from,
      sourceActivation: activation,
      prompt: eventPrompt(source.output),
    });
  }
}

/**
 * Queues the results that are waiting to return, without starting anything.
 *
 * @param active - The run, under the scheduler's queue.
 *
 * @remarks
 * A run that is pausing must not lose such a result when its sender ends: the
 * pause boundary names the node it will start again once the run goes on.
 */
export function queuePlanEvents(active: ActivePlanRun): void {
  if (hasPlanBranching(active.snapshot.plan))
    queueEvents(active, branchingOf(active));
}

/** Marks a waiting node whose every incoming edge is dead: it belongs to a branch that was not taken. */
function skipDeadNode(active: ActivePlanRun): boolean {
  const results = resultsOf(active);
  const node = active.snapshot.plan.nodes.find((entry) => {
    const step = results.get(entry.id);
    return (
      step?.status === "waiting" &&
      !step.isBlocked &&
      planReadiness(active.snapshot.plan, results, entry.id) === "skip"
    );
  });
  if (!node) return false;
  patchStep(active, node.id, { status: "skipped", output: null, error: null });
  if (node.type === "loop")
    active.view = {
      ...active.view,
      loops: active.view.loops?.map((loop) =>
        loop.id === node.id ? { ...loop, status: "skipped" } : loop,
      ),
    };
  return true;
}

function decide(
  active: ActivePlanRun,
  state: PlanBranchingState,
  step: AgentPlanStepResult,
): Partial<AgentPlanStepResult> {
  const results = resultsOf(active);
  const activation = (step.activation ?? 0) + 1;
  const sourceId = planConditionSource(active.snapshot.plan, step.id);
  const source = sourceId === null ? undefined : results.get(sourceId);
  const sourceActivation = source?.activation ?? 1;
  const key = `${sourceId}#${sourceActivation}`;
  // A value is read once: the same start of the agent never decides twice.
  const isFresh = state.consumed.get(step.id) !== key;
  if (
    sourceId === null ||
    source?.status !== "succeeded" ||
    typeof source.passed !== "boolean" ||
    !isFresh
  )
    return {
      status: "failed",
      activation,
      error: "plan_decision_input_invalid",
      output: null,
    };
  state.consumed.set(step.id, key);
  return {
    status: "succeeded",
    activation,
    branch: source.passed ? "true" : "false",
    condition: {
      sourceStepId: sourceId,
      sourceActivation,
      value: source.passed,
    },
    output: null,
    error: null,
  };
}

/** Evaluates one decision whose boolean result has arrived; it then activates exactly one output. */
function evaluateDecision(
  active: ActivePlanRun,
  state: PlanBranchingState,
): boolean {
  const results = resultsOf(active);
  const node = active.snapshot.plan.nodes.find((entry) => {
    const step = results.get(entry.id);
    return (
      entry.type === "decision" &&
      step?.status === "waiting" &&
      !step.isBlocked &&
      planReadiness(active.snapshot.plan, results, entry.id) === "ready"
    );
  });
  const step = node ? results.get(node.id) : undefined;
  if (!step) return false;
  patchStep(active, step.id, decide(active, state, step));
  return true;
}

/** The record of a start that ends because the node begins another one. */
function archived(step: AgentPlanStepResult): AgentPlanStepActivation {
  const output =
    step.output !== null && step.output.length > HISTORY_OUTPUT_LIMIT
      ? `${step.output.slice(0, HISTORY_OUTPUT_LIMIT)}…`
      : step.output;
  return {
    activation: step.activation ?? 1,
    status: step.status,
    output,
    error: step.error,
    startedAt: step.session?.startedAt ?? null,
    endedAt: step.session?.endedAt ?? step.session?.turnEndedAt ?? null,
    ...(step.passed === undefined ? {} : { passed: step.passed }),
    ...(step.branch === undefined ? {} : { branch: step.branch }),
    ...(step.condition === undefined ? {} : { condition: step.condition }),
    ...(step.trigger === undefined ? {} : { trigger: step.trigger }),
  };
}

/** Whether a node has run in this run, so that its start belongs in the history; a round it was skipped in is no start. */
function hasStarted(step: AgentPlanStepResult): boolean {
  return (
    step.activation !== undefined &&
    step.status !== "waiting" &&
    step.status !== "skipped"
  );
}

function withHistory(step: AgentPlanStepResult): {
  readonly history?: readonly AgentPlanStepActivation[];
} {
  if (!hasStarted(step)) return step.history ? { history: step.history } : {};
  return { history: [...(step.history ?? []), archived(step)] };
}

/** What a node forgets of its last start so that it can wait for new results again. */
function forgotten(keepsSession: boolean): Partial<AgentPlanStepResult> {
  return {
    status: "waiting",
    isBlocked: false,
    blockedByStepId: undefined,
    failedStepId: undefined,
    cancellation: "none",
    output: null,
    error: null,
    passed: undefined,
    branch: undefined,
    condition: undefined,
    trigger: undefined,
    script: undefined,
    report: undefined,
    progress: undefined,
    ...(keepsSession ? {} : { session: undefined }),
  };
}

function eventSections(
  active: ActivePlanRun,
  batch: readonly PendingPlanEvent[],
): string {
  const results = resultsOf(active);
  return batch
    .map(
      (event) =>
        `### New information from "${results.get(event.sourceId)?.name ?? event.sourceId}"\n\n${event.prompt}`,
    )
    .join("\n\n");
}

/** The prompt problem of a batch of results, or `null` when each carries something. */
function promptProblem(
  batch: readonly PendingPlanEvent[],
  prompt: string,
): "plan_event_prompt_empty" | "plan_event_prompt_too_large" | null {
  if (batch.some((event) => event.prompt.length === 0))
    return "plan_event_prompt_empty";
  return prompt.length > PLAN_EVENT_PROMPT_LIMIT
    ? "plan_event_prompt_too_large"
    : null;
}

function triggerOf(
  batch: readonly PendingPlanEvent[],
  prompt: string,
): AgentPlanActivationTrigger {
  return {
    kind: "event",
    sources: batch.map((event) => ({
      stepId: event.sourceId,
      activation: event.sourceActivation,
    })),
    promptLength: prompt.length,
  };
}

/**
 * Whether the target and everything behind it is settled, so that a new round cannot overlap an old one.
 *
 * @remarks
 * A node of the region that has not run yet but still can, because it waits
 * for a result or is ready to start, belongs to the round that is going on:
 * the target starts again only after it, so that every sender of the round
 * is heard once.
 */
function isQuiet(
  active: ActivePlanRun,
  targetId: string,
  region: ReadonlySet<string>,
): boolean {
  const results = resultsOf(active);
  return ![targetId, ...region].some((id) => {
    const step = results.get(id);
    return (
      active.controllers.has(id) ||
      step?.status === "running" ||
      (step?.status === "waiting" &&
        !step.isBlocked &&
        planReadiness(active.snapshot.plan, results, id) !== "skip")
    );
  });
}

/** Whether a node of the round failed: the run ends with that failure instead of erasing it in a new round. */
function hasBrokenNode(
  results: ReadonlyMap<string, AgentPlanStepResult>,
  region: ReadonlySet<string>,
): boolean {
  return [...region].some((id) => {
    const step = results.get(id);
    return (
      step?.status === "failed" ||
      step?.status === "cancelled" ||
      step?.isBlocked === true
    );
  });
}

function startAgain(
  active: ActivePlanRun,
  state: PlanBranchingState,
  batch: readonly PendingPlanEvent[],
  region: ReadonlySet<string>,
): void {
  const [first] = batch;
  if (!first) return;
  const results = resultsOf(active);
  const prompt = eventSections(active, batch);
  const problem = promptProblem(batch, prompt);
  const target = results.get(first.targetId);
  if (!target) return;
  const trigger = triggerOf(batch, prompt);
  // Every node of the round starts again with it, so the busiest one sets the limit.
  const isTooOften = [target.id, ...region].some(
    (id) => (results.get(id)?.activation ?? 0) >= PLAN_ACTIVATION_LIMIT,
  );
  const error = problem ?? (isTooOften ? "plan_activation_limit" : null);
  if (error !== null) {
    patchStep(active, target.id, {
      ...withHistory(target),
      status: "failed",
      output: null,
      error,
      passed: undefined,
      branch: undefined,
      trigger,
    });
    return;
  }
  for (const id of region) {
    const step = results.get(id);
    if (!step || (step.status === "waiting" && step.activation === undefined))
      continue;
    const isRetained = active.snapshot.plan.edges.some(
      (edge) => edge.to === id && planEdgeKind(edge) === "event",
    );
    patchStep(active, id, { ...withHistory(step), ...forgotten(isRetained) });
  }
  patchStep(active, target.id, {
    ...withHistory(target),
    ...forgotten(true),
    trigger,
  });
  state.prompts.set(target.id, prompt);
  dropStaleEvents(state, new Set([target.id, ...region]));
}

/** Forgets the queued results of nodes that just forgot their start: they belong to the round that ended. */
function dropStaleEvents(
  state: PlanBranchingState,
  forgottenIds: ReadonlySet<string>,
): void {
  for (let index = state.pending.length - 1; index >= 0; index -= 1)
    if (forgottenIds.has(state.pending[index]?.sourceId ?? ""))
      state.pending.splice(index, 1);
}

/** Starts the node behind an event edge again, or settles why it cannot; returns whether anything changed. */
function applyEvent(active: ActivePlanRun, state: PlanBranchingState): boolean {
  const results = resultsOf(active);
  for (const event of state.pending) {
    const target = results.get(event.targetId);
    const region = planRegion(active.snapshot.plan.edges, event.targetId);
    const isOver =
      !target ||
      target.status === "failed" ||
      target.status === "cancelled" ||
      target.status === "skipped" ||
      target.isBlocked ||
      hasBrokenNode(results, region);
    if (isOver) {
      state.pending.splice(state.pending.indexOf(event), 1);
      return true;
    }
    if (target.status !== "succeeded") continue;
    if (!isQuiet(active, event.targetId, region)) continue;
    // Results that arrive together start the node once, with all of them.
    const batch = state.pending.filter(
      (entry) => entry.targetId === event.targetId,
    );
    for (const entry of batch)
      state.pending.splice(state.pending.indexOf(entry), 1);
    startAgain(active, state, batch, region);
    return true;
  }
  return false;
}

/**
 * Brings decisions, skipped branches and returning events up to date.
 *
 * @param active - The run, under the scheduler's queue.
 * @returns Whether the view of the run changed.
 *
 * @remarks
 * Each change is made on its own and the state is read anew afterwards, so a
 * skipped branch can release a node that waits behind it, and an evaluated
 * decision can skip the other branch, in one pass. Only a plan with a
 * decision or an event connection does anything here.
 */
export function settlePlanBranching(active: ActivePlanRun): boolean {
  if (!hasPlanBranching(active.snapshot.plan)) return false;
  const state = branchingOf(active);
  queueEvents(active, state);
  const limit =
    active.snapshot.plan.nodes.length * 4 + state.pending.length + 8;
  let changes = 0;
  while (
    changes < limit &&
    (skipDeadNode(active) ||
      evaluateDecision(active, state) ||
      applyEvent(active, state))
  )
    changes += 1;
  return changes > 0;
}

/** The prompt of the event that started the node again, while that start has not settled. */
export function pendingEventPrompt(
  active: ActivePlanRun,
  stepId: string,
): string | null {
  return active.branching?.prompts.get(stepId) ?? null;
}

/** Forgets the prompt of a start once the node has settled. */
export function settleEventPrompt(active: ActivePlanRun, stepId: string): void {
  active.branching?.prompts.delete(stepId);
}

/** Whether a result still waits to start its target, so the run is not finished. */
export function hasPendingEvents(active: ActivePlanRun): boolean {
  return (active.branching?.pending.length ?? 0) > 0;
}

/**
 * The changes of a node that is about to start, with its place among the starts.
 *
 * @param active - The run.
 * @param stepId - The node about to start.
 *
 * @remarks
 * Only a plan with a decision or an event connection counts starts; every
 * other run keeps the shape it always had.
 */
export function startedStep(
  active: ActivePlanRun,
  stepId: string,
): Partial<AgentPlanStepResult> {
  if (!hasPlanBranching(active.snapshot.plan)) return { status: "running" };
  const current = active.view.steps.find((step) => step.id === stepId);
  return { status: "running", activation: (current?.activation ?? 0) + 1 };
}

/**
 * The changes of a node whose start ended before it began, which only a pause does.
 *
 * @param active - The run.
 * @param stepId - The node whose start ended.
 * @param changes - What the start reported.
 * @returns The changes, without the count of a start that never took place.
 *
 * @remarks
 * Such a start is none: the resume starts the node again and counts that
 * start, so a pause near the limit cannot push the count beyond it.
 */
export function unstartedChanges(
  active: ActivePlanRun,
  stepId: string,
  changes: Partial<AgentPlanStepResult>,
): Partial<AgentPlanStepResult> {
  if (changes.status !== "paused" || !hasPlanBranching(active.snapshot.plan))
    return changes;
  const count =
    active.view.steps.find((step) => step.id === stepId)?.activation ?? 0;
  return { ...changes, activation: count > 1 ? count - 1 : undefined };
}

/**
 * Whether the result of a start arrives after the node began another one.
 *
 * @remarks
 * Such a late result is ignored and reported; it never replaces the result of
 * the newer start.
 */
export function isStaleStart(
  active: ActivePlanRun,
  stepId: string,
  activation: number | undefined,
): boolean {
  if (activation === undefined) return false;
  const isStale =
    active.view.steps.find((step) => step.id === stepId)?.activation !==
    activation;
  if (isStale)
    logDiagnostic(
      "AgentPlanRunEngine",
      "warn",
      "Pages ignored the late result of an earlier start of a node.",
    );
  return isStale;
}

/**
 * What a node learns about the event that started it again, for the step runner.
 *
 * @throws {AgentError} `plan_event_prompt_empty` when the node was started by
 * an event whose news is no longer known.
 */
export function eventStart(
  active: ActivePlanRun,
  stepId: string,
): {
  readonly event?: {
    readonly prompt: string;
    readonly activation: number;
    readonly sourceStepIds: readonly string[];
  };
} {
  const prompt = pendingEventPrompt(active, stepId);
  const step = active.view.steps.find((entry) => entry.id === stepId);
  if (step?.trigger === undefined) return {};
  // The news that started the node is gone: a start without it would replay the main instruction.
  if (prompt === null) throw new AgentError("plan_event_prompt_empty");
  return {
    event: {
      prompt,
      activation: step.activation ?? 1,
      sourceStepIds: step.trigger.sources.map((source) => source.stepId),
    },
  };
}
