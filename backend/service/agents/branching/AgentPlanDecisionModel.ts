import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";
import { DecisionModelError } from "@/backend/error/DecisionModelError";
import { logCaughtError } from "@/backend/logging/Logger";
import {
  PLAN_DECISION_TIMEOUT_MS,
  planDecisionCasesProblem,
  planDecisionMode,
  planDecisionOutput,
} from "@/definition/AgentPlanDecision";

import { DECISION_SIMULATION_CONNECTION } from "../../chat/ChatDecisionModels";
import { errorCode } from "../AgentPlanStepFailure";
import {
  decisionQuestions,
  readDecisionModelAnswer,
  readDecisionSource,
} from "./AgentPlanDecisionPrompt";
import { invalidDecisionInput } from "./AgentPlanDecisionValue";

import type { SimulatedPlanDecision } from "@/backend/agents/simulation/SimulatedPlanDecision";
import type { AgentErrorCode } from "@/backend/error/AgentErrors";
import type { DecisionModelErrorCode } from "@/backend/error/DecisionModelError";
import type {
  AgentPlanDecision,
  AgentPlanRun,
  AgentPlanStepResult,
} from "@/definition/AgentPlan";
import type { AgentPlanDecisionVerdict } from "@/definition/AgentPlanDecision";
import type { DecisionModelCalls } from "../../chat/DecisionModelCalls";
import type { OpenRouterDecisionsResponse } from "../../conversation/OpenRouterDecisionsClient";
import type { AgentPlanSnapshot } from "../AgentPlanSnapshot";
import type { AgentPlanTasks } from "../AgentPlanTasks";
import type {
  PlanDecisionModelAnswer,
  PlanDecisionSource,
} from "./AgentPlanDecisionPrompt";
import type {
  PlanDecisionModelChoice,
  PlanDecisionModels,
} from "./PlanDecisionModels";

/** The failure code of a step for each reason a decision call gave no decision. */
const FAILURE_CODES: Readonly<Record<DecisionModelErrorCode, AgentErrorCode>> =
  {
    decision_no_model: "plan_decision_model_missing",
    decision_key_invalid: "plan_decision_key_invalid",
    decision_no_credit: "plan_decision_no_credit",
    decision_unsupported: "plan_decision_unsupported",
    decision_timeout: "plan_decision_timeout",
    decision_unreachable: "plan_decision_unreachable",
    decision_failed: "plan_decision_provider_failed",
    decision_invalid: "plan_decision_answer_invalid",
    decision_refused: "plan_decision_refused",
  };

/** What a model decision needs from the server: the decision models, the calls and the tickets. */
export interface PlanDecisionModelDependencies {
  readonly tasks: Pick<AgentPlanTasks, "snapshot">;
  /** Which decision model an activation asks, read anew every time. */
  readonly models: Pick<PlanDecisionModels, "resolve">;
  /** The decisions interface of OpenRouter with the key of the connection. */
  readonly calls: Pick<DecisionModelCalls, "decide">;
  /** The simulated decision model; set only while the simulation is on. */
  readonly simulation: SimulatedPlanDecision | null;
}

/** One activation of a model decision. */
export interface PlanDecisionRequest {
  readonly run: AgentPlanRun;
  readonly snapshot: AgentPlanSnapshot;
  readonly decision: AgentPlanDecision;
  /** The results the decision may read: the run's, or the current iteration's on top of the run's. */
  readonly results: ReadonlyMap<string, AgentPlanStepResult>;
  readonly signal: AbortSignal;
  /** Rechecks the executor's access to the plan before the call. */
  readonly authorize: () => Promise<void>;
}

/** Whether the settings of a model decision are complete enough to ask. */
function isReady(decision: AgentPlanDecision): boolean {
  return (
    planDecisionMode(decision) === "model" &&
    (decision.question?.trim().length ?? 0) > 0 &&
    (planDecisionOutput(decision) === "boolean" ||
      planDecisionCasesProblem(decision.cases) === null)
  );
}

function cancelled(): Partial<AgentPlanStepResult> {
  return { status: "cancelled", cancellation: "confirmed", output: null };
}

function failed(code: string): Partial<AgentPlanStepResult> {
  return { status: "failed", error: code, output: null };
}

/** The answer as the run report shows it: the value, its probability, the confidence and the cost. */
function reportLine(verdict: AgentPlanDecisionVerdict): string {
  const details = [
    verdict.probability === undefined
      ? null
      : `probability ${verdict.probability.toFixed(2)}`,
    verdict.confidence === undefined
      ? null
      : `confidence ${verdict.confidence.toFixed(2)}`,
    verdict.costUsd === undefined
      ? null
      : `cost ${verdict.costUsd.toFixed(6)} USD`,
  ].filter((detail) => detail !== null);
  const value = String(verdict.decision);
  return details.length === 0 ? value : `${value} (${details.join(", ")})`;
}

