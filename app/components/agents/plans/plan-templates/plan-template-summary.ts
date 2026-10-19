import { planAgentName } from "../plan-layout";
import { planValuePreview } from "../plan-node-card/plan-value-preview";

import type { TFunction } from "i18next";
import type { AgentPlanTemplateNode } from "@/definition/AgentPlanNodeTemplate";
import type { PlanValueContext } from "../plan-node-card/plan-value-preview";

// A list line names a value only briefly; the card shows all of it.
const VALUE_PREVIEW_LENGTH = 40;

function shortened(text: string): string {
  const line = text.replace(/\s+/gu, " ").trim();
  return line.length > VALUE_PREVIEW_LENGTH
    ? `${line.slice(0, VALUE_PREVIEW_LENGTH - 1)}…`
    : line;
}

/**
 * The name a node suggests for its template: what its card shows as name.
 *
 * @returns The parameter or group name, or the agent's name; empty when the
 * agent is unknown.
 */
export function planTemplateSuggestion(
  node: AgentPlanTemplateNode,
  context: Pick<PlanValueContext, "sources">,
): string {
  if (node.type === "agent") return planAgentName(node, context.sources);
  return node.name;
}

/**
 * A short line about a template's configuration, after its type.
 *
 * @returns The value type and value of a parameter, the model and reasoning
 * effort of an agent, the interpreter profile of a script, or the number of
 * agents in a group.
 */
export function planTemplateDetails(
  node: AgentPlanTemplateNode,
  context: PlanValueContext,
): readonly string[] {
  const { translate } = context;
  if (node.type === "group")
    return [translate("plans.templates.members", { count: node.steps.length })];
  if (node.type === "script") {
    const profile = context.sources.interpreters?.find(
      (entry) => entry.id === node.interpreterProfileId,
    );
    return [profile?.name ?? node.interpreterProfileId];
  }
  if (node.type === "parameter") {
    const kind = node.value.type === "text" ? node.format : node.value.type;
    const value = shortened(planValuePreview(node.value, context));
    return [translate(`plans.valueTypes.${kind}`), value].filter(Boolean);
  }
  const configuration = node.configuration;
  if (!configuration) return [];
  const model = context.sources.models?.find(
    (entry) => entry.id === configuration.modelProfileId,
  );
  return [
    model?.name ?? configuration.model,
    configuration.reasoningEffort ?? "",
  ]
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * The line about a configuration in the save dialog: the list's line, and
 * for a script the number of its inputs as well.
 */
export function planTemplateSaveDetails(
  node: AgentPlanTemplateNode,
  context: PlanValueContext,
): readonly string[] {
  const details = planTemplateDetails(node, context);
  if (node.type !== "script") return details;
  return [
    ...details,
    context.translate("plans.templates.inputs", { count: node.inputs.length }),
  ];
}

/** The translated reason of a refused template request. */
export function planTemplateError(t: TFunction, error: string): string {
  return t(`settings.agents.error.${error}`, {
    defaultValue: t(`agentExecution.error.${error}`, {
      defaultValue: t("settings.agents.error.general"),
    }),
  });
}
