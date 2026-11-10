import {
  PLAN_DECISION_SOURCE_LIMIT,
  planDecisionBinding,
  planDecisionOutput,
} from "@/definition/AgentPlanDecision";

import { eventPrompt } from "./AgentPlanBranchSettle";

import type {
  AgentPlanDecision,
  AgentPlanRun,
  AgentPlanStepResult,
} from "@/definition/AgentPlan";
import type { AgentPlanSnapshot } from "../AgentPlanSnapshot";
import type { AgentPlanTasks } from "../AgentPlanTasks";

/** The content a model decision reads, and where it came from. */
export interface PlanDecisionSource {
  /** The ticket node, agent or script the decision is bound to. */
  readonly nodeId: string;
  /** Which start of the agent or script delivered the text; absent for a ticket. */
  readonly activation?: number;
  /** How the prompt names the source. */
  readonly label: string;
  readonly text: string;
}

/** What reading the source needs: the run, its frozen plan and the results in scope. */
interface SourceRequest {
  readonly run: AgentPlanRun;
  readonly snapshot: AgentPlanSnapshot;
  readonly decision: AgentPlanDecision;
  readonly results: ReadonlyMap<string, AgentPlanStepResult>;
}

/** The text result of the current start of an agent or script, or `null` when it has none. */
function resultSource(
  stepId: string,
  results: ReadonlyMap<string, AgentPlanStepResult>,
): PlanDecisionSource | null {
  const result = results.get(stepId);
  if (result?.status !== "succeeded") return null;
  const text = eventPrompt(result.output);
  if (text.length === 0) return null;
  return {
    nodeId: stepId,
    activation: result.activation ?? 1,
    label: `the text result of "${result.name}"`,
    text,
  };
}

/**
 * Reads the source of a model decision for its current activation.
 *
 * @param tasks - The ticket reader, which checks the rights of the executor.
 * @param request - The decision, its run and the results in scope.
 * @returns The source, or `null` when it is absent, empty or too long; Pages
 * never shortens it.
 * @throws {AgentError} When the executor may no longer read the ticket.
 *
 * @remarks
 * A ticket is read anew with the existing rights check every time; a result
 * is the one of the current start of its node, without its closing report.
 */
export async function readDecisionSource(
  tasks: Pick<AgentPlanTasks, "snapshot">,
  request: SourceRequest,
): Promise<PlanDecisionSource | null> {
  const binding = planDecisionBinding(request.decision);
  let source: PlanDecisionSource | null = null;
  if (binding?.kind === "result")
    source = resultSource(binding.stepId, request.results);
  if (binding?.kind === "source") {
    const node = request.snapshot.plan.nodes.find(
      (entry) => entry.id === binding.nodeId,
    );
    if (node?.type !== "task") return null;
    const ticket = await tasks.snapshot(
      request.run.userId,
      request.snapshot.plan.projectId,
      node.taskId,
    );
    source = {
      nodeId: node.id,
      label: "a ticket",
      text: ticket.markdown,
    };
  }
  if (!source || source.text.length > PLAN_DECISION_SOURCE_LIMIT) return null;
  return source;
}

/** The allowed values as the prompt names them. */
function allowedValues(decision: AgentPlanDecision): string {
  if (planDecisionOutput(decision) === "boolean")
    return 'the JSON boolean true or the JSON boolean false (not the strings "true" or "false")';
  return `exactly one of these strings: ${(decision.cases ?? []).map((entry) => JSON.stringify(entry.name)).join(", ")}`;
}

function answerShape(decision: AgentPlanDecision): string {
  return planDecisionOutput(decision) === "boolean"
    ? '{"decision":true,"reason":"short reason"}'
    : `{"decision":${JSON.stringify(decision.cases?.[0]?.name ?? "value")},"reason":"short reason"}`;
}

/**
 * The prompt of a model decision: the question, the allowed values and the source, nothing else.
 *
 * @param decision - The frozen decision.
 * @param source - What it reads.
 */
export function decisionPrompt(
  decision: AgentPlanDecision,
  source: PlanDecisionSource,
): string {
  return [
    "You are the decision step of an automated plan. Read the source below and answer the question. You have no tools; do not try to use any.",
    "",
    "Question:",
    decision.question?.trim() ?? "",
    "",
    `Allowed values for "decision": ${allowedValues(decision)}.`,
    "",
    'Answer with exactly one JSON object with the two fields "decision" and "reason" and nothing else: no text before or after it, no code fence, no further fields. "reason" is a short justification of one or two sentences.',
    `Example of the form: ${answerShape(decision)}`,
    "",
    `Source (${source.label}):`,
    "<<<SOURCE",
    source.text,
    "SOURCE>>>",
  ].join("\n");
}

/**
 * The single correction a model gets after an invalid answer.
 *
 * @param decision - The frozen decision.
 * @param problem - What was wrong with the answer, in Pages' own words.
 */
export function decisionCorrectionPrompt(
  decision: AgentPlanDecision,
  problem: string,
): string {
  return [
    `Your answer was invalid: ${problem}`,
    `Answer again with exactly one JSON object and nothing else. Allowed values for "decision": ${allowedValues(decision)}.`,
    `Form: ${answerShape(decision)}`,
  ].join("\n");
}
