import { planLoopParameterBoolean } from "@/definition/AgentPlanLoopGraph";
import {
  PLAN_LOOP_WHILE_BINDING,
  PLAN_LOOP_WHILE_LIMIT,
} from "@/definition/AgentPlanLoop";

import { readLoopBoolean } from "./AgentPlanLoopCondition";

import type { AgentErrorCode } from "@/backend/error/AgentErrors";
import type { AgentPlanInput } from "@/definition/AgentPlan";
import type { AgentPlanLoop } from "@/definition/AgentPlanLoop";
import type {
  AgentPlanLoopRun,
  AgentPlanLoopWhileCheck,
} from "@/definition/AgentPlanLoopRun";

/** What one check of a while loop found: a fresh boolean, or why there is none. */
export type LoopWhileVerdict =
  | { readonly check: AgentPlanLoopWhileCheck }
  | { readonly error: AgentErrorCode };

/** Reads the bound boolean parameter; another value than `true` or `false` is a failure. */
function parameterCheck(
  loop: AgentPlanLoop,
  plan: Pick<AgentPlanInput, "nodes">,
  before: number,
): LoopWhileVerdict {
  const binding = loop.bindings[PLAN_LOOP_WHILE_BINDING];
  const source =
    binding?.kind === "source"
      ? plan.nodes.find((node) => node.id === binding.nodeId)
      : undefined;
  const value = planLoopParameterBoolean(source);
  if (value === null) return { error: "plan_loop_while_invalid" };
  return {
    check: { before, source: "parameter", value, at: new Date().toISOString() },
  };
}

/** Reads the boolean of the source member from the iteration that just completed. */
function memberCheck(
  loop: AgentPlanLoop,
  record: AgentPlanLoopRun,
  before: number,
): LoopWhileVerdict {
  const later = loop.while;
  const previous = record.iterations.find(
    (iteration) => iteration.number === before - 1,
  );
  const node = previous?.nodes.find(
    (entry) => entry.id === later?.sourceNodeId,
  );
  if (!later || node?.status !== "succeeded")
    return { error: "plan_loop_while_invalid" };
  const read = readLoopBoolean(node.output, later.outputPath);
  if ("failure" in read) return { error: read.failure };
  return {
    check: {
      before,
      source: "member",
      value: read.value,
      at: new Date().toISOString(),
    },
  };
}

/**
 * Checks the boolean of a while loop before an iteration.
 *
 * @param loop - The frozen loop.
 * @param plan - The frozen plan with the bound parameter.
 * @param record - The loop's state, with the iterations so far.
 * @returns The check to record, or the failure.
 *
 * @remarks
 * Every check reads its value anew, the first one included: the bound
 * parameter before the first iteration, afterwards the newest result of the
 * source member, or the parameter again when the loop names no member. A
 * value of another type than boolean is a failure, never `false`. After
 * {@link PLAN_LOOP_WHILE_LIMIT} iterations the loop fails instead of running
 * on.
 */
export function checkLoopWhile(
  loop: AgentPlanLoop,
  plan: Pick<AgentPlanInput, "nodes">,
  record: AgentPlanLoopRun,
): LoopWhileVerdict {
  const before = record.iterations.length + 1;
  if (before > PLAN_LOOP_WHILE_LIMIT) return { error: "plan_loop_while_limit" };
  const hasMember = Boolean(loop.while?.sourceNodeId);
  return before === 1 || !hasMember
    ? parameterCheck(loop, plan, before)
    : memberCheck(loop, record, before);
}
