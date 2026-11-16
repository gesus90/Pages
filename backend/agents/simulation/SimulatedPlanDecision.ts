import { DecisionModelError } from "@/backend/error/DecisionModelError";

import type {
  ChoiceAnswer,
  DecisionQuestion,
  NoulAnswer,
  OpenRouterDecisionsResponse,
} from "@/backend/service/conversation/OpenRouterDecisionsClient";
import type { AgentSimulationMode } from "./AgentSimulationMode";

/** Words of a source that make the simulation answer no. */
const NO_WORDS = /\b(?:false|no|nein|falsch)\b/iu;

/** The probability the simulation gives its answer. */
const SIMULATED_PROBABILITY = 0.8;

function noulAnswer(state: string): NoulAnswer {
  return {
    type: "noul",
    noul: NO_WORDS.test(state)
      ? 1 - SIMULATED_PROBABILITY
      : SIMULATED_PROBABILITY,
    confidence: SIMULATED_PROBABILITY,
  };
}

function choiceAnswer(
  state: string,
  criteria: Readonly<Record<string, string>>,
): ChoiceAnswer {
  const keys = Object.keys(criteria);
  const text = state.toLocaleLowerCase();
  const named = keys.find((key) => text.includes(key.toLocaleLowerCase()));
  const choice = named ?? keys[0] ?? "";
  const rest =
    keys.length > 1 ? (1 - SIMULATED_PROBABILITY) / (keys.length - 1) : 0;
  return {
    type: "choice",
    choice,
    probabilities: Object.fromEntries(
      keys.map((key) => [key, key === choice ? SIMULATED_PROBABILITY : rest]),
    ),
    confidence: SIMULATED_PROBABILITY,
  };
}

/**
 * The simulated decision model of plans, part of the development simulation.
 * @remarks
 * It answers where the decisions interface would and contacts no provider: a
 * yes/no question is answered no when the source contains "false", "no",
 * "nein" or "falsch" as a word and yes otherwise; a choice takes the first
 * option whose name the source contains, the first option otherwise. The
 * scenario `failed` fails on purpose, as the real model can.
 */
export class SimulatedPlanDecision {
  private readonly mode: AgentSimulationMode;

  public constructor(mode: AgentSimulationMode) {
    this.mode = mode;
  }

  /**
   * Answers the questions about a source.
   * @param state - The source text.
   * @param questions - The typed questions by their IDs.
   * @returns An answer of the asked type to every question, without cost.
   * @throws {DecisionModelError} `decision_failed` in the scenario `failed`.
   */
  public decide(
    state: string,
    questions: Readonly<Record<string, DecisionQuestion>>,
  ): OpenRouterDecisionsResponse {
    if (this.mode.scenario === "failed")
      throw new DecisionModelError("decision_failed");
    return {
      model: "simulation",
      answers: Object.fromEntries(
        Object.entries(questions).map(([id, question]) => [
          id,
          question.type === "noul"
            ? noulAnswer(state)
            : choiceAnswer(state, question.criteria),
        ]),
      ),
      costUsd: null,
    };
  }
}
