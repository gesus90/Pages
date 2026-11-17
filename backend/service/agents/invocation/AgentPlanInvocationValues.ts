import { AgentError } from "@/backend/error/AgentErrors";
import { hasAgentParameterValue } from "@/definition/AgentParameters";

import { PLAN_OUTPUT_LIMIT, sanitizePlanOutput } from "../AgentPlanOutput";

import type { AgentParameterValue } from "@/definition/AgentParameters";
import type {
  AgentPlanEntryInput,
  AgentPlanEntryValue,
} from "@/definition/AgentPlanJump";

/** Named values of one call, return or signal. */
export type InvocationValues = Readonly<Record<string, AgentParameterValue>>;

/**
 * Rejects values whose serialized form is longer than a run keeps.
 * @param values - The inputs of a call, the returns of an end or the payload of a signal.
 * @throws {AgentError} `plan_jump_payload_limit` instead of shortening anything.
 */
export function requireInvocationValuesWithinLimit(
  values: InvocationValues,
): void {
  if (JSON.stringify(values).length > PLAN_OUTPUT_LIMIT)
    throw new AgentError("plan_jump_payload_limit");
}

/**
 * Masks credential-shaped text in the values; references and numbers stay as they are.
 * @remarks
 * The size is checked before, so nothing is cut here.
 */
export function redactInvocationValues(
  values: InvocationValues,
): InvocationValues {
  return Object.fromEntries(
    Object.entries(values).map(
      ([name, value]): [string, AgentParameterValue] => [
        name,
        value.type === "text"
          ? { type: "text", text: sanitizePlanOutput(value.text) }
          : value,
      ],
    ),
  );
}

/** Whether the value is one the declaration accepts: its type, a finite number, a non-empty reference. */
function isAcceptedValue(
  declared: AgentPlanEntryValue,
  value: AgentParameterValue,
): boolean {
  if (value.type !== declared.type) return false;
  if (value.type === "number") return Number.isFinite(value.number);
  return value.type === "text" || hasAgentParameterValue(value);
}

/**
 * Applies the declared inputs of an entry to the values a call brings.
 * @param declared - The inputs of the entry as they are now.
 * @param provided - What the calling Jump bound, by input name.
 * @returns The values the called run reads: provided values, else defaults.
 * @throws {AgentError} `plan_jump_input_invalid` for a missing required input
 * or a value of the wrong type, `plan_jump_interface_changed` for a value
 * the entry no longer declares, `plan_jump_payload_limit` for values that are
 * too large.
 * @remarks
 * Only declared inputs are accepted, so a call can never reach into a
 * parameter the target did not release.
 */
export function applyEntryContract(
  declared: readonly AgentPlanEntryInput[],
  provided: Readonly<Record<string, AgentParameterValue | null>>,
): InvocationValues {
  const names = new Set(declared.map((input) => input.name));
  if (
    Object.entries(provided).some(
      ([name, value]) => value !== null && !names.has(name),
    )
  )
    throw new AgentError("plan_jump_interface_changed");
  const values: Record<string, AgentParameterValue> = {};
  for (const input of declared) {
    const value = provided[input.name] ?? input.defaultValue;
    if (value === null) {
      if (input.isRequired) throw new AgentError("plan_jump_input_invalid");
      continue;
    }
    if (!isAcceptedValue(input, value))
      throw new AgentError("plan_jump_input_invalid");
    if (input.isRequired && !hasAgentParameterValue(value))
      throw new AgentError("plan_jump_input_invalid");
    values[input.name] = value;
  }
  requireInvocationValuesWithinLimit(values);
  return redactInvocationValues(values);
}
