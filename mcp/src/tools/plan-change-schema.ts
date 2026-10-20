import {
  PLAN_ADDABLE_TYPES,
  PLAN_NODE_FIELDS,
} from "../../../definition/AgentPlanChangeFields.js";

import type { Tool } from "@modelcontextprotocol/server";
type Properties = NonNullable<Tool["inputSchema"]["properties"]>;
type Schema = Properties[string];
const IDENTIFIER = { type: "string", minLength: 1, maxLength: 100 } as const;
const COORDINATE = { type: "integer", minimum: 0, maximum: 6000 } as const;
export const FORMAT: Schema = { enum: ["string", "number", "json"] };

export const VALUE: Schema = {
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
      properties: { type: { const: type }, [key]: IDENTIFIER },
      required: ["type", key],
      additionalProperties: false,
    })),
  ],
};

const BINDING: Schema = {
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
      properties: { kind: { const: "source" }, nodeId: IDENTIFIER },
      required: ["kind", "nodeId"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: { kind: { const: "result" }, stepId: IDENTIFIER },
      required: ["kind", "stepId"],
      additionalProperties: false,
    },
  ],
};

export const PARAMETER_NAME = {
  type: "string",
  pattern: "^[a-zA-Z][a-zA-Z0-9_]{0,63}$",
} as const;
const INPUT_NAME = {
  type: "string",
  pattern: "^[a-zA-Z][a-zA-Z0-9_]{0,63}$",
} as const;

const CONFIGURATION: Schema = {
  type: "object",
  additionalProperties: false,
  minProperties: 1,
  properties: {
    name: { type: "string", maxLength: 200 },
    modelProfileId: IDENTIFIER,
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
              name: INPUT_NAME,
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
const SCRIPT_FIELDS: Properties = {
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
        name: INPUT_NAME,
        type: { const: "text" },
        isRequired: { type: "boolean" },
      },
      required: ["name", "type", "isRequired"],
      additionalProperties: false,
    },
  },
  outputs: {
    type: "array",
    minItems: 1,
    maxItems: 1,
    items: {
      type: "object",
      properties: { name: INPUT_NAME, type: { const: "text" } },
      required: ["name", "type"],
      additionalProperties: false,
    },
  },
  timeoutSeconds: { type: "integer", minimum: 1, maximum: 300 },
};

const NODE_FIELDS: Properties = {
  x: COORDINATE,
  y: COORDINATE,
  agentId: { type: "string", maxLength: 100 },
  personalAgentId: { type: ["string", "null"], maxLength: 100 },
  instruction: { type: "string", maxLength: 200_000 },
  completion: { enum: ["report", "todos"] },
  taskId: { type: "string", minLength: 1, maxLength: 100 },
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

function change(action: string, properties: Properties): Schema {
  return {
    type: "object",
    properties: { action: { const: action }, ...properties },
    required: ["action", ...Object.keys(properties)],
    additionalProperties: false,
  };
}

export const CHANGES: Schema = {
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
              id: IDENTIFIER,
              x: COORDINATE,
              y: COORDINATE,
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
        nodeId: IDENTIFIER,
        fields: {
          type: "object",
          properties: NODE_FIELDS,
          minProperties: 1,
          additionalProperties: false,
        },
      }),
      change("placeNode", {
        nodeId: IDENTIFIER,
        groupId: { type: ["string", "null"], minLength: 1, maxLength: 100 },
        x: COORDINATE,
        y: COORDINATE,
      }),
      change("ungroup", {
        nodeId: IDENTIFIER,
        positions: {
          type: "array",
          maxItems: 50,
          items: {
            type: "object",
            properties: { nodeId: IDENTIFIER, x: COORDINATE, y: COORDINATE },
            required: ["nodeId", "x", "y"],
            additionalProperties: false,
          },
        },
      }),
      change("insertTemplate", {
        templateId: IDENTIFIER,
        x: COORDINATE,
        y: COORDINATE,
      }),
      change("removeNode", { nodeId: IDENTIFIER }),
      change("connect", { from: IDENTIFIER, to: IDENTIFIER }),
      change("disconnect", { from: IDENTIFIER, to: IDENTIFIER }),
      change("bind", {
        nodeId: IDENTIFIER,
        parameter: INPUT_NAME,
        binding: BINDING,
      }),
      change("unbind", { nodeId: IDENTIFIER, parameter: IDENTIFIER }),
    ],
  },
};
