import { isPlanLoopLeftRegularly } from "./AgentPlanLoopRun";
import { planLoopMembers } from "./AgentPlanLoop";
import { planStackScope } from "./AgentPlanStack";
import { planBindingNodes } from "./AgentPlanStackGraph";

import type {
  AgentPlanInput,
  AgentPlanRun,
  AgentPlanStepResult,
} from "./AgentPlan";
import type { AgentPlanGroup } from "./AgentPlanGroup";
import type { AgentPlanLoopRun } from "./AgentPlanLoopRun";

/**
 * How the processing of what a stack handed over stands in a run.
 *
 * @remarks
 * A dimension of its own beside the handovers and the stack's trigger
 * result: a trigger succeeds as soon as it handed an entry over, and a
 * used-up stack succeeds as well. `none` covers an empty stack, one that
 * was never triggered and one whose entries no participant processed, for
 * example on a branch a decision did not activate. `open` is a processing
 * whose participants completed while a business report stayed open.
 */
export type AgentPlanStackOutcome =
  "none" | "processing" | "succeeded" | "open" | "failed";

/** What one participant did with one handed-over entry. */
type ParticipantState = "processed" | "skipped" | "pending" | "open" | "failed";

type RunView = Pick<AgentPlanRun, "status" | "steps" | "loops" | "stacks">;

const TERMINAL_RUN_STATUSES: ReadonlySet<AgentPlanRun["status"]> = new Set([
  "succeeded",
  "failed",
  "cancelled",
  "work_done_closeout_open",
]);

/**
 * Whether a node completed its process while its recorded business report stays open or was rejected.
 *
 * @remarks
 * A succeeded process alone is no proof of the business result.
 */
export function hasOpenPlanStepReport(
  step: AgentPlanStepResult | undefined,
): boolean {
  const verdict = step?.session?.acceptance?.verdict;
  return (
    step?.status === "succeeded" &&
    (verdict === "open" ||
      verdict === "rejected" ||
      (step.report !== undefined && step.report.status !== "passed"))
  );
}

/** The groups of a plan, those inside a loop included. */
function planGroups(
  plan: Pick<AgentPlanInput, "nodes">,
): readonly AgentPlanGroup[] {
  return plan.nodes.flatMap((node): readonly AgentPlanGroup[] => {
    if (node.type === "group") return [node];
    if (node.type !== "loop") return [];
    return node.steps.filter((member) => member.type === "group");
  });
}

/**
 * The nodes that process what the stack hands over.
 *
 * @remarks
 * Those its trigger starts through `flow-out`, with the agents of a group
 * there, and those that read its content output. Nodes further down the
 * flow are no participants: the stack does not wait for the rest of the plan.
 */
export function planStackParticipants(
  plan: Pick<AgentPlanInput, "nodes" | "edges">,
  stackId: string,
): readonly string[] {
  const started = plan.edges
    .filter((edge) => edge.from === stackId && edge.fromPort === "flow-out")
    .flatMap((edge) => {
      const group = planGroups(plan).find((node) => node.id === edge.to);
      return group ? group.steps.map((step) => step.id) : [edge.to];
    });
  const readers = planBindingNodes(plan)
    .filter(
      (node) =>
        node.type !== "loop" &&
        Object.values(node.bindings).some(
          (binding) =>
            binding.kind === "stack" &&
            binding.stackId === stackId &&
            binding.output === "content",
        ),
    )
    .map((node) => node.id);
  return [...new Set([...started, ...readers])];
}

function participantState(
  result: AgentPlanStepResult | undefined,
): ParticipantState {
  if (!result) return "pending";
  if (result.isBlocked) return "failed";
  if (result.status === "succeeded")
    return hasOpenPlanStepReport(result) ? "open" : "processed";
  if (result.status === "skipped") return "skipped";
  if (result.status === "failed" || result.status === "cancelled")
    return "failed";
  return "pending";
}

