import { defaultAgentRunOptions } from "./AgentConfiguration";
import { findSavedModel } from "./AgentModelVersion";
import type { StoredModelMatch } from "./AgentModelVersion";
import type { AgentPlanExecutionTarget } from "./AgentPlanExecution.js";
import type { RunnerModelRoute } from "./RunnerExecution.js";
import type { AgentDefinitionChoice } from "./AgentAvailability";
import type { AgentConfiguration } from "./AgentConfiguration";
import type { AgentProviderId } from "./AgentConnection";
import type { AgentPlanStep } from "./AgentPlan";
import type { PageAgentModel } from "./PageAgent";

/** Runtime content without usage grants, connections or credentials. */
export type AgentPlanTemplate = Pick<
  AgentConfiguration,
  "markdown" | "parameters" | "directoryParameter" | "run"
>;

/** A node owns this copy; the source revision records where it originated. */
export interface AgentPlanConfiguration {
  readonly runnerRoute?: RunnerModelRoute;
  readonly name: string;
  readonly revision: number;
  readonly modelProfileId: string;
  /** Direct routing; legacy copies retain modelProfileId as their provenance. */
  readonly connectionId?: string;
  readonly model: string;
  readonly provider: AgentProviderId | null;
  readonly reasoningEffort: string | null;
  readonly template: AgentPlanTemplate;
}

/** An unambiguous selection key, never a persisted or user-managed profile. */
export function agentModelKey(connectionId: string, model: string): string {
  return JSON.stringify([connectionId, model]);
}

/** Starts an independent node configuration from a permitted connection model. */
export function planConfigurationForModel(
  model: PageAgentModel,
): AgentPlanConfiguration {
  return {
    ...(model.runnerRoute ? { runnerRoute: model.runnerRoute } : {}),
    name: model.model.slice(0, 200),
    revision: 1,
    modelProfileId: model.id,
    ...(model.connectionId ? { connectionId: model.connectionId } : {}),
    model: model.model,
    provider: model.provider,
    reasoningEffort: null,
    template: {
      markdown: "",
      parameters: model.runnerRoute
        ? []
        : [
            {
              name: "workspace",
              description: "",
              type: "workspace",
              isRequired: true,
              defaultValue: null,
            },
          ],
      directoryParameter: model.runnerRoute ? null : "workspace",
      run: defaultAgentRunOptions(model.provider),
    },
  };
}

/** The catalog key of a saved direct selection, preserving legacy identifiers otherwise. */
export function planConfigurationModelKey(
  configuration: AgentPlanConfiguration,
): string {
  if (configuration.runnerRoute) return configuration.modelProfileId;
  return configuration.connectionId
    ? agentModelKey(configuration.connectionId, configuration.model)
    : configuration.modelProfileId;
}

/** Copies only runtime fields from the template currently offered by the sidebar. */
export function copyPlanConfiguration(
  agent: AgentDefinitionChoice,
): AgentPlanConfiguration {
  const { markdown, parameters, directoryParameter, run } = agent.configuration;
  const modelProfileId = sourceModelId(agent);
  return structuredClone({
    name: agent.name,
    revision: agent.revision,
    modelProfileId,
    model: agent.model,
    provider: agent.provider,
    reasoningEffort: agent.reasoningEffort,
    template: {
      markdown,
      parameters,
      directoryParameter,
      ...(run ? { run } : {}),
    },
  });
}

/** Legacy drafts use their source until the next save pins their configuration. */
export function planStepTemplate(
  step: AgentPlanStep,
  agents: readonly AgentDefinitionChoice[],
): AgentPlanTemplate | undefined {
  return (
    step.configuration?.template ??
    agents.find((agent) => agent.id === step.agentId)?.configuration
  );
}

function sourceModelId(agent: AgentDefinitionChoice): string {
  if (agent.configuration.accessMode !== "personal")
    return agent.modelProfileId ?? agent.id;
  const personal = agent.availability.personalChoices;
  if (personal.length === 1) return personal[0].id;
  return agent.modelProfileId && agent.modelProfileId !== agent.id
    ? agent.modelProfileId
    : "";
}

/**
 * The listed model a node's configuration names.
 *
 * @param models - The models offered for the node's execution target.
 * @param configuration - The node's own configuration.
 * @returns The model under the configuration's selection key; otherwise the
 * version a stored Claude family alias resolves to, together with that alias;
 * `undefined` when the model is not offered, which the node reports instead of
 * switching to another one.
 */
export function planSavedModel(
  models: readonly PageAgentModel[],
  configuration: AgentPlanConfiguration,
): StoredModelMatch<PageAgentModel> | undefined {
  const key = planConfigurationModelKey(configuration);
  const exact = models.find((entry) => entry.id === key);
  if (exact) return { model: exact, alias: null };
  return findSavedModel(models, configuration);
}

/** Offers model routes only for the node's selected execution target. */
export function planTargetModels(
  models: readonly PageAgentModel[],
  target: AgentPlanExecutionTarget | undefined,
): readonly PageAgentModel[] {
  return models.filter((model) =>
    target?.kind === "remote"
      ? model.runnerRoute?.workspaceId === target.workspaceId
      : !model.runnerRoute,
  );
}
