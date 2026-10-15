import type { AgentDefinitionChoice } from "./AgentAvailability";
import type { AgentConfiguration } from "./AgentConfiguration";
import type { AgentProviderId } from "./AgentConnection";
import type { AgentPlanStep } from "./AgentPlan";

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
  readonly model: string;
  readonly provider: AgentProviderId | null;
  readonly reasoningEffort: string | null;
  readonly template: AgentPlanTemplate;
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
