import { PLAN_GIT_CLOSEOUT_TIMEOUT } from "@/definition/AgentPlanGitCloseout";
import {
  PLAN_LOOP_RUNS,
  PLAN_LOOP_RUNS_BINDING,
  PLAN_LOOP_WHILE_BINDING,
} from "@/definition/AgentPlanLoop";
import { PLAN_SCRIPT_TIMEOUT } from "@/definition/AgentPlanScript";

import {
  planNotationAgentEntries,
  planNotationTargetEntries,
} from "./PlanNotationAgentWriter";
import {
  jsonEntry,
  planNotationNumber,
  textEntry,
  wordEntry,
} from "./PlanNotationFormat";

import type { AgentParameterValue } from "@/definition/AgentParameters";
import type { AgentPlanNode, AgentPlanParameter } from "@/definition/AgentPlan";
import type { AgentPlanGitCloseout } from "@/definition/AgentPlanGitCloseout";
import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";
import type { AgentPlanLoop } from "@/definition/AgentPlanLoop";
import type { AgentPlanScript } from "@/definition/AgentPlanScript";
import type { AgentPlanStack } from "@/definition/AgentPlanStack";
import type { PlanNotationWriterContext } from "./PlanNotationAgentWriter";
import type { PlanNotationEntry } from "./PlanNotationFormat";

/** A name that is the node's identifier is the default and is not written. */
function nameEntries(name: string, id: string): readonly PlanNotationEntry[] {
  return name === id ? [] : [textEntry("name", name)];
}

/** Whether words can stand in a comma-separated list and read back unchanged. */
function isListable(words: readonly string[]): boolean {
  return words.every(
    (word) => word !== "" && word === word.trim() && !/[,:!]/u.test(word),
  );
}

/**
 * Writes a value of a given type by name: a ticket key, a workspace name or a wiki title.
 *
 * @returns The value as a word, or `null` when no name reads back to it.
 */
export function planNotationValueText(
  value: AgentParameterValue,
  context: PlanNotationWriterContext,
): PlanNotationEntry["value"] | null {
  const { names } = context;
  switch (value.type) {
    case "text":
      return textEntry("", value.text).value;
    case "number":
      return planNotationNumber(value.number);
    case "ticket": {
      const key = names.ticketKey(value.ticketId);
      return key === value.ticketId ? null : wordEntry("", key).value;
    }
    case "workspace": {
      const name = names.workspaceName(value.workspaceId);
      return name === value.workspaceId ? null : wordEntry("", name).value;
    }
    case "wiki": {
      const title = names.wikiTitle(value.pageId);
      return title === value.pageId ? null : wordEntry("", title).value;
    }
  }
}

/** The identifier a reference value holds, written when no name reads back to it. */
function referenceId(value: AgentParameterValue): string {
  switch (value.type) {
    case "text":
      return value.text;
    case "number":
      return String(value.number);
    case "ticket":
      return value.ticketId;
    case "workspace":
      return value.workspaceId;
    case "wiki":
      return value.pageId;
  }
}

function parameterEntries(
  node: AgentPlanParameter,
  context: PlanNotationWriterContext,
): readonly PlanNotationEntry[] {
  const { value } = node;
  const text =
    planNotationValueText(value, context) ??
    textEntry("value", referenceId(value)).value;
  // Only a bare number reads as a number without `valueType`.
  const impliedType =
    value.type === "number" && !text.startsWith('"') ? "number" : "text";
  const impliedFormat = value.type === "number" ? "number" : "string";
  return [
    ...nameEntries(node.name, node.id),
    ...(node.format === impliedFormat
      ? []
      : [wordEntry("format", node.format)]),
    ...(value.type === impliedType ? [] : [wordEntry("valueType", value.type)]),
    { key: "value", value: text },
  ];
}

function scriptEntries(
  node: AgentPlanScript,
  context: PlanNotationWriterContext,
): readonly PlanNotationEntry[] {
  const target = node.executionTarget ??
    context.plan.executionTarget ?? { kind: "local" as const };
  const interpreter = context.names.interpreterName(
    target,
    node.interpreterProfileId,
  );
  const inputs = node.inputs.map(
    (input) => `${input.name}${input.isRequired ? "!" : ""}`,
  );
  const outputs = node.outputs.map(
    (output) => `${output.name}${output.policy ? `:${output.policy}` : ""}`,
  );
  return [
    ...nameEntries(node.name, node.id),
    ...planNotationTargetEntries(node.executionTarget, context.names),
    ...(node.role ? [wordEntry("role", node.role)] : []),
    interpreter === null
      ? textEntry("interpreterProfileId", node.interpreterProfileId)
      : wordEntry("interpreter", interpreter),
    textEntry("content", node.content),
    ...listEntries("inputs", node.inputs, inputs),
    ...listEntries("outputs", node.outputs, outputs),
    ...(node.timeoutSeconds === PLAN_SCRIPT_TIMEOUT.initial
      ? []
      : [{ key: "timeout", value: planNotationNumber(node.timeoutSeconds) }]),
  ];
}

