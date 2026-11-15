import { claudePriceModelsSchema } from "@/definition/ClaudePriceModels";
import { readAgentObject } from "@/backend/agents/AgentPayload";
import { AgentError } from "@/backend/error/AgentErrors";
import { isApiProvider, isZaiAccountType } from "@/definition/AgentConnection";
import {
  GLOBAL_CONNECTION_SCOPE,
  isAgentConnectionScopeKind,
  isAgentConnectionScopeMode,
} from "@/definition/AgentConnectionScope";
import { isReasoningEffortToken } from "@/definition/AgentModelCatalog";
import { isCatalogModelId } from "@/backend/agents/catalog/CatalogParsing";

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

/** Accepts only bounded full model IDs for an administrator's OpenRouter mapping. */
export function readOpenCodePriceMapping(
  input: unknown,
  provider: AgentProviderId,
): Readonly<Record<string, string>> | undefined {
  if (input === undefined) return undefined;
  if (provider !== "opencode")
    throw new AgentError("opencode_price_mapping_invalid");
  if (typeof input !== "object" || input === null || Array.isArray(input))
    throw new AgentError("opencode_price_mapping_invalid");
  const pairs = Object.entries(input);
  if (pairs.length > 100)
    throw new AgentError("opencode_price_mapping_invalid");
  const mapping: Record<string, string> = {};
  for (const [model, router] of pairs) {
    if (
      !isCatalogModelId(model) ||
      !model.includes("/") ||
      !isCatalogModelId(router) ||
      !router.includes("/")
    )
      throw new AgentError("opencode_price_mapping_invalid");
    mapping[model] = router;
  }
  return mapping;
}

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

/** Validates admin model mappings while preserving omitted settings on update. */
export function readClaudePriceModels(
  input: unknown,
  provider: AgentProviderId,
): Readonly<Record<string, string>> | undefined {
  if (input === undefined) return undefined;
  if (provider !== "claude_code") throw new AgentError("test_model_invalid");
  const parsed = claudePriceModelsSchema.safeParse(input);
  if (!parsed.success) throw new AgentError("test_model_invalid");
  return parsed.data;
}
