import { readAgentObject } from "@/backend/agents/AgentPayload";
import { AgentError } from "@/backend/error/AgentErrors";
import { isApiProvider, isZaiAccountType } from "@/definition/AgentConnection";
import {
  GLOBAL_CONNECTION_SCOPE,
  isAgentConnectionScopeKind,
  isAgentConnectionScopeMode,
} from "@/definition/AgentConnectionScope";
import { isReasoningEffortToken } from "@/definition/AgentModelCatalog";

import type {
  AgentConnectionInput,
  AgentProviderId,
  ZaiAccountType,
} from "@/definition/AgentConnection";
import type {
  AgentConnectionScope,
  AgentConnectionScopeTarget,
} from "@/definition/AgentConnectionScope";

const MAX_SCOPE_TARGETS = 200;
const MAX_TARGET_ID_LENGTH = 100;

/** Requires a deliberate z.ai account choice, preserving an existing choice on partial updates. */
export function readZaiAccountType(
  input: AgentConnectionInput,
  provider: AgentProviderId,
  previous?: ZaiAccountType,
): ZaiAccountType | undefined {
  if (provider !== "zai") return undefined;
  const choice = input.zaiAccountType ?? previous;
  if (!isZaiAccountType(choice))
    throw new AgentError("zai_account_type_invalid");
  return choice;
}

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

function readScopeTarget(input: unknown): AgentConnectionScopeTarget {
  const target = readAgentObject(input);
  const targetId =
    typeof target.targetId === "string" ? target.targetId.trim() : "";
  if (
    !isAgentConnectionScopeKind(target.kind) ||
    !targetId ||
    targetId.length > MAX_TARGET_ID_LENGTH ||
    /\p{Cc}/u.test(targetId)
  )
    throw new AgentError("connection_scope_invalid");
  return { kind: target.kind, targetId };
}

function readScopeTargets(input: unknown): AgentConnectionScopeTarget[] {
  if (!Array.isArray(input) || input.length > MAX_SCOPE_TARGETS)
    throw new AgentError("connection_scope_invalid");
  const targets = input.map(readScopeTarget);
  return targets.filter(
    (target, index) =>
      targets.findIndex(
        (entry) =>
          entry.kind === target.kind && entry.targetId === target.targetId,
      ) === index,
  );
}

/**
 * Narrows an untrusted usage scope before persistence.
 *
 * @param input - Parsed request content.
 * @returns A scope that is either global without targets or restricted with at
 * least one person, group or department.
 * @throws {AgentError} `connection_scope_invalid` for anything else.
 *
 * @remarks
 * Whether the named targets exist is decided by the repository inside the
 * saving transaction.
 */
export function readAgentConnectionScope(input: unknown): AgentConnectionScope {
  const scope = readAgentObject(input);
  if (!isAgentConnectionScopeMode(scope.mode))
    throw new AgentError("connection_scope_invalid");
  const targets = readScopeTargets(scope.targets ?? []);
  if (scope.mode === "global") {
    if (targets.length > 0) throw new AgentError("connection_scope_invalid");
    return GLOBAL_CONNECTION_SCOPE;
  }
  if (targets.length === 0) throw new AgentError("connection_scope_invalid");
  return { mode: "restricted", targets };
}
