import { modelConsumerRefusal } from "@/definition/AgentModelConsumers";

import type { AgentEmployeeAccess } from "@/definition/AgentEmployee";
import type { AgentModelConsumer } from "@/definition/AgentModelConsumers";
import type { PageAgentModel } from "@/definition/PageAgent";
import type { TFunction } from "i18next";

/** How a place judges the models it was given. */
export interface ModelUsageRule {
  /** Central capability rule; plans are the default consumer. */
  readonly consumer?: AgentModelConsumer;
  /** Current draft access level when choosing a model for an employee. */
  readonly employeeAccess?: AgentEmployeeAccess;
  /** The place's own reason a model cannot be used, beyond the central rule. */
  readonly refusalOf?: (model: PageAgentModel) => string | null;
}

/** The models a place can use and, by selection key, why it cannot use the others. */
export interface UsableModels {
  readonly listed: readonly PageAgentModel[];
  readonly refusals: ReadonlyMap<string, string>;
}

/**
 * The reason a place cannot use a model, worded for the person.
 * @remarks
 * The central rule of {@link modelConsumerRefusal} decides first, so the
 * editor and the server judge a model alike; the place's own reason, such as
 * a connection that is off, applies only to a model the central rule accepts.
 * @param rule - The place's consumer, access level and own reason.
 * @param model - A model of the shared catalog.
 * @param translate - Translates the reasons.
 * @returns The reason, or `null` when the place can use the model.
 */
export function modelRefusalText(
  rule: ModelUsageRule,
  model: PageAgentModel,
  translate: TFunction,
): string | null {
  const refusal = modelConsumerRefusal(rule.consumer ?? "plan", model, {
    employeeAccess: rule.employeeAccess,
  });
  if (refusal === "zenToolsMissing")
    return translate("settings.agents.error.picaZenUnsupported");
  if (refusal !== null)
    return translate(`settings.agents.modelSelection.refusal.${refusal}`);
  return rule.refusalOf?.(model) ?? null;
}

/**
 * Splits the models of a place into those it can use and the reasons for the rest.
 * @param models - The models the place may offer.
 * @param refusalOf - The reason a model cannot be used here; `null` when it can.
 * @returns The usable models in their order, and the reason of every other model by selection key.
 */
export function usableModels(
  models: readonly PageAgentModel[],
  refusalOf: (model: PageAgentModel) => string | null,
): UsableModels {
  const listed: PageAgentModel[] = [];
  const refusals = new Map<string, string>();
  for (const model of models) {
    const refusal = refusalOf(model);
    if (refusal === null) listed.push(model);
    else refusals.set(model.id, refusal);
  }
  return { listed, refusals };
}
