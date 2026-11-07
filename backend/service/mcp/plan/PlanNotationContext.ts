import { planExecutionTargetSchema } from "@/definition/AgentPlanExecution";

import type { AgentParameterValue } from "@/definition/AgentParameters";
import type { AgentPlanInput, AgentPlanSources } from "@/definition/AgentPlan";
import type { AgentPlanExecutionTarget } from "@/definition/AgentPlanExecution";
import type {
  PlanNotationAttributes,
  PlanNotationFindings,
} from "./PlanNotationAttributes";
import type {
  PlanNotationNames,
  PlanNotationResolution,
} from "./PlanNotationNames";

/** Everything the reader of one notation works with besides the notation. */
export interface PlanNotationContext {
  readonly names: PlanNotationNames;
  readonly sources: AgentPlanSources;
  /** The stored plan when a plan is replaced; its configurations and stack entries are kept. */
  readonly previous: AgentPlanInput | null;
  /** Where nodes without their own target run: the plan target or the Pages host. */
  readonly planTarget: AgentPlanExecutionTarget;
  readonly findings: PlanNotationFindings;
}

/**
 * Reads a name of an attribute and reports a name that resolves to nothing or to several objects.
 *
 * @param attributes - The attributes the key belongs to.
 * @param key - The attribute.
 * @param resolve - The lookup of the name.
 * @returns The identifier, or `undefined` for an absent key or a finding.
 */
export function resolvedAttribute(
  attributes: PlanNotationAttributes,
  key: string,
  resolve: (value: string) => PlanNotationResolution,
): string | undefined {
  const text = attributes.text(key);
  if (text === undefined) return undefined;
  const resolution = resolve(text);
  if ("id" in resolution) return resolution.id;
  attributes.report(attributes.at(key), resolution.code, resolution.candidates);
  return undefined;
}

/**
 * Reads a value of a given type: text, a number or the name of a ticket, workspace or wiki page.
 *
 * @param attributes - The attributes the key belongs to.
 * @param key - The attribute.
 * @param input - The type the value must have, and the context that resolves names.
 * @returns The value, or `undefined` for an absent key or a finding.
 */
export function typedAttribute(
  attributes: PlanNotationAttributes,
  key: string,
  input: {
    readonly type: AgentParameterValue["type"];
    readonly context: PlanNotationContext;
  },
): AgentParameterValue | undefined {
  const { names } = input.context;
  switch (input.type) {
    case "text": {
      const text = attributes.text(key);
      return text === undefined ? undefined : { type: "text", text };
    }
    case "number": {
      const value = attributes.value(key);
      if (value === undefined) return undefined;
      const number = Number(value.text);
      if (value.text.trim() !== "" && Number.isFinite(number))
        return { type: "number", number };
      attributes.invalid(key);
      return undefined;
    }
    case "ticket": {
      const id = resolvedAttribute(attributes, key, (text) =>
        names.ticket(text),
      );
      return id === undefined ? undefined : { type: "ticket", ticketId: id };
    }
    case "workspace": {
      const id = resolvedAttribute(attributes, key, (text) =>
        names.workspace(text),
      );
      return id === undefined
        ? undefined
        : { type: "workspace", workspaceId: id };
    }
    case "wiki": {
      const id = resolvedAttribute(attributes, key, (text) => names.wiki(text));
      return id === undefined ? undefined : { type: "wiki", pageId: id };
    }
  }
}

/**
 * Reads the execution target of the plan or a node: `local` or a remote workspace of the project.
 *
 * @param attributes - The attributes with `target` and `executionTarget`.
 * @param context - Resolves the name of a remote workspace.
 * @returns The target as stored, `undefined` when absent or invalid.
 */
export function targetAttribute(
  attributes: PlanNotationAttributes,
  context: Pick<PlanNotationContext, "names">,
): unknown {
  const form = attributes.form(["target"], "executionTarget");
  if (form === "long") return attributes.json("executionTarget");
  if (form !== "short") return undefined;
  if (attributes.value("target")?.text === "local") return { kind: "local" };
  const workspaceId = resolvedAttribute(attributes, "target", (text) =>
    context.names.remoteTarget(text),
  );
  return workspaceId === undefined
    ? undefined
    : { kind: "remote", workspaceId };
}

/**
 * The target that decides which models and interpreters a node may use.
 *
 * @param target - The node's own target as read, possibly invalid or absent.
 * @param context - Holds the plan target that applies otherwise.
 */
export function planNotationTarget(
  target: unknown,
  context: Pick<PlanNotationContext, "planTarget">,
): AgentPlanExecutionTarget {
  const parsed = planExecutionTargetSchema.safeParse(target);
  return parsed.success ? parsed.data : context.planTarget;
}
