import { PLAN_JUMP_DEFAULT_MINUTES } from "@/definition/AgentPlanJump";

import { planNotationList } from "./PlanNotationAgent";
import {
  PLAN_NOTATION_EMPTY_BINDINGS,
  PLAN_NOTATION_ENTRY_TYPES,
  isPlanNotationEntryType,
  readPlanNotationEntryWord,
} from "./PlanNotationEntryWords";

import type { PlanNotationAttributes } from "./PlanNotationAttributes";

/** The waits of a calling Jump. */
const WAITS = ["continue", "completion", "signal"] as const;

/** The word of a wait without a limit. */
const UNLIMITED = "unlimited";

/**
 * Reads a list of declared values: the compact words, or JSON when it starts with `[`.
 * @remarks
 * A word is `name`, `name:type` or, for an input, `name!` and `name:type!`.
 * Anything the compact form cannot say, such as a default value, is JSON.
 * @returns The raw list, or `undefined` when the key was not written.
 */
function entryList(
  attributes: PlanNotationAttributes,
  key: "inputs" | "returns",
): unknown {
  const text = attributes.text(key);
  if (text === undefined) return undefined;
  if (text.trimStart().startsWith("[")) return attributes.json(key);
  return planNotationList(text).flatMap((word): readonly unknown[] => {
    const entry = readPlanNotationEntryWord(word);
    if (
      entry === null ||
      !isPlanNotationEntryType(entry.type) ||
      (key === "returns" && entry.isRequired)
    ) {
      attributes.invalid(key);
      return [];
    }
    return key === "inputs"
      ? [{ ...entry, defaultValue: null }]
      : [{ name: entry.name, type: entry.type }];
  });
}

/** A list a node may lack: nothing when the key was not written, so an absent list stays absent. */
function optionalList(
  attributes: PlanNotationAttributes,
  key: "inputs" | "returns",
): Record<string, unknown> {
  const list = entryList(attributes, key);
  return list === undefined ? {} : { [key]: list };
}

/** The type of a payload, when the node has one. */
function payloadType(
  attributes: PlanNotationAttributes,
): Record<string, unknown> {
  return attributes.has("payloadType")
    ? {
        payloadType: attributes.choice(
          "payloadType",
          PLAN_NOTATION_ENTRY_TYPES,
        ),
      }
    : {};
}

/** How long a waiting call waits: minutes, or the word `unlimited`; an hour when nothing is written. */
function timeout(attributes: PlanNotationAttributes): Record<string, unknown> {
  if (!attributes.has("timeoutMinutes"))
    return { kind: "minutes", minutes: PLAN_JUMP_DEFAULT_MINUTES };
  if (attributes.text("timeoutMinutes") === UNLIMITED)
    return { kind: "unlimited" };
  return { kind: "minutes", minutes: attributes.integer("timeoutMinutes") };
}

/**
 * Reads the fields of a start: its display name, the switch that lets other plans call it and its inputs.
 * @param attributes - The attributes of the node.
 * @returns The raw fields; an attribute that was not written leaves its field absent.
 */
export function readPlanNotationStart(
  attributes: PlanNotationAttributes,
): Record<string, unknown> {
  return {
    ...(attributes.has("name") ? { name: attributes.text("name") } : {}),
    ...(attributes.has("callable")
      ? { callable: attributes.boolean("callable") }
      : {}),
    ...optionalList(attributes, "inputs"),
  };
}

/**
 * Reads the fields of an end: the values it hands back to a caller.
 * @param attributes - The attributes of the node.
 * @remarks
 * The bindings that fill the returns are read with the other bindings of the
 * node. `bindings="{}"` marks an end that has an empty set of them.
 * @returns The raw fields; an attribute that was not written leaves its field absent.
 */
export function readPlanNotationEnd(
  attributes: PlanNotationAttributes,
): Record<string, unknown> {
  const isMarked =
    attributes.has("bindings") &&
    attributes.text("bindings") === PLAN_NOTATION_EMPTY_BINDINGS;
  if (attributes.has("bindings") && !isMarked) attributes.invalid("bindings");
  return {
    ...optionalList(attributes, "returns"),
    ...(isMarked ? { bindings: {} } : {}),
  };
}

/** A receiving entry: it is open for calls unless `isEnabled=false` says otherwise. */
function readJumpIn(
  attributes: PlanNotationAttributes,
  id: string,
): Record<string, unknown> {
  return {
    name: attributes.text("name") ?? id,
    isEnabled: attributes.boolean("isEnabled") ?? true,
    inputs: entryList(attributes, "inputs") ?? [],
  };
}

/** A call: with nothing written it has no target, goes on at once and keeps its own workspace. */
function readJumpOut(
  attributes: PlanNotationAttributes,
): Record<string, unknown> {
  return {
    ...(attributes.has("name") ? { name: attributes.text("name") } : {}),
    target: attributes.has("target") ? attributes.json("target") : null,
    wait: attributes.choice("wait", WAITS) ?? "continue",
    ...(attributes.has("signalName")
      ? { signalName: attributes.text("signalName") }
      : {}),
    timeout: timeout(attributes),
    workspace: attributes.choice("workspace", ["own", "shared"]) ?? "own",
    ...payloadType(attributes),
    inputs: entryList(attributes, "inputs") ?? [],
    returns: entryList(attributes, "returns") ?? [],
  };
}

/**
 * Reads the fields of a Jump of either direction; its bindings are read with those of the other nodes.
 * @param attributes - The attributes of the node.
 * @param id - The identifier of the node, the name of a receiving entry that has none.
 * @remarks
 * The direction is always written. A key of the other direction is an
 * `unknown_attribute`, so a field is never ignored silently.
 * @returns The raw fields, without a `direction` the notation did not give.
 */
export function readPlanNotationJump(
  attributes: PlanNotationAttributes,
  id: string,
): Record<string, unknown> {
  const direction = attributes.choice("direction", ["in", "out"]);
  if (!attributes.has("direction")) attributes.invalid("direction");
  const fields =
    direction === "in" ? readJumpIn(attributes, id) : readJumpOut(attributes);
  return direction === undefined ? fields : { ...fields, direction };
}

/**
 * Reads the fields of a signal node: the name of the signal and the type of its payload.
 * @param attributes - The attributes of the node.
 * @returns The raw fields; the payload is the binding `payload`.
 */
export function readPlanNotationSignal(
  attributes: PlanNotationAttributes,
): Record<string, unknown> {
  return {
    ...(attributes.has("name") ? { name: attributes.text("name") } : {}),
    signalName: attributes.text("signalName"),
    ...payloadType(attributes),
  };
}
