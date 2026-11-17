import {
  PLAN_JUMP_MAX_MINUTES,
  PLAN_JUMP_NAME_LENGTH,
  PLAN_JUMP_SIGNAL_LENGTH,
  PLAN_JUMP_VALUE_COUNT,
} from "../AgentPlanJump.js";
import { PLAN_NODE_IDENTIFIER_SCHEMA } from "./ToolDefinition.js";

import type { PropertySchema, ToolProperties } from "./ToolDefinition.js";

/** The schemas the fields of the call nodes are built from; they live with the other plan fields. */
export interface PlanJumpSchemaParts {
  /** A typed value, as parameters and defaults carry it. */
  readonly value: PropertySchema;
  /** One binding of an input. */
  readonly binding: PropertySchema;
  /** The syntax of the name of an input or a return. */
  readonly valueName: PropertySchema;
}

/** The types of the values an entry accepts and returns. */
const VALUE_TYPE: PropertySchema = {
  enum: ["text", "number", "ticket", "workspace", "wiki", "asset"],
};

const TARGET: PropertySchema = {
  oneOf: [
    { type: "null" },
    {
      type: "object",
      properties: {
        planId: PLAN_NODE_IDENTIFIER_SCHEMA,
        entryNodeId: PLAN_NODE_IDENTIFIER_SCHEMA,
        planName: { type: "string", maxLength: PLAN_JUMP_NAME_LENGTH },
        entryName: { type: "string", maxLength: PLAN_JUMP_NAME_LENGTH },
      },
      required: ["planId", "entryNodeId", "planName", "entryName"],
      additionalProperties: false,
    },
  ],
  description:
    "jump out: the entry to call, as the target plan states it: planId, the entryNodeId of its start (callable true) or receiving jump (isEnabled true) and their names as shown. null while none is chosen. The inputs and returns of the node mirror the entry as it was when it was chosen; a changed interface is refused when the call is made.",
};

const TIMEOUT: PropertySchema = {
  oneOf: [
    {
      type: "object",
      properties: {
        kind: { const: "minutes" },
        minutes: { type: "integer", minimum: 1, maximum: PLAN_JUMP_MAX_MINUTES },
      },
      required: ["kind", "minutes"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: { kind: { const: "unlimited" } },
      required: ["kind"],
      additionalProperties: false,
    },
  ],
  description:
    "jump out: how long a waiting call waits, counted from the accepted call (1 minute to 30 days, or unlimited); 60 minutes when the node is created. An elapsed wait leaves through timeout-out, which only a finite wait of completion or signal has.",
};

/**
 * Builds the fields of the Jump, signal, start and end nodes in a plan change.
 * @param parts - The shared value, binding and name schemas.
 * @returns The field schemas by name; `inputs` is the one of an entry, not of a script.
 */
export function planJumpFields(parts: PlanJumpSchemaParts): ToolProperties {
  const { value, binding, valueName } = parts;
  const input: PropertySchema = {
    type: "object",
    properties: {
      name: valueName,
      type: VALUE_TYPE,
      isRequired: { type: "boolean" },
      defaultValue: { oneOf: [{ type: "null" }, value] },
    },
    required: ["name", "type", "isRequired"],
    additionalProperties: false,
  };
  const returned: PropertySchema = {
    type: "object",
    properties: { name: valueName, type: VALUE_TYPE },
    required: ["name", "type"],
    additionalProperties: false,
  };
  return {
    direction: {
      enum: ["in", "out"],
      description:
        "jump: in is a receiving entry that other plans call and that starts a new run of this plan; out calls another plan. Set when the node is created. A receiving entry needs name, a calling jump needs wait, a timeout and a target before the plan can run.",
    },
    isEnabled: {
      type: "boolean",
      description:
        "jump in: whether other plans may call the entry; on when the entry is created.",
    },
    callable: {
      type: "boolean",
      description:
        "start: whether other plans may call this start (Von anderen Plänen aufrufbar); off when absent. The inputs stay while it is off.",
    },
    inputs: {
      type: "array",
      maxItems: PLAN_JUMP_VALUE_COUNT,
      items: input,
      description:
        "start and jump: the inputs a call of the entry accepts, or, on a calling jump, the inputs of its target as they were when it was chosen; each is filled by the binding of the same name. Names are unique and start with a letter.",
    },
    returns: {
      type: "array",
      maxItems: PLAN_JUMP_VALUE_COUNT,
      items: returned,
      description:
        "end: the values the run hands back to its caller, each bound at the end by the binding of the same name; every end an entry reaches declares the same returns. jump out: the returns of its target as they were when it was chosen, readable as return:<name> after a completion wait.",
    },
    target: TARGET,
    wait: {
      enum: ["continue", "completion", "signal"],
      description:
        "jump out: continue goes on once the call is accepted, which says nothing about the start or the success of the target. completion waits until the exact target run ends successfully with its cleanup confirmed. signal waits for the signal named signalName, which says nothing about the end of the target.",
    },
    signalName: {
      type: "string",
      minLength: 1,
      maxLength: PLAN_JUMP_SIGNAL_LENGTH,
      pattern: "^[a-zA-Z][a-zA-Z0-9_.-]*$",
      description:
        "jump out with wait signal, and signal nodes: the name of the signal; within one call the first signal of a name wins.",
    },
    timeout: TIMEOUT,
    workspace: {
      enum: ["own", "shared"],
      description:
        "jump out: own gives the target a workspace of its own; shared hands the workspace of this plan over to the target for the duration of the call, which only the waiting modes completion and signal allow.",
    },
    payloadType: {
      ...VALUE_TYPE,
      description:
        "jump out with wait signal, and signal nodes: the type of the payload; absent means text for a call and no payload for a signal node. The payload of a signal node is its binding payload.",
    },
    bindings: {
      type: "object",
      maxProperties: 64,
      additionalProperties: binding,
      description:
        "jump out: one binding per input of the call, by input name; signal: payload; end: one binding per return, by return name. A port binding reads entry:<name> of a start or receiving jump, or run-id-out, reason-out, payload-out or return:<name> of a calling jump. Replaced as a whole.",
    },
  };
}