function verdictOf(
  answer: PlanDecisionModelAnswer,
  context: {
    readonly model: string;
    readonly source: PlanDecisionSource;
    readonly costUsd: number | null;
  },
): AgentPlanDecisionVerdict {
  const { source } = context;
  return {
    decision: answer.decision,
    ...(answer.caseId === undefined ? {} : { caseId: answer.caseId }),
    // A decision model gives no reason; the field stays empty, without a placeholder.
    reason: "",
    ...(answer.probability === null ? {} : { probability: answer.probability }),
    ...(answer.confidence === null ? {} : { confidence: answer.confidence }),
    ...(context.costUsd === null ? {} : { costUsd: context.costUsd }),
    model: context.model,
    sourceStepId: source.nodeId,
    ...(source.activation === undefined
      ? {}
      : { sourceActivation: source.activation }),
    isCorrected: false,
  };
}

/**
 * Asks the decision model of a decision through the decisions interface of OpenRouter.
 *
 * @remarks
 * One call of `POST /api/alpha/decisions` per activation, on the server,
 * with the key of the OpenRouter connection of the model and a fixed time
 * limit of two minutes; no ACP session, working directory or tool is
 * involved. The bound source is the `state`, the question of the decision
 * the instruction of one `noul` question for yes or no, or of one `choice`
 * question whose criteria are the values of the decision. Yes from a
 * probability of 0.5 on. A missing, mistyped or refused answer and every
 * HTTP error fail the decision with a code of its own; no failure ever
 * activates an output, and no call is repeated. The cost the provider
 * states is kept with the result of the activation.
 */
export class AgentPlanDecisionModel {
  private readonly dependencies: PlanDecisionModelDependencies;

  public constructor(dependencies: PlanDecisionModelDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Decides one activation of a model decision.
   * @param request - The decision, the results it reads and the stop signal.
   * @returns The changes of its result: the activated branch with the answer,
   * or a failure without any branch.
   */
  public async run(
    request: PlanDecisionRequest,
  ): Promise<Partial<AgentPlanStepResult>> {
    const { decision } = request;
    if (!isReady(decision)) return invalidDecisionInput();
    try {
      await request.authorize();
      const source = await readDecisionSource(this.dependencies.tasks, request);
      if (source === null) return invalidDecisionInput();
      const model = await this.dependencies.models.resolve(
        request.run.userId,
        decision,
      );
      if (model === null)
        return failed(
          decision.model === undefined
            ? "plan_decision_model_missing"
            : "plan_decision_model_unavailable",
        );
      const response = await this.ask(request, model, source);
      const answer = readDecisionModelAnswer(response, decision);
      return this.settled(answer, {
        model: model.model,
        source,
        costUsd: response.costUsd,
      });
    } catch (error: unknown) {
      if (error instanceof AgentPlanCancelledError || request.signal.aborted)
        return cancelled();
      if (error instanceof DecisionModelError)
        return failed(FAILURE_CODES[error.code]);
      logCaughtError("AgentPlanDecisionModel", error);
      return failed(errorCode(error));
    }
  }

  private async ask(
    request: PlanDecisionRequest,
    model: PlanDecisionModelChoice,
    source: PlanDecisionSource,
  ): Promise<OpenRouterDecisionsResponse> {
    const questions = decisionQuestions(request.decision);
    if (model.connectionId === DECISION_SIMULATION_CONNECTION) {
      const { simulation } = this.dependencies;
      if (simulation === null)
        throw new DecisionModelError("decision_no_model");
      return simulation.decide(source.text, questions);
    }
    await request.authorize();
    return this.dependencies.calls.decide({
      connectionId: model.connectionId,
      model: model.model,
      state: source.text,
      questions,
      timeoutMs: PLAN_DECISION_TIMEOUT_MS,
      signal: request.signal,
    });
  }

  private settled(
    answer: PlanDecisionModelAnswer,
    context: Parameters<typeof verdictOf>[1],
  ): Partial<AgentPlanStepResult> {
    const yesNo = answer.decision === true ? "true" : "false";
    const verdict = verdictOf(answer, context);
    return {
      status: "succeeded",
      branch:
        answer.caseId === undefined
          ? yesNo
          : (`case:${answer.caseId}` as const),
      verdict,
      output: reportLine(verdict),
      error: null,
    };
  }
}
