import {
  PLAN_ADDABLE_TYPES,
  PLAN_NODE_FIELDS,
} from "../AgentPlanChangeFields.js";
import {
  COORDINATE_SCHEMA,
  PLAN_NODE_IDENTIFIER_SCHEMA,
} from "./ToolDefinition.js";

import type { PropertySchema, ToolProperties } from "./ToolDefinition.js";

/** Parameter formats accepted by the plan editor; `boolean` holds the text `true` or `false`. */
export const FORMAT: PropertySchema = {
  enum: ["string", "number", "json", "boolean"],
};

/** Typed plan values used by parameters, defaults and literal bindings. */
export const VALUE: PropertySchema = {
  oneOf: [
    {
      type: "object",
      properties: {
        type: { const: "text" },
        text: { type: "string", maxLength: 200_000 },
      },
      required: ["type", "text"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: { type: { const: "number" }, number: { type: "number" } },
      required: ["type", "number"],
      additionalProperties: false,
    },
    ...(
      [
        ["ticket", "ticketId"],
        ["workspace", "workspaceId"],
        ["wiki", "pageId"],
      ] as const
    ).map(([type, key]) => ({
      type: "object",
      properties: { type: { const: type }, [key]: PLAN_NODE_IDENTIFIER_SCHEMA },
      required: ["type", key],
      additionalProperties: false,
    })),
  ],
};

const BINDING: PropertySchema = {
  oneOf: [
    {
      type: "object",
      properties: {
        kind: { const: "literal" },
        value: { oneOf: [{ type: "null" }, VALUE] },
      },
      required: ["kind", "value"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        kind: { const: "source" },
        nodeId: PLAN_NODE_IDENTIFIER_SCHEMA,
      },
      required: ["kind", "nodeId"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        kind: { enum: ["result", "previous"] },
        stepId: PLAN_NODE_IDENTIFIER_SCHEMA,
      },
      required: ["kind", "stepId"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        kind: { const: "stack" },
        stackId: PLAN_NODE_IDENTIFIER_SCHEMA,
        output: { enum: ["content", "count"] },
      },
      required: ["kind", "stackId", "output"],
      additionalProperties: false,
    },
  ],
};

/** The ordered entries of a stack: tickets and typed values. */
const STACK_ENTRIES: PropertySchema = {
  type: "array",
  maxItems: 200,
  items: {
    oneOf: [
      {
        type: "object",
        properties: {
          id: PLAN_NODE_IDENTIFIER_SCHEMA,
          type: { const: "task" },
          taskId: PLAN_NODE_IDENTIFIER_SCHEMA,
        },
        required: ["id", "type", "taskId"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          id: PLAN_NODE_IDENTIFIER_SCHEMA,
          type: { const: "parameter" },
          name: { type: "string", minLength: 1, maxLength: 64 },
          format: FORMAT,
          value: VALUE,
        },
        required: ["id", "type", "name", "format", "value"],
        additionalProperties: false,
      },
    ],
  },
};

/** Display name syntax for a parameter node. */
export const PARAMETER_NAME = {
  type: "string",
  pattern: "^[a-zA-Z][a-zA-Z0-9_]{0,63}$",
} as const;

const CONFIGURATION: PropertySchema = {
  type: "object",
  additionalProperties: false,
  minProperties: 1,
  properties: {
    name: { type: "string", maxLength: 200 },
    modelProfileId: { type: "string", maxLength: 1500 },
    connectionId: PLAN_NODE_IDENTIFIER_SCHEMA,
    model: { type: "string", minLength: 1, maxLength: 500 },
    reasoningEffort: { type: ["string", "null"], maxLength: 100 },
    template: {
      type: "object",
      additionalProperties: false,
      minProperties: 1,
      properties: {
        markdown: { type: "string", maxLength: 200000 },
        directoryParameter: { type: ["string", "null"], maxLength: 64 },
        parameters: {
          type: "array",
          maxItems: 50,
          items: {
            type: "object",
            properties: {
              name: PARAMETER_NAME,
              type: { enum: ["text", "number", "ticket", "workspace", "wiki"] },
              description: { type: "string", maxLength: 1000 },
              isRequired: { type: "boolean" },
              defaultValue: { oneOf: [{ type: "null" }, VALUE] },
            },
            required: [
              "name",
              "type",
              "description",
              "isRequired",
              "defaultValue",
            ],
            additionalProperties: false,
          },
        },
        run: {
          type: "object",
          minProperties: 1,
          additionalProperties: false,
          properties: {
            access: { enum: ["read_only", "workspace_write", "yolo"] },
            shell: { type: "boolean" },
            web: { type: "boolean" },
            timeoutMinutes: { type: "integer", minimum: 0, maximum: 120 },
            browser: { type: "boolean" },
          },
        },
      },
    },
  },
};
/** The fields of a script node, checked by Pages exactly as on the plan page. */
const SCRIPT_FIELDS: ToolProperties = {
  interpreterProfileId: {
    type: "string",
    pattern: "^[a-zA-Z0-9-]{1,80}$",
    description: "id of an interpreter profile from read_plan_sources",
  },
  content: { type: "string", maxLength: 100_000 },
  inputs: {
    type: "array",
    maxItems: 16,
    items: {
      type: "object",
      properties: {
        name: PARAMETER_NAME,
        type: { const: "text" },
        isRequired: { type: "boolean" },
      },
      required: ["name", "type", "isRequired"],
      additionalProperties: false,
    },
  },
  outputs: {
    type: "array",
    minItems: 0,
    maxItems: 1,
    items: {
      type: "object",
      properties: {
        name: PARAMETER_NAME,
        type: { const: "text" },
        policy: {
          enum: ["report", "gate"],
          description:
            "report forwards complete failed or partial check findings; gate requires every check to pass. Omission preserves arbitrary text.",
        },
      },
      required: ["name", "type"],
      additionalProperties: false,
    },
  },
  timeoutSeconds: { type: "integer", minimum: 1, maximum: 86_400 },
};

/** A plan or node execution target, validated by the same Pages service as the editor. */
export const EXECUTION_TARGET: PropertySchema = {
  oneOf: [
    {
      type: "object",
      properties: { kind: { const: "local" } },
      required: ["kind"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        kind: { const: "remote" },
        workspaceId: PLAN_NODE_IDENTIFIER_SCHEMA,
      },
      required: ["kind", "workspaceId"],
      additionalProperties: false,
    },
  ],
};

const NODE_FIELDS: ToolProperties = {
  x: COORDINATE_SCHEMA,
  y: COORDINATE_SCHEMA,
  agentId: { type: "string", maxLength: 100 },
  personalAgentId: { type: ["string", "null"], maxLength: 100 },
  instruction: { type: "string", maxLength: 200_000 },
  executionTarget: EXECUTION_TARGET,
  runs: { type: "integer", minimum: 1, maximum: 999 },
  runsSource: { enum: ["value", "parameter"] },
  mode: {
    enum: ["count", "while", "boolean", "model"],
    description:
      "loop: count or while. decision: boolean (default; reads a boolean parameter or an agent's passed-out without a model) or model (asks the chosen ACP model the question about one ticket or text result).",
  },
  question: {
    type: "string",
    maxLength: 4000,
    description:
      "decision in model mode: the question the model answers about its source.",
  },
  model: {
    type: "object",
    description:
      "decision in model mode: the model of an ACP connection, as list_agent_models names it.",
    properties: {
      connectionId: PLAN_NODE_IDENTIFIER_SCHEMA,
      provider: {
        enum: ["codex_cli", "claude_code", "opencode", "antigravity"],
      },
      model: { type: "string", minLength: 1, maxLength: 300 },
      reasoningEffort: { type: ["string", "null"], maxLength: 40 },
    },
    required: ["connectionId", "provider", "model", "reasoningEffort"],
    additionalProperties: false,
  },
  output: {
    enum: ["boolean", "classification"],
    description:
      "decision in model mode: boolean answers yes or no (outputs true-out and false-out); classification answers one value of cases, each with its own output port case:<id>.",
  },
  cases: {
    type: "array",
    maxItems: 20,
    description:
      "decision classification: 2 to 20 values; ids are stable, so renaming keeps the connection of case:<id>. Names are unique ignoring case, at most 60 characters.",
    items: {
      type: "object",
      properties: {
        id: PLAN_NODE_IDENTIFIER_SCHEMA,
        name: { type: "string", maxLength: 60 },
      },
      required: ["id", "name"],
      additionalProperties: false,
    },
  },
  while: {
    oneOf: [
      { type: "null" },
      {
        type: "object",
        properties: {
          sourceNodeId: { type: "string", maxLength: 100 },
          outputPath: { type: "string", maxLength: 200 },
        },
        required: ["sourceNodeId", "outputPath"],
        additionalProperties: false,
      },
    ],
  },
  entries: STACK_ENTRIES,
  countMode: { enum: ["max", "expected"] },
  sessionPolicy: { enum: ["reuse", "fresh"] },
  condition: {
    oneOf: [
      { type: "null" },
      {
        type: "object",
        properties: {
          isEnabled: { type: "boolean" },
          sourceNodeId: { type: "string", maxLength: 100 },
          outputPath: { type: "string", maxLength: 200 },
          operator: { const: "equals" },
          expected: {
            oneOf: [
              {
                type: "object",
                properties: { type: { const: "null" } },
                required: ["type"],
                additionalProperties: false,
              },
              ...["boolean", "number", "string"].map((type) => ({
                type: "object",
                properties: {
                  type: { const: type },
                  value: {
                    type,
                    ...(type === "string" ? { maxLength: 1000 } : {}),
                  },
                },
                required: ["type", "value"],
                additionalProperties: false,
              })),
            ],
          },
        },
        required: [
          "isEnabled",
          "sourceNodeId",
          "outputPath",
          "operator",
          "expected",
        ],
        additionalProperties: false,
      },
    ],
  },
  completion: { enum: ["report", "todos"] },
  role: {
    enum: ["closeout", null],
    description:
      "closeout marks the closing Git step of the plan: when only such a step fails, the run ends as work_done_closeout_open and a resume repeats just that step. null removes the mark. Group and loop members refuse it.",
  },
  completionGate: {
    type: "object",
    description:
      "Version 1 requires completion todos on a standalone agent node; group and loop members refuse this opt-in.",
    properties: {
      version: { const: 1 },
      requiredChecks: {
        type: "array",
        minItems: 1,
        maxItems: 30,
        uniqueItems: true,
        items: { type: "string", minLength: 1, maxLength: 2000 },
      },
    },
    required: ["version", "requiredChecks"],
    additionalProperties: false,
  },
  taskId: PLAN_NODE_IDENTIFIER_SCHEMA,
  name: {
    type: "string",
    minLength: 1,
    maxLength: 120,
    description:
      "parameter: letters, digits and _ starting with a letter; script: the name the card shows",
  },
  format: FORMAT,
  value: VALUE,
  input: {
    ...BINDING,
    description:
      "decision: the data input. boolean mode: source of a boolean parameter; model mode: source of a ticket node or result of an agent or script. An agent's boolean result is an edge passed-out -> condition-in instead.",
  },
  configuration: CONFIGURATION,
  ...SCRIPT_FIELDS,
};

function change(action: string, properties: ToolProperties): PropertySchema {
  return {
    type: "object",
    properties: { action: { const: action }, ...properties },
    required: ["action", ...Object.keys(properties)],
    additionalProperties: false,
  };
}

/** The ports of a connection as the editor names them; none means a plain flow edge. */
const PORT: PropertySchema = { type: "string", minLength: 1, maxLength: 100 };

/**
 * A connection between two nodes, optionally through named ports.
 *
 * @remarks
 * `fromPort` and `toPort` come together, Pages refuses one alone: `true-out`/`false-out`
 * or `case:<id>` of a decision into `flow-in`, `passed-out` into `condition-in`,
 * `value-out` of a boolean parameter, a ticket, an agent or a script into the
 * `condition-in` of a decision, `value-out` into `event-in`, a ticket or
 * value node with `value-out` into the `flow-in` of a stack, or `flow-out`
 * into `flow-in`.
 */
function connection(action: "connect" | "disconnect"): PropertySchema {
  return {
    type: "object",
    properties: {
      action: { const: action },
      from: PLAN_NODE_IDENTIFIER_SCHEMA,
      to: PLAN_NODE_IDENTIFIER_SCHEMA,
      fromPort: PORT,
      toPort: PORT,
    },
    required: ["action", "from", "to"],
    additionalProperties: false,
  };
}

/** Ordered atomic plan edits accepted by Pages, without raw graph replacement. */
export const CHANGES: PropertySchema = {
  type: "array",
  maxItems: 200,
  items: {
    oneOf: [
      change("addNode", {
        node: {
          type: "object",
          oneOf: PLAN_ADDABLE_TYPES.map((type) => ({
            type: "object",
            properties: {
              type: { const: type },
              id: PLAN_NODE_IDENTIFIER_SCHEMA,
              x: COORDINATE_SCHEMA,
              y: COORDINATE_SCHEMA,
              ...Object.fromEntries(
                PLAN_NODE_FIELDS[type].map((key) => [key, NODE_FIELDS[key]]),
              ),
            },
            required: ["type"],
            additionalProperties: false,
          })),
        },
      }),
      change("updateNode", {
        nodeId: PLAN_NODE_IDENTIFIER_SCHEMA,
        fields: {
          type: "object",
          properties: NODE_FIELDS,
          minProperties: 1,
          additionalProperties: false,
        },
      }),
      change("placeNode", {
        nodeId: PLAN_NODE_IDENTIFIER_SCHEMA,
        groupId: { type: ["string", "null"], minLength: 1, maxLength: 100 },
        x: COORDINATE_SCHEMA,
        y: COORDINATE_SCHEMA,
      }),
      change("placeLoopNode", {
        nodeId: PLAN_NODE_IDENTIFIER_SCHEMA,
        loopId: { type: ["string", "null"], minLength: 1, maxLength: 100 },
        x: COORDINATE_SCHEMA,
        y: COORDINATE_SCHEMA,
      }),
      change("ungroup", {
        nodeId: PLAN_NODE_IDENTIFIER_SCHEMA,
        positions: {
          type: "array",
          maxItems: 50,
          items: {
            type: "object",
            properties: {
              nodeId: PLAN_NODE_IDENTIFIER_SCHEMA,
              x: COORDINATE_SCHEMA,
              y: COORDINATE_SCHEMA,
            },
            required: ["nodeId", "x", "y"],
            additionalProperties: false,
          },
        },
      }),
      change("insertTemplate", {
        templateId: PLAN_NODE_IDENTIFIER_SCHEMA,
        x: COORDINATE_SCHEMA,
        y: COORDINATE_SCHEMA,
      }),
      change("removeNode", { nodeId: PLAN_NODE_IDENTIFIER_SCHEMA }),
      connection("connect"),
      connection("disconnect"),
      change("bind", {
        nodeId: PLAN_NODE_IDENTIFIER_SCHEMA,
        parameter: PARAMETER_NAME,
        binding: BINDING,
      }),
      change("unbind", {
        nodeId: PLAN_NODE_IDENTIFIER_SCHEMA,
        parameter: PLAN_NODE_IDENTIFIER_SCHEMA,
      }),
    ],
  },
};
