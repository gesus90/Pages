import { syntheticPlan } from "../page61-plan-fixture";
import { syntheticRun } from "../page72-run-fixture";

import type {
  AgentPlanInput,
  AgentPlanNode,
  AgentPlanRun,
  AgentPlanStep,
} from "@/definition/AgentPlan";
import type { AgentPlanLoop } from "@/definition/AgentPlanLoop";
import type {
  AgentPlanLoopConditionOutcome,
  AgentPlanLoopIteration,
  AgentPlanLoopRun,
} from "@/definition/AgentPlanLoopRun";

/** An agent member of a loop at a position inside the loop's member area. */
export function loopMember(
  id: string,
  agentId: string,
  position: { readonly x: number; readonly y: number },
): AgentPlanStep {
  return {
    id,
    type: "agent",
    ...position,
    agentId,
    personalAgentId: null,
    instruction: "",
    bindings: {},
  };
}

/** A named `max` loop of three runs that keeps its sessions, without members or condition. */
export function syntheticLoop(
  overrides: Partial<AgentPlanLoop> = {},
): AgentPlanLoop {
  return {
    id: "loop",
    type: "loop",
    name: "Review loop",
    x: 0,
    y: 640,
    steps: [],
    edges: [],
    runs: 3,
    runsSource: "value",
    bindings: {},
    countMode: "max",
    sessionPolicy: "reuse",
    condition: null,
    ...overrides,
  };
}

/** The synthetic plan with the loop added; its spare parameter node holds the text `kept`. */
export function loopPlan(
  loop: AgentPlanLoop,
  extra: readonly AgentPlanNode[] = [],
): AgentPlanInput {
  const plan = syntheticPlan();
  return { ...plan, nodes: [...plan.nodes, ...extra, loop] };
}

/** The loop of a plan draft, if the draft still has it. */
export function findLoop(draft: AgentPlanInput): AgentPlanLoop | undefined {
  return draft.nodes.find(
    (node): node is AgentPlanLoop => node.type === "loop",
  );
}

/** One finished iteration with the given verdict of the end condition. */
export function loopIteration(
  number: number,
  condition: AgentPlanLoopConditionOutcome,
): AgentPlanLoopIteration {
  return {
    id: `iteration-${number}`,
    number,
    status: "succeeded",
    startedAt: "2026-10-15T10:00:00.000Z",
    endedAt: "2026-10-15T10:01:00.000Z",
    nodes: [],
    condition,
    error: null,
  };
}

/** The synthetic run with one running record of the loop `loop`. */
export function loopRun(
  iterations: readonly AgentPlanLoopIteration[],
): AgentPlanRun {
  const record: AgentPlanLoopRun = {
    id: "loop",
    name: "Review loop",
    status: "running",
    count: { source: "value", parameterId: null, effective: 3, mode: "max" },
    sessionPolicy: "reuse",
    condition: null,
    iterations,
    sessions: [],
    completion: null,
    cleanup: "not_needed",
    startedAt: "2026-10-15T10:00:00.000Z",
    endedAt: null,
    error: null,
  };
  return { ...syntheticRun(), loops: [record] };
}
