import { summarizePlanRun } from "@/backend/service/agents/AgentPlanOverview";
import { inPlanSequence } from "@/definition/AgentPlanSequence";
import { PICA_MOBILE_MAXIMUM_FLOW_ITERATIONS } from "@/definition/PicaMobileProtocol";

import { toPicaMobileFlowStatus } from "../PicaMobileRunMapping";
import { truncatePlanText } from "./PicaMobilePlanRows";

import type { AgentPlanActiveRun } from "@/backend/service/agents/AgentPlanActiveRuns";
import type {
  AgentPlanStructureKind,
  AgentPlanStructureNode,
} from "@/backend/service/agents/AgentPlanRunStructure";
import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type {
  AgentPlanLoopIteration,
  AgentPlanLoopRun,
} from "@/definition/AgentPlanLoopRun";
import type {
  PicaMobileFlowIteration,
  PicaMobileFlowLoop,
  PicaMobileFlowNode,
  PicaMobileFlowNodeKind,
  PicaMobileFlowStage,
  PicaMobileRunFlow,
} from "@/definition/PicaMobileProtocol";

const FLOW_KIND: Readonly<
  Record<AgentPlanStructureKind, PicaMobileFlowNodeKind>
> = {
  start: "start",
  end: "end",
  agent: "agent",
  script: "script",
  git_closeout: "closeout",
  decision: "decision",
  stack: "stack",
  loop: "loop",
};

/** The stage of some nodes; none for a step without a node. */
function toStage(nodes: readonly PicaMobileFlowNode[]): PicaMobileFlowStage[] {
  const [first] = nodes;

  return first === undefined ? [] : [{ id: `stage-${first.id}`, nodes }];
}

/** The display name: Start and End have none, a decision only its own, other nodes fall back to their result. */
function displayName(
  node: AgentPlanStructureNode,
  result: Pick<AgentPlanStepResult, "name"> | undefined,
): string | undefined {
  if (node.kind === "start" || node.kind === "end") return undefined;
  if (node.kind === "decision") return node.name ?? undefined;

  return node.name ?? result?.name;
}

function toIteration(
  iteration: AgentPlanLoopIteration,
  order: readonly string[],
): PicaMobileFlowIteration {
  return {
    id: iteration.id,
    number: iteration.number,
    status: toPicaMobileFlowStatus(iteration),
    nodes: inPlanSequence(iteration.nodes, order).map((node) => ({
      id: node.id,
      status: toPicaMobileFlowStatus(node),
    })),
  };
}

function innerNode(
  node: AgentPlanStructureNode,
  newest: AgentPlanLoopIteration | undefined,
): PicaMobileFlowNode {
  const name = displayName(
    node,
    newest?.nodes.find((entry) => entry.id === node.id),
  );

  return {
    id: node.id,
    kind: FLOW_KIND[node.kind],
    ...(name === undefined ? {} : { name }),
    counted: false,
  };
}

/** A loop as it ran: what it resolved, the stages of an iteration and the iterations that started. */
function toLoop(
  node: AgentPlanStructureNode,
  record: AgentPlanLoopRun | undefined,
): PicaMobileFlowLoop {
  const iterations = record?.iterations ?? [];
  const newest = iterations.at(-1);
  const stages = node.iteration ?? [];
  const order = stages.flat().map((entry) => entry.id);
  const count = record?.count ?? null;

  return {
    ...(count === null
      ? {}
      : {
          count: {
            limit: count.effective,
            mode: count.source === "while" ? "while" : count.mode,
          },
        }),
    ...(record === undefined || record.completion === null
      ? {}
      : { completion: record.completion }),
    stages: stages.flatMap((entries) =>
      toStage(entries.map((entry) => innerNode(entry, newest))),
    ),
    iterationCount: iterations.length,
    iterations: iterations
      .slice(-PICA_MOBILE_MAXIMUM_FLOW_ITERATIONS)
      .map((iteration) => toIteration(iteration, order)),
  };
}

/** What a node shows besides its identity: state, pass and the branch a decision took. */
function resultFields(
  result: AgentPlanStepResult | undefined,
): Pick<PicaMobileFlowNode, "status" | "pass" | "branch"> {
  if (result === undefined) return {};

  return {
    status: toPicaMobileFlowStatus(result),
    ...(result.activation !== undefined && result.activation > 1
      ? { pass: result.activation }
      : {}),
    // The protocol knows true and false only; the value of a classification stays out of it.
    ...(result.branch === "true" || result.branch === "false"
      ? { branch: result.branch }
      : {}),
  };
}

function outerNode(
  node: AgentPlanStructureNode,
  results: ReadonlyMap<string, AgentPlanStepResult>,
  loops: ReadonlyMap<string, AgentPlanLoopRun>,
): PicaMobileFlowNode {
  const result = results.get(node.id);
  const name = displayName(node, result);

  return {
    id: node.id,
    kind: FLOW_KIND[node.kind],
    ...(node.number === null ? {} : { number: node.number }),
    ...(name === undefined ? {} : { name }),
    ...resultFields(result),
    // Counted exactly like the progress: a step of its own the run did not skip.
    counted: node.isStep && result !== undefined && result.status !== "skipped",
    ...(node.kind === "loop" ? { loop: toLoop(node, loops.get(node.id)) } : {}),
  };
}

/**
 * Maps a run onto the flow of `plans.flow.v1`.
 *
 * @param entry - The authorized run with the structure of its executed revision.
 * @returns Every node of the flow from Start to End with its state, loops with
 * the iterations that actually started, progress, failure and revision.
 *
 * @remarks
 * Only identifiers, kinds, numbers, names, states and machine codes enter the
 * mapping; results, outputs, sessions, prompts, parameters and paths never
 * do. Nothing is estimated: a loop lists no iteration that did not start, and
 * a node the run recorded nothing for has no state. `progress` comes from
 * the same summary as the plan row, so a loop counts once and Start, End,
 * decisions, stacks, loop members and skipped nodes never.
 */
export function toPlanFlow(entry: AgentPlanActiveRun): PicaMobileRunFlow {
  const { run } = entry;
  const summary = summarizePlanRun(run, entry.stages);
  const results = new Map(run.steps.map((step) => [step.id, step]));
  const loops = new Map((run.loops ?? []).map((loop) => [loop.id, loop]));
  const { failure } = summary;

  return {
    ...(entry.revision === undefined ? {} : { revision: entry.revision }),
    state: summary.state,
    startedAt: run.startedAt,
    ...(run.endedAt === undefined ? {} : { endedAt: run.endedAt }),
    progress: { done: summary.completedSteps, total: summary.totalSteps },
    ...(failure === null
      ? {}
      : {
          error: {
            code: failure.code,
            step:
              failure.stepName === null
                ? null
                : truncatePlanText(failure.stepName),
          },
        }),
    stages: entry.structure.flatMap((nodes) =>
      toStage(nodes.map((node) => outerNode(node, results, loops))),
    ),
  };
}
