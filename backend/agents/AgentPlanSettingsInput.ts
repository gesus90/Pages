import { AgentError } from "@/backend/error/AgentErrors";
import { isAgentParameterName } from "@/definition/AgentParameters";

import { readAgentTargets } from "./AgentConfigurationInput";
import { readAgentObject } from "./AgentPayload";

import type { AgentPlanInput } from "@/definition/AgentPlan";

/**
 * Reads a plan or a part of it as a JSON object; arrays and scalars are rejected.
 *
 * @param input - Untrusted value received from a client or from storage.
 * @returns The object with its keys read as text.
 */
export function readPlanObject(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    throw new AgentError("plan_invalid");
  return readAgentObject(input);
}

/** Parses the sharing of a plan, the same way whether the whole plan or only this part is read. */
export function readPlanSharing(
  input: unknown,
): NonNullable<AgentPlanInput["sharing"]> {
  const sharing = readPlanObject(input);
  const targets = readAgentTargets(sharing.targets);
  const operator = sharing.operator === undefined ? "or" : sharing.operator;
  if (
    typeof sharing.isGlobal !== "boolean" ||
    (operator !== "or" && operator !== "and") ||
    targets.some(
      (target) => target.kind !== "group" && target.kind !== "department",
    )
  )
    throw new AgentError("plan_invalid");
  return { isGlobal: sharing.isGlobal, targets, operator };
}

/** Parses the plan globals: parameter names with bounded texts, at most 64 of them. */
export function readGlobals(input: unknown): Readonly<Record<string, string>> {
  const globals = readPlanObject(input);
  if (Object.keys(globals).length > 64) throw new AgentError("plan_invalid");
  return Object.fromEntries(
    Object.entries(globals).map(([name, text]) => {
      if (
        !isAgentParameterName(name) ||
        typeof text !== "string" ||
        text.length > 200000
      )
        throw new AgentError("plan_invalid");
      return [name, text];
    }),
  );
}

/** Parses the one-time mark; only `true` is stored, so a normal plan keeps its stored form. */
export function readOneShot(input: unknown): Pick<AgentPlanInput, "oneShot"> {
  if (input === undefined || input === false) return {};
  if (input !== true) throw new AgentError("plan_invalid");
  return { oneShot: true };
}
