import type {
  ConversationDecisionFallback,
  ConversationDecisionOutcome,
  ConversationDecisionRules,
} from "@/definition/ConversationDecision";
import type {
  DecisionOption,
  DecisionProbabilities,
} from "./ConversationDecisionPrompt";

/** What the model gave, or why it gave nothing. */
export type DecisionInput =
  | {
      readonly kind: "answer";
      /** The model build that answered. */
      readonly model: string;
      readonly probabilities: DecisionProbabilities;
    }
  | {
      readonly kind: "failure";
      readonly fallback: "no_model" | "model_failed";
    };

/** What one decision settled. */
export interface SettledDecision {
  readonly outcome: Extract<
    ConversationDecisionOutcome,
    "responders" | "nobody" | "unavailable"
  >;
  readonly fallback: ConversationDecisionFallback;
  /** The agents that answer; empty unless `responders`. */
  readonly responderIds: readonly string[];
  /** The model build that answered; `null` without an answer. */
  readonly model: string | null;
  readonly answerProbability: number | null;
  /** Every agent and nobody with their probability, the most probable first. */
  readonly options: readonly DecisionOption[];
}

/** An option that names an agent. */
interface AgentOption extends DecisionOption {
  readonly agentId: string;
}

function isAgentOption(option: DecisionOption): option is AgentOption {
  return option.agentId !== null;
}

/** A threshold in whole percent as a probability. */
function atLeast(probability: number, thresholdPercent: number): boolean {
  return probability >= thresholdPercent / 100;
}

/** The most probable first; nobody after an agent of the same probability. */
function ranked(options: readonly DecisionOption[]): DecisionOption[] {
  return [...options].sort((left, right) => {
    if (right.probability !== left.probability)
      return right.probability - left.probability;
    return Number(left.agentId === null) - Number(right.agentId === null);
  });
}

function nobodyOutcome(
  model: string,
  probabilities: DecisionProbabilities,
  options: readonly DecisionOption[],
): SettledDecision {
  return {
    outcome: "nobody",
    fallback: "none",
    responderIds: [],
    model,
    answerProbability: probabilities.answerProbability,
    options,
  };
}

/**
 * Settles one decision from the probabilities of the model (PAGE-379).
 *
 * @param input - The answer of the model, or why there is none.
 * @param rules - The thresholds and the most answering agents that apply.
 * @returns The outcome. Pages decides, not the model: nobody answers when the
 * chance that an answer is expected stays below the answer threshold or nobody
 * is at least as probable as every agent; otherwise the most probable agent
 * answers once it reaches the responsibility threshold, and each further
 * agent once it reaches the second threshold, never more than the limit. A
 * missing model or a failed call gives `unavailable`, which starts nobody.
 */
export function settleDecision(
  input: DecisionInput,
  rules: ConversationDecisionRules,
): SettledDecision {
  if (input.kind === "failure")
    return {
      outcome: "unavailable",
      fallback: input.fallback,
      responderIds: [],
      model: null,
      answerProbability: null,
      options: [],
    };
  const { probabilities, model } = input;
  const options = ranked(probabilities.options);
  if (!atLeast(probabilities.answerProbability, rules.answerThreshold))
    return nobodyOutcome(model, probabilities, options);
  const [first, ...others] = options.filter(isAgentOption);
  const nobody = options.find((option) => option.agentId === null);
  if (
    first === undefined ||
    (nobody !== undefined && nobody.probability >= first.probability) ||
    !atLeast(first.probability, rules.responsibilityThreshold)
  )
    return nobodyOutcome(model, probabilities, options);
  const responderIds = [first.agentId];
  for (const option of others) {
    if (responderIds.length >= rules.maximumResponders) break;
    if (atLeast(option.probability, rules.secondThreshold))
      responderIds.push(option.agentId);
  }
  return {
    outcome: "responders",
    fallback: "none",
    responderIds,
    model,
    answerProbability: probabilities.answerProbability,
    options,
  };
}