/** A list of inputs or outputs: comma-separated when its names allow, JSON otherwise. */
function listEntries(
  key: string,
  entries: readonly { readonly name: string }[],
  words: readonly string[],
): readonly PlanNotationEntry[] {
  if (entries.length === 0) return [];
  return isListable(entries.map((entry) => entry.name))
    ? [textEntry(key, words.join(","))]
    : [jsonEntry(key, entries)];
}

function closeoutEntries(
  node: AgentPlanGitCloseout,
): readonly PlanNotationEntry[] {
  return [
    ...nameEntries(node.name, node.id),
    ...(node.checkCommand === ""
      ? []
      : [textEntry("check", node.checkCommand)]),
    ...(node.timeoutSeconds === PLAN_GIT_CLOSEOUT_TIMEOUT.initial
      ? []
      : [{ key: "timeout", value: planNotationNumber(node.timeoutSeconds) }]),
  ];
}

function stackEntries(
  node: AgentPlanStack,
  context: PlanNotationWriterContext,
): readonly PlanNotationEntry[] {
  const keys = node.entries.map((entry) =>
    entry.type === "task" ? context.names.ticketKey(entry.taskId) : null,
  );
  const isShort =
    keys.every((key, index) => {
      const entry = node.entries[index];
      return key !== null && entry?.type === "task" && key !== entry.taskId;
    }) && isListable(keys.flatMap((key) => (key === null ? [] : [key])));
  return [
    ...nameEntries(node.name, node.id),
    ...(node.entries.length === 0
      ? []
      : [
          isShort
            ? textEntry("entries", keys.join(","))
            : jsonEntry("entries", node.entries),
        ]),
  ];
}

function groupEntries(node: AgentPlanGroup): readonly PlanNotationEntry[] {
  return [
    ...nameEntries(node.name, node.id),
    ...(node.parameters.length === 0
      ? []
      : [jsonEntry("parameters", node.parameters)]),
  ];
}

/** The mode a loop's data edges would give it, which an explicit `mode` must otherwise state. */
function loopEntries(node: AgentPlanLoop): readonly PlanNotationEntry[] {
  const impliedSource = Object.hasOwn(node.bindings, PLAN_LOOP_RUNS_BINDING)
    ? "parameter"
    : "value";
  const isWhileBound = Object.hasOwn(node.bindings, PLAN_LOOP_WHILE_BINDING);
  const mode = node.mode ?? (isWhileBound ? "count" : undefined);
  return [
    ...nameEntries(node.name, node.id),
    ...(mode === undefined ? [] : [wordEntry("mode", mode)]),
    ...(node.runs === PLAN_LOOP_RUNS.initial
      ? []
      : [{ key: "runs", value: planNotationNumber(node.runs) }]),
    ...(node.runsSource === impliedSource
      ? []
      : [wordEntry("runsSource", node.runsSource)]),
    ...(node.countMode === "max"
      ? []
      : [wordEntry("countMode", node.countMode)]),
    ...(node.sessionPolicy === "reuse"
      ? []
      : [wordEntry("session", node.sessionPolicy)]),
    ...(node.condition === null
      ? []
      : [jsonEntry("condition", node.condition)]),
    ...(node.while === undefined ? [] : [jsonEntry("while", node.while)]),
  ];
}

/**
 * Writes the fields of a node, its type first, without its bindings and members.
 *
 * @param node - The stored node.
 * @param context - Names what the node refers to.
 * @returns The attributes in a fixed order; short forms where they read back unchanged.
 */
export function planNotationNodeEntries(
  node: AgentPlanNode,
  context: PlanNotationWriterContext,
): readonly PlanNotationEntry[] {
  const type = wordEntry("type", node.type);
  switch (node.type) {
    case "start":
    case "end":
      return [type];
    case "agent":
      return [type, ...planNotationAgentEntries(node, context)];
    case "script":
      return [type, ...scriptEntries(node, context)];
    case "git_closeout":
      return [type, ...closeoutEntries(node)];
    case "task": {
      const key = context.names.ticketKey(node.taskId);
      return [
        type,
        key === node.taskId
          ? textEntry("taskId", node.taskId)
          : wordEntry("ticket", key),
      ];
    }
    case "parameter":
      return [type, ...parameterEntries(node, context)];
    case "stack":
      return [type, ...stackEntries(node, context)];
    case "group":
      return [type, ...groupEntries(node)];
    case "loop":
      return [type, ...loopEntries(node)];
    case "decision":
      return node.name === undefined
        ? [type]
        : [type, textEntry("name", node.name)];
    case "variable":
      return [type, textEntry("name", node.name)];
  }
}
