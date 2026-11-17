import { AgentError } from "@/backend/error/AgentErrors";
import {
  PLAN_JUMP_MAX_MINUTES,
  PLAN_JUMP_NAME_LENGTH,
  PLAN_JUMP_VALUE_COUNT,
  arePlanEntryInputsValid,
  arePlanEntryReturnsValid,
  isPlanSignalName,
  planRunInvocationSchema,
} from "@/definition/AgentPlanJump";

import { readAgentParameterValue } from "./AgentConfigurationInput";
import { readPlanObject } from "./AgentPlanSettingsInput";

import type { AgentParameterType } from "@/definition/AgentParameters";
import type {
  AgentPlanBinding,
  AgentPlanEnd,
  AgentPlanNode,
  AgentPlanPosition,
  AgentPlanStart,
} from "@/definition/AgentPlan";
import type {
  AgentPlanEntryInput,
  AgentPlanEntryReturn,
  AgentPlanJump,
  AgentPlanJumpTimeout,
  AgentPlanJumpTarget,
  AgentPlanJumpWait,
  AgentPlanRunInvocation,
  AgentPlanSignal,
} from "@/definition/AgentPlanJump";

/** What the parser of a plan lends the Jump parsers: its own bounded readers. */
export interface PlanJumpReaders {
  readonly text: (input: unknown, maximum?: number) => string;
  readonly bindings: (
    input: unknown,
  ) => Readonly<Record<string, AgentPlanBinding>>;
}

type NodeBase = AgentPlanPosition & { readonly id: string };

/** Reads a call entry, exit or signal; other node families keep their own parser. */
export function readPlanEntryNode(
  node: Record<string, unknown>,
  base: NodeBase,
  readers: PlanJumpReaders,
): AgentPlanNode | null {
  if (node.type === "start") return readPlanStartNode(node, base, readers);
  if (node.type === "end") return readPlanEndNode(node, base, readers);
  if (node.type === "jump") return readPlanJumpNode(node, base, readers);
  if (node.type === "signal") return readPlanSignalNode(node, base, readers);
  return null;
}

const TYPES: readonly AgentParameterType[] = [
  "text",
  "number",
  "ticket",
  "workspace",
  "wiki",
  "asset",
];

function readType(input: unknown): AgentParameterType {
  const found = TYPES.find((type) => type === input);
  if (!found) throw new AgentError("plan_jump_invalid");
  return found;
}

function readList(input: unknown): readonly unknown[] {
  if (!Array.isArray(input) || input.length > PLAN_JUMP_VALUE_COUNT)
    throw new AgentError("plan_jump_invalid");
  return input;
}

/** Reads the declared inputs of an entry; a default value must match its type. */
export function readEntryInputs(
  input: unknown,
  readers: PlanJumpReaders,
): readonly AgentPlanEntryInput[] {
  const inputs = readList(input).map((entry): AgentPlanEntryInput => {
    const declared = readPlanObject(entry);
    if (typeof declared.isRequired !== "boolean")
      throw new AgentError("plan_jump_invalid");
    const defaultValue =
      declared.defaultValue === undefined || declared.defaultValue === null
        ? null
        : readAgentParameterValue(declared.defaultValue);
    return {
      name: readers.text(declared.name, 64),
      type: readType(declared.type),
      isRequired: declared.isRequired,
      defaultValue,
    };
  });
  if (!arePlanEntryInputsValid(inputs))
    throw new AgentError("plan_jump_invalid");
  return inputs;
}

/** Reads the declared returns of an end or of a calling Jump. */
export function readEntryReturns(
  input: unknown,
  readers: PlanJumpReaders,
): readonly AgentPlanEntryReturn[] {
  const returns = readList(input).map((entry): AgentPlanEntryReturn => {
    const declared = readPlanObject(entry);
    return {
      name: readers.text(declared.name, 64),
      type: readType(declared.type),
    };
  });
  if (!arePlanEntryReturnsValid(returns))
    throw new AgentError("plan_jump_invalid");
  return returns;
}

function readWait(input: unknown): AgentPlanJumpWait {
  if (input === "continue" || input === "completion" || input === "signal")
    return input;
  throw new AgentError("plan_jump_invalid");
}

function readTimeout(input: unknown): AgentPlanJumpTimeout {
  const timeout = readPlanObject(input);
  if (timeout.kind === "unlimited") return { kind: "unlimited" };
  if (
    timeout.kind !== "minutes" ||
    typeof timeout.minutes !== "number" ||
    !Number.isInteger(timeout.minutes) ||
    timeout.minutes < 1 ||
    timeout.minutes > PLAN_JUMP_MAX_MINUTES
  )
    throw new AgentError("plan_jump_invalid");
  return { kind: "minutes", minutes: timeout.minutes };
}

