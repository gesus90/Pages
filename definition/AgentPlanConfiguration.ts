import type { AgentDefinitionChoice } from "./AgentAvailability";
import type { AgentConfiguration } from "./AgentConfiguration";
import type { AgentProviderId } from "./AgentConnection";
import type { AgentPlanStep } from "./AgentPlan";
import type { PageAgentModel } from "./PageAgent";
import { defaultAgentRunOptions } from "./AgentConfiguration";

/** Runtime content without usage grants, connections or credentials. */
export type AgentPlanTemplate = Pick<
  AgentConfiguration,
  "markdown" | "parameters" | "directoryParameter" | "run"
>;

/** A node owns this copy; the source revision records where it originated. */
export interface AgentPlanConfiguration {
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
    name: model.model.slice(0, 200),
    revision: 1,
    modelProfileId: model.id,
    ...(model.connectionId ? { connectionId: model.connectionId } : {}),
    model: model.model,
    provider: model.provider,
    reasoningEffort: null,
    template: {
      markdown: "",
      parameters: [
        {
          name: "workspace",
          description: "",
          type: "workspace",
          isRequired: true,
          defaultValue: null,
        },
      ],
      directoryParameter: "workspace",
      run: defaultAgentRunOptions(model.provider),
    },
  };
}

/** The catalog key of a saved direct selection, preserving legacy identifiers otherwise. */
export function planConfigurationModelKey(
  configuration: AgentPlanConfiguration,
): string {
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
