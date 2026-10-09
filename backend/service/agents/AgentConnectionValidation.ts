import { AgentError } from "@/backend/error/AgentErrors";
import { isApiProvider } from "@/definition/AgentConnection";
import { isReasoningEffortToken } from "@/definition/AgentModelCatalog";

import type {
  AgentConnectionInput,
  AgentProviderId,
} from "@/definition/AgentConnection";

export interface ValidatedAgentInput {
  readonly name: string;
  readonly apiKey: string | null;
  readonly testModel: string | null;
  readonly reasoningEffort: string | null;
}

/** Validates lengths and characters without relying on changing provider key prefixes. */
export function validateAgentInput(
  input: AgentConnectionInput,
  provider: AgentProviderId,
): ValidatedAgentInput {
  const name = input.name.trim();
  if (!name) throw new AgentError("name_required");
  if (name.length > 80) throw new AgentError("name_too_long");
  const apiKey = input.apiKey ?? "";
  if (
    apiKey &&
    (!isApiProvider(provider) ||
      apiKey.length > 512 ||
      /[\s\p{Cc}]/u.test(apiKey))
  ) {
    throw new AgentError("api_key_invalid_format");
  }
  return { name, apiKey: apiKey || null, ...validateModelChoice(input) };
}

function validateModelChoice(
  input: AgentConnectionInput,
): Pick<ValidatedAgentInput, "testModel" | "reasoningEffort"> {
  const testModel = input.testModel ?? "";
  if (testModel.length > 200 || /[\s\p{Cc}]/u.test(testModel))
    throw new AgentError("test_model_invalid");
  const reasoningEffort = input.reasoningEffort ?? "";
  if (reasoningEffort && !isReasoningEffortToken(reasoningEffort))
    throw new AgentError("reasoning_effort_invalid");
  return {
    testModel: testModel || null,
    reasoningEffort: reasoningEffort || null,
  };
}