function readTarget(
  input: unknown,
  readers: PlanJumpReaders,
): AgentPlanJumpTarget | null {
  if (input === null) return null;
  const target = readPlanObject(input);
  return {
    planId: readers.text(target.planId),
    entryNodeId: readers.text(target.entryNodeId),
    planName: readers.text(target.planName, PLAN_JUMP_NAME_LENGTH),
    entryName: readers.text(target.entryName, PLAN_JUMP_NAME_LENGTH),
  };
}

function readOutJump(
  node: Record<string, unknown>,
  base: NodeBase,
  readers: PlanJumpReaders,
): AgentPlanJump {
  const wait = readWait(node.wait);
  const signalName =
    node.signalName === undefined ? undefined : readSignalName(node.signalName);
  if (wait === "signal" && signalName === undefined)
    throw new AgentError("plan_jump_invalid");
  if (node.workspace !== "own" && node.workspace !== "shared")
    throw new AgentError("plan_jump_invalid");
  // Handing the workspace over only makes sense while the caller waits for the target.
  if (node.workspace === "shared" && wait === "continue")
    throw new AgentError("plan_jump_invalid");
  return {
    ...base,
    type: "jump",
    direction: "out",
    ...(node.name === undefined
      ? {}
      : { name: readers.text(node.name, PLAN_JUMP_NAME_LENGTH) }),
    target: readTarget(node.target, readers),
    wait,
    ...(signalName === undefined ? {} : { signalName }),
    timeout: readTimeout(node.timeout),
    workspace: node.workspace,
    ...(node.payloadType === undefined
      ? {}
      : { payloadType: readType(node.payloadType) }),
    inputs: readEntryInputs(node.inputs, readers),
    returns: readEntryReturns(node.returns, readers),
    bindings: readers.bindings(node.bindings),
  };
}

function readSignalName(input: unknown): string {
  if (typeof input !== "string" || !isPlanSignalName(input))
    throw new AgentError("plan_jump_invalid");
  return input;
}

/**
 * Parses a Jump node of either direction.
 * @throws {AgentError} `plan_jump_invalid` for a missing or malformed field, a
 * direction that is neither `in` nor `out`, repeated or malformed input
 * names, a signal wait without a valid signal name or a shared workspace with
 * a call that does not wait.
 */
export function readPlanJumpNode(
  node: Record<string, unknown>,
  base: NodeBase,
  readers: PlanJumpReaders,
): AgentPlanJump {
  if (node.direction === "out") return readOutJump(node, base, readers);
  if (node.direction !== "in" || typeof node.isEnabled !== "boolean")
    throw new AgentError("plan_jump_invalid");
  return {
    ...base,
    type: "jump",
    direction: "in",
    name: readers.text(node.name, PLAN_JUMP_NAME_LENGTH),
    isEnabled: node.isEnabled,
    inputs: readEntryInputs(node.inputs, readers),
  };
}

/** Parses a node that sends a message to the caller of its run. */
export function readPlanSignalNode(
  node: Record<string, unknown>,
  base: NodeBase,
  readers: PlanJumpReaders,
): AgentPlanSignal {
  return {
    ...base,
    type: "signal",
    ...(node.name === undefined
      ? {}
      : { name: readers.text(node.name, PLAN_JUMP_NAME_LENGTH) }),
    signalName: readSignalName(node.signalName),
    ...(node.payloadType === undefined
      ? {}
      : { payloadType: readType(node.payloadType) }),
    bindings: readers.bindings(node.bindings),
  };
}

/** Parses a start: older plans carry neither a name nor a call release. */
export function readPlanStartNode(
  node: Record<string, unknown>,
  base: NodeBase,
  readers: PlanJumpReaders,
): AgentPlanStart {
  if (node.callable !== undefined && typeof node.callable !== "boolean")
    throw new AgentError("plan_jump_invalid");
  return {
    ...base,
    type: "start",
    ...(node.name === undefined
      ? {}
      : { name: readers.text(node.name, PLAN_JUMP_NAME_LENGTH) }),
    ...(node.callable === undefined ? {} : { callable: node.callable }),
    ...(node.inputs === undefined
      ? {}
      : { inputs: readEntryInputs(node.inputs, readers) }),
  };
}

/** Parses an end: older plans have no returns and no bindings. */
export function readPlanEndNode(
  node: Record<string, unknown>,
  base: NodeBase,
  readers: PlanJumpReaders,
): AgentPlanEnd {
  return {
    ...base,
    type: "end",
    ...(node.returns === undefined
      ? {}
      : { returns: readEntryReturns(node.returns, readers) }),
    ...(node.bindings === undefined
      ? {}
      : { bindings: readers.bindings(node.bindings) }),
  };
}

/** Reads the call a stored run was started by. */
export function readRunInvocation(input: unknown): AgentPlanRunInvocation {
  const parsed = planRunInvocationSchema.safeParse(input);
  if (!parsed.success) throw new AgentError("plan_invalid");
  return parsed.data;
}