/** A loop processes an entry only once the whole loop was left regularly. */
function outerParticipantState(run: RunView, nodeId: string): ParticipantState {
  const state = participantState(run.steps.find((step) => step.id === nodeId));
  const loop = run.loops?.find((record) => record.id === nodeId);
  if (!loop || state !== "processed") return state;
  return isPlanLoopLeftRegularly(loop) ? "processed" : "pending";
}

function outerStates(
  run: RunView,
  participants: readonly string[],
  loopMembers: ReadonlySet<string>,
): readonly ParticipantState[] {
  return participants
    .filter((id) => !loopMembers.has(id))
    .map((id) => outerParticipantState(run, id));
}

/**
 * The states of the participants in each iteration that received an entry, and of the loop itself.
 *
 * @remarks
 * A delivery names its iteration, so a result of another iteration never
 * counts. Until the loop was left regularly, the processing is not complete.
 */
function loopStates(
  record: AgentPlanLoopRun | undefined,
  run: RunView,
  stackId: string,
  participants: readonly string[],
): readonly ParticipantState[] {
  const deliveries =
    run.stacks
      ?.find((entry) => entry.id === stackId)
      ?.deliveries.filter((delivery) => delivery.loopId === record?.id) ?? [];
  const states = deliveries.flatMap((delivery) => {
    const iteration = record?.iterations.find(
      (candidate) => candidate.number === delivery.iteration,
    );
    return participants.map((id) =>
      participantState(iteration?.nodes.find((node) => node.id === id)),
    );
  });
  if (isPlanLoopLeftRegularly(record)) return states;
  const isLoopOpen =
    !record ||
    ["waiting", "running", "paused"].includes(record.status) ||
    (record.status === "succeeded" && record.cleanup === "pending");
  return [...states, isLoopOpen ? "pending" : "failed"];
}

function combinedOutcome(
  states: readonly ParticipantState[],
  isRunOver: boolean,
): AgentPlanStackOutcome {
  if (states.includes("failed")) return "failed";
  if (states.includes("pending")) return isRunOver ? "failed" : "processing";
  if (states.includes("open")) return "open";
  return states.includes("processed") ? "succeeded" : "none";
}

/**
 * How the processing of the entries a stack handed over stands in the shown run.
 *
 * @param plan - The plan the run executes.
 * @param run - The shown run, or `null`.
 * @param stackId - The stack.
 * @returns `succeeded` only when the processing the plan intends is complete
 * and every participant that processed an entry succeeded without an open
 * report: in the outer graph once its participants ended, in a loop once the
 * whole loop was left regularly.
 *
 * @remarks
 * Derived from the persisted run alone, so a reload shows the same state and
 * a new run, without deliveries, starts at `none`. Neither the handover of
 * the last entry, a used-up stack nor the trigger result is evidence of
 * success; a stack whose entries nothing processed stays `none`.
 */
export function planStackOutcome(
  plan: Pick<AgentPlanInput, "nodes" | "edges">,
  run: RunView | null,
  stackId: string,
): AgentPlanStackOutcome {
  const record = run?.stacks?.find((entry) => entry.id === stackId);
  if (!run || !record || record.deliveries.length === 0) return "none";
  const scope = planStackScope(plan, stackId);
  if (scope.kind === "mixed") return "none";
  const participants = planStackParticipants(plan, stackId);
  const loops = plan.nodes.filter((node) => node.type === "loop");
  const loopMembers = new Set(
    loops.flatMap((loop) => planLoopMembers(loop).map((member) => member.id)),
  );
  const loop =
    scope.kind === "loop"
      ? loops.find((candidate) => candidate.id === scope.loopId)
      : undefined;
  const loopOwn = new Set(
    loop ? planLoopMembers(loop).map((member) => member.id) : [],
  );
  const states = loop
    ? loopStates(
        run.loops?.find((entry) => entry.id === loop.id),
        run,
        stackId,
        participants.filter((id) => loopOwn.has(id)),
      )
    : outerStates(run, participants, loopMembers);
  return combinedOutcome(states, TERMINAL_RUN_STATUSES.has(run.status));
}
