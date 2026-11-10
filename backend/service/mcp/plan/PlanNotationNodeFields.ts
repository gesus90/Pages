import { randomUUID } from "node:crypto";

import { PLAN_GIT_CLOSEOUT_TIMEOUT } from "@/definition/AgentPlanGitCloseout";
import { PLAN_LOOP_RUNS } from "@/definition/AgentPlanLoop";
import { PLAN_SCRIPT_TIMEOUT } from "@/definition/AgentPlanScript";

import { readPlanNotationAgent, planNotationList } from "./PlanNotationAgent";
import {
  planNotationTarget,
  resolvedAttribute,
  targetAttribute,
  typedAttribute,
} from "./PlanNotationContext";

import type { AgentParameterValue } from "@/definition/AgentParameters";
import type { AgentPlanStack } from "@/definition/AgentPlanStack";
import type { PlanNotationAttributes } from "./PlanNotationAttributes";
import type { PlanNotationContext } from "./PlanNotationContext";
import type { PlanNotationNodeType } from "./PlanNotationVocabulary";

/** The value types of a parameter node, as `valueType` names them. */
const VALUE_TYPES = ["text", "number", "ticket", "workspace", "wiki"] as const;

/** Reads the fields of one node type from its attributes. */
type FieldReader = (
  attributes: PlanNotationAttributes,
  context: PlanNotationContext,
  id: string,
) => Record<string, unknown>;

/** A name that defaults to the node's identifier, as most cards need one. */
function nameOrId(attributes: PlanNotationAttributes, id: string): string {
  return attributes.text("name") ?? id;
}

/** A whole number under its short or long name, or the default. */
function timeout(
  attributes: PlanNotationAttributes,
  initial: number,
): number | undefined {
  const form = attributes.form(["timeout"], "timeoutSeconds");
  if (form === null) return initial;
  return attributes.integer(form === "short" ? "timeout" : "timeoutSeconds");
}

/** A list written as JSON when it starts with `[`, else as comma-separated words. */
function listAttribute(
  attributes: PlanNotationAttributes,
  key: string,
): { readonly json: unknown } | { readonly words: readonly string[] } | null {
  const text = attributes.text(key);
  if (text === undefined) return null;
  return text.trimStart().startsWith("[")
    ? { json: attributes.json(key) }
    : { words: planNotationList(text) };
}

/** `inputs="ticket!,goal"`: `!` marks a required input. */
function scriptInputs(attributes: PlanNotationAttributes): unknown {
  const list = listAttribute(attributes, "inputs");
  if (list === null) return [];
  if ("json" in list) return list.json;
  return list.words.map((word) => ({
    name: word.endsWith("!") ? word.slice(0, -1) : word,
    type: "text",
    isRequired: word.endsWith("!"),
  }));
}

/** `outputs="ok:gate"`: `:gate` or `:report` chooses the policy of the output. */
function scriptOutputs(attributes: PlanNotationAttributes): unknown {
  const list = listAttribute(attributes, "outputs");
  if (list === null) return [];
  if ("json" in list) return list.json;
  return list.words.map((word) => {
    const [name = "", policy] = word.split(":");
    if (policy !== undefined && policy !== "gate" && policy !== "report")
      attributes.invalid("outputs");
    return { name, type: "text", ...(policy ? { policy } : {}) };
  });
}

function readScript(
  attributes: PlanNotationAttributes,
  context: PlanNotationContext,
  id: string,
): Record<string, unknown> {
  const target = targetAttribute(attributes, context);
  const form = attributes.form(["interpreter"], "interpreterProfileId");
  const interpreter =
    form === "long"
      ? attributes.text("interpreterProfileId")
      : resolvedAttribute(attributes, "interpreter", (text) =>
          context.names.interpreter(planNotationTarget(target, context), text),
        );
  return {
    name: nameOrId(attributes, id),
    ...(target === undefined ? {} : { executionTarget: target }),
    role: attributes.choice("role", ["closeout"]),
    interpreterProfileId: interpreter ?? "",
    content: attributes.text("content") ?? "",
    inputs: scriptInputs(attributes),
    outputs: scriptOutputs(attributes),
    timeoutSeconds: timeout(attributes, PLAN_SCRIPT_TIMEOUT.initial),
  };
}

function readGitCloseout(
  attributes: PlanNotationAttributes,
  context: PlanNotationContext,
  id: string,
): Record<string, unknown> {
  const form = attributes.form(["check"], "checkCommand");
  return {
    name: nameOrId(attributes, id),
    checkCommand:
      attributes.text(form === "long" ? "checkCommand" : "check") ?? "",
    timeoutSeconds: timeout(attributes, PLAN_GIT_CLOSEOUT_TIMEOUT.initial),
  };
}

function readTask(
  attributes: PlanNotationAttributes,
  context: PlanNotationContext,
): Record<string, unknown> {
  const form = attributes.form(["ticket"], "taskId");
  if (form === "long") return { taskId: attributes.text("taskId") };
  if (form === null && !attributes.has("taskId")) attributes.invalid("ticket");
  return {
    taskId: resolvedAttribute(attributes, "ticket", (text) =>
      context.names.ticket(text),
    ),
  };
}

