import { isAgentParameterName } from "@/definition/AgentParameters";
import { PLAN_JUMP_DEFAULT_MINUTES } from "@/definition/AgentPlanJump";

import {
  PLAN_NOTATION_EMPTY_BINDINGS,
  planNotationEntryWord,
} from "./PlanNotationEntryWords";
import {
  jsonEntry,
  planNotationNumber,
  textEntry,
  wordEntry,
} from "./PlanNotationFormat";

import type { AgentPlanEnd, AgentPlanStart } from "@/definition/AgentPlan";
import type {
  AgentPlanEntryInput,
  AgentPlanEntryReturn,
  AgentPlanJump,
  AgentPlanJumpOut,
  AgentPlanJumpTimeout,
  AgentPlanSignal,
} from "@/definition/AgentPlanJump";
import type { PlanNotationEntry } from "./PlanNotationFormat";

type EntryList = readonly (AgentPlanEntryInput | AgentPlanEntryReturn)[];

/**
 * Whether a list of declared values has a compact form that reads back unchanged.
 * @remarks
 * A default value is more than a word can say, so any list with one is JSON.
 */
function isCompact(list: EntryList): boolean {
  return list.every(
    (entry) =>
      isAgentParameterName(entry.name) &&
      (!("defaultValue" in entry) || entry.defaultValue === null),
  );
}

/** A list of declared values: compact words where they read back unchanged, JSON otherwise. */
function listEntry(
  key: "inputs" | "returns",
  list: EntryList,
): PlanNotationEntry {
  return isCompact(list)
    ? textEntry(key, list.map(planNotationEntryWord).join(","))
    : jsonEntry(key, list);
}

/** A list every node of its kind has: written only while it holds something. */
function presentList(
  key: "inputs" | "returns",
  list: EntryList,
): readonly PlanNotationEntry[] {
  return list.length === 0 ? [] : [listEntry(key, list)];
}

/** A list a node may lack: an empty one is written as such, so an absent one stays absent. */
function optionalList(
  key: "inputs" | "returns",
  list: EntryList | undefined,
): readonly PlanNotationEntry[] {
  if (list === undefined) return [];
  return [list.length === 0 ? jsonEntry(key, []) : listEntry(key, list)];
}

/** The wait of a call, unless it is the default hour. */
function timeoutEntries(
  timeout: AgentPlanJumpTimeout,
): readonly PlanNotationEntry[] {
  if (timeout.kind === "unlimited")
    return [wordEntry("timeoutMinutes", "unlimited")];
  return timeout.minutes === PLAN_JUMP_DEFAULT_MINUTES
    ? []
    : [{ key: "timeoutMinutes", value: planNotationNumber(timeout.minutes) }];
}

/** A call: every field that differs from what a call without a notation has. */
function jumpOutEntries(node: AgentPlanJumpOut): readonly PlanNotationEntry[] {
  return [
    ...(node.name === undefined ? [] : [textEntry("name", node.name)]),
    ...(node.target === null ? [] : [jsonEntry("target", node.target)]),
    ...(node.wait === "continue" ? [] : [wordEntry("wait", node.wait)]),
    ...(node.signalName === undefined
      ? []
      : [wordEntry("signalName", node.signalName)]),
    ...timeoutEntries(node.timeout),
    ...(node.workspace === "own"
      ? []
      : [wordEntry("workspace", node.workspace)]),
    ...(node.payloadType === undefined
      ? []
      : [wordEntry("payloadType", node.payloadType)]),
    ...presentList("inputs", node.inputs),
    ...presentList("returns", node.returns),
  ];
}

/**
 * Writes the fields of a Jump, its direction first.
 * @param node - The stored Jump of either direction.
 * @returns The attributes; a name that is the identifier and a default are not written.
 */
export function planNotationJumpEntries(
  node: AgentPlanJump,
): readonly PlanNotationEntry[] {
  const direction = wordEntry("direction", node.direction);
  if (node.direction === "out") return [direction, ...jumpOutEntries(node)];
  return [
    direction,
    ...(node.name === node.id ? [] : [textEntry("name", node.name)]),
    ...(node.isEnabled ? [] : [wordEntry("isEnabled", "false")]),
    ...presentList("inputs", node.inputs),
  ];
}

/**
 * Writes the fields of a signal node.
 * @param node - The stored signal.
 */
export function planNotationSignalEntries(
  node: AgentPlanSignal,
): readonly PlanNotationEntry[] {
  return [
    ...(node.name === undefined ? [] : [textEntry("name", node.name)]),
    wordEntry("signalName", node.signalName),
    ...(node.payloadType === undefined
      ? []
      : [wordEntry("payloadType", node.payloadType)]),
  ];
}

/**
 * Writes the fields of a start: a name, the switch for calls and the inputs, each only when the plan has it.
 * @param node - The stored start; a plan saved before entries has none of them.
 */
export function planNotationStartEntries(
  node: AgentPlanStart,
): readonly PlanNotationEntry[] {
  return [
    ...(node.name === undefined ? [] : [textEntry("name", node.name)]),
    ...(node.callable === undefined
      ? []
      : [wordEntry("callable", String(node.callable))]),
    ...optionalList("inputs", node.inputs),
  ];
}

/**
 * Writes the fields of an end: the declared returns, and a marker for an empty set of bindings.
 * @param node - The stored end; its bindings are written with those of the other nodes.
 */
export function planNotationEndEntries(
  node: AgentPlanEnd,
): readonly PlanNotationEntry[] {
  const isEmpty =
    node.bindings !== undefined && Object.keys(node.bindings).length === 0;
  return [
    ...optionalList("returns", node.returns),
    ...(isEmpty ? [textEntry("bindings", PLAN_NOTATION_EMPTY_BINDINGS)] : []),
  ];
}
