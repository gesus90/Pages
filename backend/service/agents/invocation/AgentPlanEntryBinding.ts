import {
  isPlanEntryNode,
  planEntryInputs,
  planPortName,
} from "@/definition/AgentPlanJump";

import type { AgentParameterValue } from "@/definition/AgentParameters";
import type { AgentPlanBinding, AgentPlanInput } from "@/definition/AgentPlan";

/** The values the inputs of every entry of a plan take in one run, by entry and input name. */
export type EntryValues = ReadonlyMap<
  string,
  Readonly<Record<string, AgentParameterValue | null>>
>;

/**
 * The values each entry of a plan offers its consumers in one run.
 * @param plan - The plan whose entries are read.
 * @param called - The entry a call named and the inputs it brought; absent for a start by a person.
 * @remarks
 * An entry that was not called offers the default of each declared input, or
 * nothing when it has none. The called entry offers the validated values of
 * the call, which already contain the defaults.
 */
export function entryValues(
  plan: Pick<AgentPlanInput, "nodes">,
  called?: {
    readonly entryNodeId: string;
    readonly inputs: Readonly<Record<string, AgentParameterValue>>;
  },
): EntryValues {
  const values = new Map<
    string,
    Readonly<Record<string, AgentParameterValue | null>>
  >();
  for (const node of plan.nodes) {
    if (!isPlanEntryNode(node)) continue;
    if (called?.entryNodeId === node.id) {
      values.set(node.id, called.inputs);
      continue;
    }
    values.set(
      node.id,
      Object.fromEntries(
        planEntryInputs(node).map((input) => [input.name, input.defaultValue]),
      ),
    );
  }
  return values;
}

function entryBinding(
  value: unknown,
  values: EntryValues,
): AgentPlanBinding | null {
  if (
    typeof value !== "object" ||
    value === null ||
    !("kind" in value) ||
    value.kind !== "port" ||
    !("nodeId" in value) ||
    typeof value.nodeId !== "string" ||
    !("port" in value) ||
    typeof value.port !== "string"
  )
    return null;
  const entry = values.get(value.nodeId);
  const name = planPortName(value.port, "entry");
  if (entry === undefined || name === null) return null;
  return { kind: "literal", value: entry[name] ?? null };
}

function replaceEntryBindings(value: unknown, values: EntryValues): unknown {
  if (Array.isArray(value))
    return value.map((entry) => replaceEntryBindings(entry, values));
  if (typeof value !== "object" || value === null) return value;
  const binding = entryBinding(value, values);
  if (binding) return binding;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      replaceEntryBindings(entry, values),
    ]),
  );
}

/**
 * Turns every binding that reads an input of an entry into the value of this run.
 * @param plan - The executable plan of one run.
 * @param values - What each entry offers in this run.
 * @returns A copy of the plan; the saved plan is never changed.
 * @remarks
 * The inputs of a call replace the defaults for this run only. A consumer then
 * reads an ordinary literal, so every later step authorizes references,
 * checks types and fills required inputs exactly as for any other value.
 */
export function bindEntryInputs<Plan extends AgentPlanInput>(
  plan: Plan,
  values: EntryValues,
): Plan {
  // The copy has the shape of the plan: only entry port bindings become literals.
  return replaceEntryBindings(plan, values) as Plan;
}