/** The value of a parameter node; `valueType` decides how `value` is read. */
function parameterValue(
  attributes: PlanNotationAttributes,
  context: PlanNotationContext,
): AgentParameterValue | undefined {
  const written = attributes.value("value");
  const type =
    attributes.choice("valueType", VALUE_TYPES) ??
    (written?.kind === "number" ? "number" : "text");
  if (written === undefined && type === "text") return { type, text: "" };
  if (written === undefined) attributes.invalid("value");
  return typedAttribute(attributes, "value", { type, context });
}

function readParameter(
  attributes: PlanNotationAttributes,
  context: PlanNotationContext,
  id: string,
): Record<string, unknown> {
  const value = parameterValue(attributes, context);
  return {
    name: nameOrId(attributes, id),
    format:
      attributes.choice("format", ["string", "number", "json", "boolean"]) ??
      (value?.type === "number" ? "number" : "string"),
    value,
  };
}

/** The settings of a decision (PAGE-286); its data input is an edge `[in=condition]`. */
function readDecision(
  attributes: PlanNotationAttributes,
): Record<string, unknown> {
  const mode = attributes.choice("mode", ["boolean", "model"]);
  const output = attributes.choice("output", ["boolean", "classification"]);
  return {
    ...(attributes.has("name") ? { name: attributes.text("name") } : {}),
    ...(mode === undefined ? {} : { mode }),
    ...(attributes.has("question")
      ? { question: attributes.text("question") }
      : {}),
    ...(attributes.has("model") ? { model: attributes.json("model") } : {}),
    ...(output === undefined ? {} : { output }),
    ...(attributes.has("cases") ? { cases: attributes.json("cases") } : {}),
  };
}

/** Keeps the entry identifiers of a stored stack for the tickets it still holds. */
function stackEntries(
  attributes: PlanNotationAttributes,
  context: PlanNotationContext,
  id: string,
): unknown {
  const list = listAttribute(attributes, "entries");
  if (list === null) return [];
  if ("json" in list) return list.json;
  const stored = context.previous?.nodes.find(
    (node): node is AgentPlanStack => node.type === "stack" && node.id === id,
  );
  const unused = [...(stored?.entries ?? [])];
  return list.words.flatMap((word) => {
    const resolution = context.names.ticket(word);
    if (!("id" in resolution)) {
      attributes.report(
        attributes.at("entries"),
        resolution.code,
        resolution.candidates,
      );
      return [];
    }
    const index = unused.findIndex(
      (entry) => entry.type === "task" && entry.taskId === resolution.id,
    );
    const [kept] = index < 0 ? [] : unused.splice(index, 1);
    return [
      { id: kept?.id ?? randomUUID(), type: "task", taskId: resolution.id },
    ];
  });
}

function readStack(
  attributes: PlanNotationAttributes,
  context: PlanNotationContext,
  id: string,
): Record<string, unknown> {
  return {
    name: nameOrId(attributes, id),
    entries: stackEntries(attributes, context, id),
  };
}

function readLoop(
  attributes: PlanNotationAttributes,
  context: PlanNotationContext,
  id: string,
): Record<string, unknown> {
  const session = attributes.form(["session"], "sessionPolicy");
  const sessionPolicy = attributes.choice(
    session === "long" ? "sessionPolicy" : "session",
    ["reuse", "fresh"],
  );
  const mode = attributes.choice("mode", ["count", "while"]);
  const whileCheck = attributes.json("while");
  return {
    name: nameOrId(attributes, id),
    runs: attributes.integer("runs") ?? PLAN_LOOP_RUNS.initial,
    runsSource:
      attributes.choice("runsSource", ["value", "parameter"]) ?? "value",
    countMode: attributes.choice("countMode", ["max", "expected"]) ?? "max",
    sessionPolicy: sessionPolicy ?? "reuse",
    condition: attributes.has("condition")
      ? attributes.json("condition")
      : null,
    ...(mode === undefined ? {} : { mode }),
    ...(whileCheck === undefined ? {} : { while: whileCheck }),
    edges: [],
  };
}

function readGroup(
  attributes: PlanNotationAttributes,
  context: PlanNotationContext,
  id: string,
): Record<string, unknown> {
  return {
    name: nameOrId(attributes, id),
    // Legacy boundary inputs of older groups, kept so such a plan writes back unchanged.
    parameters: attributes.has("parameters")
      ? attributes.json("parameters")
      : [],
    edges: [],
  };
}

const FIELD_READERS: Readonly<Record<PlanNotationNodeType, FieldReader>> = {
  start: () => ({}),
  end: () => ({}),
  agent: readPlanNotationAgent,
  script: readScript,
  git_closeout: readGitCloseout,
  task: (attributes, context) => readTask(attributes, context),
  parameter: readParameter,
  group: readGroup,
  loop: readLoop,
  stack: readStack,
  asset: (attributes, context, id) => ({
    name: nameOrId(attributes, id),
    file: attributes.has("file") ? attributes.json("file") : null,
  }),
  decision: readDecision,
  variable: (attributes) => ({ name: attributes.text("name") }),
};

/**
 * Reads the fields of a node of a type, without its bindings and members.
 *
 * @param type - The node type.
 * @param attributes - The attributes of the node.
 * @param context - Resolves names and holds the stored plan.
 * @param id - The identifier of the node.
 * @returns The raw fields; the plan reader checks them.
 */
export function readPlanNotationFields(
  type: PlanNotationNodeType,
  attributes: PlanNotationAttributes,
  context: PlanNotationContext,
  id: string,
): Record<string, unknown> {
  return FIELD_READERS[type](attributes, context, id);
}
