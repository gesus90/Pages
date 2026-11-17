import { AgentError } from "@/backend/error/AgentErrors";

import { planBindings } from "../AgentPlanBindings";
import {
  redactInvocationValues,
  requireInvocationValuesWithinLimit,
} from "./AgentPlanInvocationValues";

import type {
  AgentParameter,
  AgentParameterValue,
} from "@/definition/AgentParameters";
import type { AgentPlanBinding } from "@/definition/AgentPlan";
import type { AgentPlanEntryValue } from "@/definition/AgentPlanJump";
import type { ActivePlanRun } from "../AgentPlanRunState";
import type { InvocationValues } from "./AgentPlanInvocationValues";

function asParameter(declared: AgentPlanEntryValue): AgentParameter {
  return {
    name: declared.name,
    type: declared.type,
    description: "",
    isRequired: false,
    defaultValue: null,
  };
}

/** The text of a succeeded node, which a result binding hands on. */
function resultValue(
  active: ActivePlanRun,
  stepId: string,
): AgentParameterValue | null {
  const result = active.view.steps.find((step) => step.id === stepId);
  return result?.status === "succeeded"
    ? { type: "text", text: result.output ?? "" }
    : null;
}

/** A value an earlier outgoing Jump of this run handed on. */
function portValue(
  active: ActivePlanRun,
  binding: Extract<AgentPlanBinding, { kind: "port" }>,
): AgentParameterValue | null {
  const result = active.view.steps.find((step) => step.id === binding.nodeId);
  if (result?.status !== "succeeded") return null;
  return result.jumpOutputs?.[binding.port] ?? null;
}

function bindingValue(
  active: ActivePlanRun,
  name: string,
  binding: AgentPlanBinding,
  declared: AgentPlanEntryValue,
): AgentParameterValue | null {
  if (binding.kind === "previous" || binding.kind === "stack")
    throw new AgentError("plan_jump_input_invalid");
  if (binding.kind === "result") return resultValue(active, binding.stepId);
  if (binding.kind === "port") return portValue(active, binding);
  const values = planBindings(
    active.snapshot.plan,
    { bindings: { [name]: binding } },
    [],
    [asParameter(declared)],
  );
  return values[name] ?? null;
}

/**
 * Reads the values a Jump, an end or a signal hands on from its bindings.
 * @param active - The run the node belongs to.
 * @param declared - The values the node declares, by name.
 * @param bindings - The bindings of the node.
 * @returns The values that are available; a value whose source has no result yet is absent.
 * @throws {AgentError} `plan_jump_input_invalid` for a value of another type than declared,
 * `plan_jump_payload_limit` for values that are too large.
 * @remarks
 * Literals, plan values, tickets and files are read from the frozen plan,
 * results and returned values from the run itself. Nothing is read from a
 * binding the node does not declare.
 */
export function resolveNodeValues(
  active: ActivePlanRun,
  declared: readonly AgentPlanEntryValue[],
  bindings: Readonly<Record<string, AgentPlanBinding>>,
): Readonly<Record<string, AgentParameterValue | null>> {
  const values: Record<string, AgentParameterValue | null> = {};
  for (const [name, binding] of Object.entries(bindings)) {
    const entry = declared.find((value) => value.name === name);
    if (!entry) throw new AgentError("plan_jump_interface_changed");
    const value = bindingValue(active, name, binding, entry);
    if (value !== null && value.type !== entry.type)
      throw new AgentError("plan_jump_input_invalid");
    values[name] = value;
  }
  const present: Record<string, AgentParameterValue> = {};
  for (const [name, value] of Object.entries(values))
    if (value !== null) present[name] = value;
  requireInvocationValuesWithinLimit(present);
  return values;
}

/** Applies the credential filter to resolved values and drops the missing ones. */
export function presentValues(
  values: Readonly<Record<string, AgentParameterValue | null>>,
): InvocationValues {
  const present: Record<string, AgentParameterValue> = {};
  for (const [name, value] of Object.entries(values))
    if (value !== null) present[name] = value;
  return redactInvocationValues(present);
}
