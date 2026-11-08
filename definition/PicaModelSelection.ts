import { modelConsumerRefusal } from "./AgentModelConsumers";

import type { PageAgentModel } from "./PageAgent";

/** Pica uses ACP sessions that reach only its tools; the rule is the central one of {@link modelConsumerRefusal}. */
export function isPicaModel(
  model: Pick<
    PageAgentModel,
    "provider" | "model" | "isFree" | "isChatCapable"
  >,
): boolean {
  return modelConsumerRefusal("pica", model) === null;
}
