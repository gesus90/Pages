import { AgentError } from "@/backend/error/AgentErrors";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";
import { isAgentProvider } from "@/definition/AgentConnection";
import { agentParameterIssues } from "@/definition/AgentParameters";

import { readAgentConfiguration } from "./AgentConfigurationInput";
import { readAgentObject } from "./AgentPayload";

import type { AgentPlanConfiguration } from "@/definition/AgentPlanConfiguration";

/** Validates a secret-free node copy using the same parameter and run-option readers as templates. */
export function readPlanConfiguration(input: unknown): AgentPlanConfiguration {
  const entry = readAgentObject(input);
  const template = readAgentObject(entry.template);
  if (
    typeof entry.revision !== "number" ||
    !Number.isSafeInteger(entry.revision) ||
    entry.revision < 1 ||
    (entry.provider !== null && !isAgentProvider(entry.provider)) ||
    (entry.reasoningEffort !== null &&
      (typeof entry.reasoningEffort !== "string" ||
        entry.reasoningEffort.length > 100))
  )
    throw new AgentError("configuration_invalid");
  const configuration = readAgentConfiguration({
    ...emptyAgentConfiguration(),
    markdown: template.markdown,
    parameters: template.parameters,
    directoryParameter: template.directoryParameter,
    ...(template.run === undefined ? {} : { run: template.run }),
  });
  if (agentParameterIssues(configuration).length > 0)
    throw new AgentError("parameter_invalid");
  return {
    name: readText(entry.name, 200, true),
    revision: entry.revision,
    modelProfileId: readText(entry.modelProfileId, 100, true),
    model: readText(entry.model, 500),
    provider: entry.provider,
    reasoningEffort: entry.reasoningEffort,
    template: {
      markdown: configuration.markdown,
      parameters: configuration.parameters,
      directoryParameter: configuration.directoryParameter,
      ...(template.run === undefined ? {} : { run: configuration.run }),
    },
  };
}

function readText(input: unknown, maximum: number, allowEmpty = false): string {
  if (
    typeof input !== "string" ||
    input.length > maximum ||
    (!allowEmpty && !input.trim())
  )
    throw new AgentError("configuration_invalid");
  return input;
}
