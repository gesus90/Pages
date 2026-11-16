import { DecisionModelError } from "@/backend/error/DecisionModelError";
import {
  PLAN_DECISION_SOURCE_LIMIT,
  PLAN_DECISION_YES_THRESHOLD,
  planDecisionBinding,
  planDecisionOutput,
} from "@/definition/AgentPlanDecision";

import { DECISION_DATA_NOTICE } from "../../conversation/OpenRouterDecisionsClient";
import { eventPrompt } from "./AgentPlanBranchSettle";

import type {
  DecisionQuestion,
  OpenRouterDecisionsResponse,
} from "../../conversation/OpenRouterDecisionsClient";
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
 * @param tasks - The ticket reader, which checks the rights of the executor.
 * @param request - The decision, its run and the results in scope.
 * @returns The source, or `null` when it is absent, empty or too long; Pages
 * never shortens it.
 * @throws {AgentError} When the executor may no longer read the ticket.
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

/** The key of the one question a model decision asks. */
export const PLAN_DECISION_QUESTION_KEY = "decision";

/**
 * The one typed question of a model decision.
 * @param decision - The frozen decision.
 * @returns A `noul` question for yes or no, or a `choice` question whose
 * criteria are the values of the decision: the name of each value as its key
 * and, as no value stores a description, its name as the description. The
 * question of the decision is the instruction, with the notice that the
 * source is data only.
 */
export function decisionQuestions(
  decision: AgentPlanDecision,
): Readonly<Record<string, DecisionQuestion>> {
  const instructions = `${decision.question?.trim() ?? ""}\n\n${DECISION_DATA_NOTICE}`;
  if (planDecisionOutput(decision) === "boolean")
    return { [PLAN_DECISION_QUESTION_KEY]: { type: "noul", instructions } };
  return {
    [PLAN_DECISION_QUESTION_KEY]: {
      type: "choice",
      instructions,
      criteria: Object.fromEntries(
        (decision.cases ?? []).map((entry) => [entry.name, entry.name]),
      ),
    },
  };
}

/** What the decision model answered, read against the decision. */
export interface PlanDecisionModelAnswer {
  /** `true`/`false` for yes or no, the name of the value for a classification. */
  readonly decision: boolean | string;
  /** The value of a classification; absent for yes or no. */
  readonly caseId?: string;
  /** The probability of yes, or of the chosen value; `null` when the model gave none. */
  readonly probability: number | null;
  readonly confidence: number | null;
}

/**
 * Reads the answer of the decision model against the decision.
 * @param response - What the decisions interface answered.
 * @param decision - The frozen decision with its output kind and values.
 * @returns Yes from a probability of {@link PLAN_DECISION_YES_THRESHOLD} on,
 * no below it; for a classification the chosen value.
 * @throws {DecisionModelError} `decision_invalid` when the answer is missing,
 * has another type than asked or names no value of the decision. A failure
 * is never read as no or as one of the values.
 */
export function readDecisionModelAnswer(
  response: OpenRouterDecisionsResponse,
  decision: AgentPlanDecision,
): PlanDecisionModelAnswer {
  const answer = response.answers[PLAN_DECISION_QUESTION_KEY];
  if (planDecisionOutput(decision) === "boolean") {
    if (answer?.type !== "noul")
      throw new DecisionModelError("decision_invalid");
    return {
      decision: answer.noul >= PLAN_DECISION_YES_THRESHOLD,
      probability: answer.noul,
      confidence: answer.confidence,
    };
  }
  if (answer?.type !== "choice")
    throw new DecisionModelError("decision_invalid");
  const match = (decision.cases ?? []).find(
    (entry) => entry.name === answer.choice,
  );
  if (match === undefined) throw new DecisionModelError("decision_invalid");
  return {
    decision: match.name,
    caseId: match.id,
    probability: answer.probabilities?.[match.name] ?? null,
    confidence: answer.confidence,
  };
}
