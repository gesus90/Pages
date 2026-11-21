import { runnerModelRouteSchema } from "@/definition/RunnerExecution";
import { AgentError } from "@/backend/error/AgentErrors";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";
import {
  isAgentProvider,
  isRetiredProviderId,
} from "@/definition/AgentConnection";
import { agentParameterIssues } from "@/definition/AgentParameters";

import { readAgentConfiguration } from "./AgentConfigurationInput";
import { readAgentObject } from "./AgentPayload";

import type { AgentProviderId } from "@/definition/AgentConnection";
import type { AgentPlanConfiguration } from "@/definition/AgentPlanConfiguration";

/** Validates a secret-free node copy using the same parameter and run-option readers as templates. */
export function readPlanConfiguration(input: unknown): AgentPlanConfiguration {
  const entry = readAgentObject(input);
  const template = readAgentObject(entry.template);
  const envelope = readEnvelope(entry);
  const configuration = readAgentConfiguration({
    ...emptyAgentConfiguration(),
    markdown: template.markdown,
    parameters: template.parameters,
    directoryParameter: template.directoryParameter,
    ...(template.run === undefined ? {} : { run: template.run }),
  });
  // Retain removed tokens for node diagnostics and explicit editing of stored plans.
  if (
    agentParameterIssues(configuration).some(
      (issue) => issue !== "unsupportedRunNotes",
    )
  )
    throw new AgentError("parameter_invalid");
  return {
    ...(entry.runnerRoute === undefined
      ? {}
      : { runnerRoute: runnerModelRouteSchema.parse(entry.runnerRoute) }),
    name: readText(entry.name, 200, true),
    revision: envelope.revision,
    modelProfileId: readText(entry.modelProfileId, 1500, true),
    ...(entry.connectionId === undefined
      ? {}
      : { connectionId: readText(entry.connectionId, 100) }),
    model: readText(entry.model, 500, entry.model === ""),
    // A saved node of a retired provider stays editable without a provider; its
    // connection is gone, so the node cannot run until another model is chosen.
    provider: envelope.provider,
    reasoningEffort: envelope.reasoningEffort,
    template: {
      markdown: configuration.markdown,
      parameters: configuration.parameters,
      directoryParameter: configuration.directoryParameter,
      ...(template.run === undefined ? {} : { run: configuration.run }),
    },
  };
}

interface PlanEnvelope {
  readonly revision: number;
  readonly provider: AgentProviderId | null;
  readonly reasoningEffort: string | null;
}

function readEnvelope(entry: ReturnType<typeof readAgentObject>): PlanEnvelope {
  const { revision, provider, reasoningEffort } = entry;
  if (
    typeof revision !== "number" ||
    !Number.isSafeInteger(revision) ||
    revision < 1
  )
    throw new AgentError("configuration_invalid");
  if (
    reasoningEffort !== null &&
    (typeof reasoningEffort !== "string" || reasoningEffort.length > 100)
  )
    throw new AgentError("configuration_invalid");
  if (provider === null || isRetiredProviderId(provider))
    return { revision, provider: null, reasoningEffort };
  if (!isAgentProvider(provider)) throw new AgentError("configuration_invalid");
  return { revision, provider, reasoningEffort };
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
