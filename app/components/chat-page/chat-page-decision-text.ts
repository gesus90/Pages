import { probabilityPercent } from "@/definition/ConversationDecision";

import type { TFunction } from "i18next";
import type { ConversationDecisionView } from "@/definition/ConversationDecision";

/**
 * A probability as the chat writes it.
 *
 * @param probability - A probability from 0 to 1.
 * @returns For example "82 %".
 */
export function percentText(probability: number): string {
  return `${String(probabilityPercent(probability))} %`;
}

/**
 * How the model spread the question "Which agent is meant?".
 *
 * @param decision - The decision of a message.
 * @param translate - The translation function of the page.
 * @returns For example "Ed 78 %, Mei 15 %, niemand 7 %"; empty without a model answer.
 */
export function distributionText(
  decision: Pick<ConversationDecisionView, "choices">,
  translate: TFunction,
): string {
  return decision.choices
    .map(
      (choice) =>
        `${choice.agentId === null ? translate("chatPage.decision.nobody") : choice.name} ${percentText(choice.probability)}`,
    )
    .join(", ");
}

/**
 * The whole line of probabilities of a decision.
 *
 * @param decision - The decision of a message.
 * @param translate - The translation function of the page.
 * @returns For example "Antwort erwartet 82 % · Ed 78 %, Mei 15 %, niemand 7 %";
 * empty without a model answer.
 */
export function probabilitiesText(
  decision: Pick<ConversationDecisionView, "choices" | "answerProbability">,
  translate: TFunction,
): string {
  if (decision.answerProbability === null) return "";
  return `${translate("chatPage.decision.expected", { probability: percentText(decision.answerProbability) })} · ${distributionText(decision, translate)}`;
}
