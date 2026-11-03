import { isZenToolModel, modelConsumerRefusal } from "./AgentModelConsumers";

import type { PageAgentModel } from "./PageAgent";

/** Pica uses verified ACP sessions; the rule is the central one of {@link modelConsumerRefusal}. */
export function isPicaModel(
  model: Pick<PageAgentModel, "provider" | "model" | "isFree">,
): boolean {
  return modelConsumerRefusal("pica", model) === null;
}

/** Identifies the free Zen models excluded only from Pica, never from plans. */
export function isPicaZenModel(
  model: Pick<PageAgentModel, "provider" | "model" | "isFree">,
): boolean {
  return isZenToolModel(model);
}
