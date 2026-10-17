import { readAgentConfiguration } from "@/backend/agents/AgentConfigurationInput";
import { AgentError } from "@/backend/error/AgentErrors";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";
import { isAgentParameterName } from "@/definition/AgentParameters";
import { logCaughtError } from "@/backend/logging/Logger";

import {
  readParameterRecord,
  requireParameterKeys,
} from "./AgentParameterReader";

import type { AgentParameter } from "@/definition/AgentParameters";

/** Updates retain raw field values until they are validated against the current declaration. */
export type PageAgentParameterChange =
  | { readonly action: "add"; readonly parameter: AgentParameter }
  | {
      readonly action: "update";
      readonly name: string;
      readonly fields: Readonly<Record<string, unknown>>;
    }
  | { readonly action: "remove"; readonly name: string };

/** Reads declarations through the persisted configuration contract of PAGE-55. */
export function readPageAgentParameters(
  input: unknown,
): readonly AgentParameter[] {
  if (!Array.isArray(input) || input.length > 50)
    throw new AgentOperationError("INVALID_REQUEST");
  try {
    return readAgentConfiguration({
      ...emptyAgentConfiguration("person"),
      parameters: input,
    }).parameters;
  } catch (error: unknown) {
    logCaughtError("PageAgentParameterChanges", error);

    if (error instanceof AgentError)
      throw new AgentOperationError("INVALID_REQUEST", {
        reason: "configuration_invalid",
      });
    throw error;
  }
}

function changeName(input: unknown): string {
  if (typeof input !== "string" || !isAgentParameterName(input))
    throw new AgentOperationError("INVALID_REQUEST");
  return input;
}

function readChange(input: unknown): PageAgentParameterChange {
  const change = readParameterRecord(input);
  if (change.action === "add") {
    requireParameterKeys(change, ["action", "parameter"]);
    return {
      action: "add",
      parameter: readPageAgentParameters([change.parameter])[0],
    };
  }
  if (change.action === "remove") {
    requireParameterKeys(change, ["action", "name"]);
    return { action: "remove", name: changeName(change.name) };
  }
  if (change.action !== "update")
    throw new AgentOperationError("INVALID_REQUEST");
  requireParameterKeys(change, ["action", "name", "fields"]);
  const fields = readParameterRecord(change.fields);
  requireParameterKeys(
    fields,
    [],
    ["type", "description", "isRequired", "defaultValue"],
  );
  if (Object.keys(fields).length === 0)
    throw new AgentOperationError("INVALID_REQUEST");
  return { action: "update", name: changeName(change.name), fields };
}

/** Refuses ambiguous batches that name the same parameter more than once. */
export function readPageAgentParameterChanges(
  input: unknown,
): readonly PageAgentParameterChange[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > 50)
    throw new AgentOperationError("INVALID_REQUEST");
  const changes = input.map(readChange);
  const names = changes.map((change) =>
    change.action === "add" ? change.parameter.name : change.name,
  );
  if (new Set(names).size !== names.length)
    throw new AgentOperationError("INVALID_REQUEST");
  return changes;
}

/** Applies a complete batch to the read revision, preserving every unnamed declaration and field. */
export function changePageAgentParameters(
  parameters: readonly AgentParameter[],
  changes: readonly PageAgentParameterChange[] | undefined,
): readonly AgentParameter[] {
  if (changes === undefined) return parameters;
  const proposed = [...parameters];
  for (const change of changes) {
    const name = change.action === "add" ? change.parameter.name : change.name;
    const index = proposed.findIndex((parameter) => parameter.name === name);
    if (change.action === "add") {
      if (index >= 0) throw new AgentOperationError("CONFLICT");
      proposed.push(change.parameter);
    } else {
      if (index < 0) throw new AgentOperationError("CONFLICT");
      if (change.action === "remove") proposed.splice(index, 1);
      else
        proposed[index] = readPageAgentParameters([
          { ...proposed[index], ...change.fields },
        ])[0];
    }
  }
  return readPageAgentParameters(proposed);
}
