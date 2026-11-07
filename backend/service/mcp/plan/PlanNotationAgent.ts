import { copyPlanConfiguration } from "@/definition/AgentPlanConfiguration";
import { allPlanSteps } from "@/definition/AgentPlanGroup";

import {
  planNotationTarget,
  resolvedAttribute,
  targetAttribute,
} from "./PlanNotationContext";

import type { AgentPlanConfiguration } from "@/definition/AgentPlanConfiguration";
import type { AgentPlanExecutionTarget } from "@/definition/AgentPlanExecution";
import type { PlanNotationAttributes } from "./PlanNotationAttributes";
import type { PlanNotationContext } from "./PlanNotationContext";

/** The short forms that change an agent's configuration copy; together they stand for `configuration`. */
export const PLAN_NOTATION_CONFIGURATION_KEYS = [
  "model",
  "provider",
  "reasoning",
  "name",
] as const;

/** The word of `personalAgent` that chooses the personal agent automatically. */
export const PLAN_NOTATION_AUTOMATIC = "auto";

/** The checks of a completion gate, comma-separated, without empty entries. */
export function planNotationList(text: string): readonly string[] {
  return text
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

/**
 * The configuration a node of this identifier and agent starts from.
 *
 * @remarks
 * As the save of the editor does: a node that kept its agent keeps its
 * stored copy; any other node takes the copy of its agent as offered now.
 */
export function planNotationBaseConfiguration(
  context: Pick<PlanNotationContext, "previous" | "sources">,
  node: { readonly id: string; readonly agentId: string },
): AgentPlanConfiguration | undefined {
  const saved = context.previous
    ? allPlanSteps(context.previous).find((step) => step.id === node.id)
    : undefined;
  if (saved?.agentId === node.agentId && saved.configuration)
    return structuredClone(saved.configuration);
  const agent = context.sources.agents.find(
    (entry) => entry.id === node.agentId,
  );
  return agent ? copyPlanConfiguration(agent) : undefined;
}

function readAgentId(
  attributes: PlanNotationAttributes,
  context: PlanNotationContext,
): string | undefined {
  const form = attributes.form(["agent"], "agentId");
  if (form === "long") return attributes.text("agentId");
  if (form === "short")
    return resolvedAttribute(attributes, "agent", (text) =>
      context.names.agent(text),
    );
  // An agent node names its agent; both forms at once were reported already.
  if (!attributes.has("agentId")) attributes.invalid("agent");
  return undefined;
}

function readPersonalAgent(
  attributes: PlanNotationAttributes,
  context: PlanNotationContext,
  agentId: string,
): string | null | undefined {
  const form = attributes.form(["personalAgent"], "personalAgentId");
  if (form === "long") return attributes.text("personalAgentId");
  if (form !== "short") return null;
  if (attributes.value("personalAgent")?.text === PLAN_NOTATION_AUTOMATIC)
    return null;
  return resolvedAttribute(attributes, "personalAgent", (text) =>
    context.names.personalAgent(agentId, text),
  );
}

function readCompletionGate(attributes: PlanNotationAttributes): unknown {
  const form = attributes.form(["checks"], "completionGate");
  if (form === "long") return attributes.json("completionGate");
  if (form !== "short") return undefined;
  return {
    version: 1,
    requiredChecks: planNotationList(attributes.text("checks") ?? ""),
  };
}

/** Applies `model` and `provider` to a copy, as a model change in the editor does. */
function withModel(
  configuration: AgentPlanConfiguration,
  attributes: PlanNotationAttributes,
  input: {
    readonly context: PlanNotationContext;
    readonly target: AgentPlanExecutionTarget;
  },
): AgentPlanConfiguration {
  const { names } = input.context;
  const key = attributes.has("model") ? "model" : "provider";
  const provider = attributes.text("provider") ?? null;
  const requested = attributes.text("model") ?? configuration.model;
  const resolution = names.model(input.target, requested, provider);
  if (!("id" in resolution)) {
    attributes.report(
      attributes.at(key),
      resolution.code,
      resolution.candidates,
    );
    return configuration;
  }
  const model = names.findModel(input.target, resolution.id);
  if (!model) return configuration;
  // Absent route facts stay absent: the plan reader drops undefined fields.
  return {
    ...configuration,
    runnerRoute: model.runnerRoute,
    modelProfileId: model.id,
    connectionId: model.connectionId,
    model: model.model,
    provider: model.provider,
  };
}

/**
 * The configuration copy of an agent node.
 *
 * @remarks
 * `configuration` takes the whole copy as JSON. Otherwise the node starts
 * from {@link planNotationBaseConfiguration}; `model` and `provider` choose
 * another model of its target, `reasoning` the reasoning level (empty for
 * none) and `name` the name of the copy.
 */
function readConfiguration(
  attributes: PlanNotationAttributes,
  context: PlanNotationContext,
  node: {
    readonly id: string;
    readonly agentId: string;
    readonly target: unknown;
  },
): unknown {
  const form = attributes.form(
    PLAN_NOTATION_CONFIGURATION_KEYS,
    "configuration",
  );
  if (form === "long") return attributes.json("configuration");
  let configuration = planNotationBaseConfiguration(context, node);
  if (form === null) return configuration;
  if (!configuration) {
    attributes.report(attributes.at("model"), "invalid_value");
    for (const key of PLAN_NOTATION_CONFIGURATION_KEYS) attributes.value(key);
    return undefined;
  }
  if (attributes.has("model") || attributes.has("provider"))
    configuration = withModel(configuration, attributes, {
      context,
      target: planNotationTarget(node.target, context),
    });
  const reasoning = attributes.text("reasoning");
  const name = attributes.text("name");
  return {
    ...configuration,
    ...(reasoning === undefined
      ? {}
      : { reasoningEffort: reasoning === "" ? null : reasoning }),
    ...(name === undefined ? {} : { name }),
  };
}

/**
 * Reads the fields of an agent node, without its bindings.
 *
 * @param attributes - The attributes of the node.
 * @param context - Resolves names and holds the stored plan.
 * @param id - The identifier of the node.
 * @returns The raw fields; the plan reader checks them.
 */
export function readPlanNotationAgent(
  attributes: PlanNotationAttributes,
  context: PlanNotationContext,
  id: string,
): Record<string, unknown> {
  const agentId = readAgentId(attributes, context) ?? "";
  const target = targetAttribute(attributes, context);
  const completion = attributes.choice("completion", ["report", "todos"]);
  return {
    agentId,
    personalAgentId: readPersonalAgent(attributes, context, agentId),
    instruction: attributes.text("instruction") ?? "",
    ...(target === undefined ? {} : { executionTarget: target }),
    ...(completion === "todos" ? { completion } : {}),
    completionGate: readCompletionGate(attributes),
    role: attributes.choice("role", ["closeout"]),
    configuration: readConfiguration(attributes, context, {
      id,
      agentId,
      target,
    }),
  };
}
