import type {
  ConversationDecisionFallback,
  ConversationDecisionOutcome,
} from "@/definition/ConversationDecision";
import type { DecisionAnswer } from "./ConversationDecisionPrompt";

/** What the model gave, or why it gave nothing. */
export type DecisionInput =
  | { readonly kind: "answer"; readonly answer: DecisionAnswer }
  | {
      readonly kind: "failure";
      readonly fallback: "no_model" | "model_failed";
    };

/** What one decision settled. */
export interface SettledDecision {
  readonly outcome: ConversationDecisionOutcome;
  readonly fallback: ConversationDecisionFallback;
  /** The agents that answer; the default responder for a fallback. */
  readonly responderIds: readonly string[];
  /** The agents thought responsible, which a fallback names. */
  readonly suggestedIds: readonly string[];
  readonly reason: string;
  readonly needsAnswer: boolean | null;
}

/** What settling a decision needs besides the model's answer. */
export interface DecisionRules {
  /** The agent members the decision may choose. */
  readonly candidateIds: readonly string[];
  /** The default responder of the group; `null` for none. */
  readonly defaultResponderId: string | null;
  /** How many agents answer at most. */
  readonly maximum: number;
}

function fallbackOutcome(
  rules: DecisionRules,
  fallback: Exclude<ConversationDecisionFallback, "none">,
  answer: DecisionAnswer | null,
): SettledDecision {
  const defaultId = rules.defaultResponderId;
  const hasDefault =
    defaultId !== null && rules.candidateIds.includes(defaultId);
  return {
    outcome: hasDefault ? "default" : "notice",
    fallback,
    responderIds: hasDefault ? [defaultId] : [],
    suggestedIds: answer?.suggestedIds ?? [],
    reason: answer?.reason ?? "",
    needsAnswer: answer?.needsAnswer ?? null,
  };
}

/**
 * Settles one decision from the answer of the model (PAGE-317).
 *
 * @param input - The answer, or why there is none.
 * @param rules - The agents of the chat, the default responder and the limit.
 * @returns The outcome: the chosen agents, at most the limit and only agents
 * of the chat; the default responder or a hint when it was unclear who is
 * addressed or the model gave nothing; nobody when the model chose nobody and
 * saw no question or request.
 */
export function settleDecision(
  input: DecisionInput,
  rules: DecisionRules,
): SettledDecision {
  if (input.kind === "failure")
    return fallbackOutcome(rules, input.fallback, null);
  const { answer } = input;
  const responderIds = [...new Set(answer.responderIds)]
    .filter((id) => rules.candidateIds.includes(id))
    .slice(0, Math.min(1, rules.maximum));
  if (responderIds.length > 0)
    return {
      outcome: "responders",
      fallback: "none",
      responderIds,
      suggestedIds: answer.suggestedIds,
      reason: answer.reason,
      needsAnswer: answer.needsAnswer,
    };
  if (answer.needsAnswer) return fallbackOutcome(rules, "unclear", answer);
  return {
    outcome: "nobody",
    fallback: "none",
    responderIds: [],
    suggestedIds: answer.suggestedIds,
    reason: answer.reason,
    needsAnswer: false,
  };
}
