import {
  PLAN_ADDABLE_TYPES,
  PLAN_NODE_FIELDS,
} from "../../../definition/AgentPlanChangeFields.js";
import {
  COORDINATE_SCHEMA,
  PLAN_NODE_IDENTIFIER_SCHEMA,
} from "./tool-definition.js";

import type { PropertySchema, ToolProperties } from "./tool-definition.js";

/** Text parameter validation formats accepted by the plan editor. */
export const FORMAT: PropertySchema = { enum: ["string", "number", "json"] };

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
  ],
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
      properties: { name: PARAMETER_NAME, type: { const: "text" } },
      required: ["name", "type"],
      additionalProperties: false,
    },
  },
  timeoutSeconds: { type: "integer", minimum: 1, maximum: 86_400 },
};

const NODE_FIELDS: ToolProperties = {
  x: COORDINATE_SCHEMA,
  y: COORDINATE_SCHEMA,
  agentId: { type: "string", maxLength: 100 },
  personalAgentId: { type: ["string", "null"], maxLength: 100 },
  instruction: { type: "string", maxLength: 200_000 },
  executionTarget: {
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
  },
  runs: { type: "integer", minimum: 1, maximum: 999 },
  runsSource: { enum: ["value", "parameter"] },
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
  taskId: PLAN_NODE_IDENTIFIER_SCHEMA,
  name: {
    type: "string",
    minLength: 1,
    maxLength: 120,
    description:
      "parameter: letters, digits and _ starting with a letter; script: the name its card shows",
  },
  format: FORMAT,
  value: VALUE,
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
      change("connect", {
        from: PLAN_NODE_IDENTIFIER_SCHEMA,
        to: PLAN_NODE_IDENTIFIER_SCHEMA,
      }),
      change("disconnect", {
        from: PLAN_NODE_IDENTIFIER_SCHEMA,
        to: PLAN_NODE_IDENTIFIER_SCHEMA,
      }),
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
