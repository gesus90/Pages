import type { Tool } from "@modelcontextprotocol/server";
import type {
  PageAgentReadOperation,
  PageAgentWriteOperation,
} from "../../../definition/PageAgentOperations.js";

type Properties = NonNullable<Tool["inputSchema"]["properties"]>;
type Schema = Properties[string];

const IDENTIFIER = { type: "string", minLength: 1, maxLength: 200 } as const;
const NAME = { type: "string", minLength: 1, maxLength: 200 } as const;
const REFERENCE = { type: "string", minLength: 1, maxLength: 100 } as const;
const INSTRUCTION = { type: "string", maxLength: 200_000 } as const;
const REVISION = { type: "integer", minimum: 1 } as const;
const EFFORT: Schema = {
  type: ["string", "null"],
  minLength: 1,
  maxLength: 24,
};

const PARAMETERS: Schema = {
  type: "array",
  maxItems: 50,
  items: {
    type: "object",
    properties: {
      name: { type: "string", pattern: "^[a-z][a-z0-9_]{0,63}$" },
      type: { enum: ["text", "ticket", "workspace", "wiki"] },
      description: { type: "string", maxLength: 1000 },
      isRequired: { type: "boolean" },
      defaultValue: {
        oneOf: [
          { type: "null" },
          {
            type: "object",
            properties: { type: { const: "ticket" }, ticketId: REFERENCE },
            required: ["type", "ticketId"],
            additionalProperties: false,
          },
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
            properties: {
              type: { const: "workspace" },
              workspaceId: REFERENCE,
            },
            required: ["type", "workspaceId"],
            additionalProperties: false,
          },
          {
            type: "object",
            properties: { type: { const: "wiki" }, pageId: REFERENCE },
            required: ["type", "pageId"],
            additionalProperties: false,
          },
        ],
      },
    },
    required: ["name", "type", "description", "isRequired", "defaultValue"],
    additionalProperties: false,
  },
};

const SHARING: Schema = {
  type: "object",
  properties: {
    scope: { enum: ["private", "global", "restricted"] },
    operator: { enum: ["or", "and"] },
    groupIds: { type: "array", maxItems: 100, items: IDENTIFIER },
    departmentIds: { type: "array", maxItems: 100, items: IDENTIFIER },
  },
  required: ["scope"],
  additionalProperties: false,
};

const SEE_DESCRIPTION =
  "Returns only user agents the connected account owns or that are shared with it now; an agent it cannot see, and one that does not exist, answer NOT_FOUND alike, and totals count visible agents only. Agents of administrators are not part of this list. Pages checks the account rights on every call.";
const FIELDS_DESCRIPTION =
  "name is the title. instruction is the Markdown the agent runs; {{parameter}}, {{parameter.path}}, {{parameter.link}} and {{parameter.markdown}} refer to declared parameters (names a-z, 0-9, _), and a placeholder without a declaration or of another type is INVALID_REQUEST with reason configuration_invalid. parameters declares them: type text, ticket, workspace or wiki, a default of the same type or null; ticket, workspace and wiki defaults must be references the account may use. For a ticket parameter, {{parameter.description}} inserts the complete description, {{parameter.assets}} delivers authorized PNG/text contents separately, and {{parameter}} supplies both. References retain the ticket ID and key; bind the same ticket to a receiving agent, because result text alone cannot transfer assets. directoryParameter names the declared workspace parameter an agent run works in, or null. modelProfileId is a modelProfileId of list_agent_models and reasoningEffort one of its reasoningEfforts, or null for a model that lists none. sharing replaces the whole share: scope private (only the owner), global (everyone) or restricted with groupIds and/or departmentIds (at least one) and operator or (member of any target) or and (member of every target); an omitted operator is or for a new share and the stored one when a restricted share is changed. Any existing group or department of the instance can be a target, as in the agent form; list_groups and list_departments list those visible to the account. A share never gives anyone the right to change the agent, and never a model, a connection or a project. The agent file of the instance is written by Pages; no path is chosen or changed here. A request is at most 64 KiB of UTF-8 JSON (PAYLOAD_TOO_LARGE), which bounds the instruction below its 200,000 characters.";
const CHANGE_DESCRIPTION =
  "Pages validates the model and the effort against the models the account may use now; credentials in the text, unknown sharing targets and invalid parameters are refused with INVALID_REQUEST and one of these reasons: model_unavailable, reasoning_unsupported, reasoning_required, sharing_target_unavailable, configuration_invalid, credentials_in_text, parameter_reference_unavailable, agent_limit_reached (at most 100 agents per person), agent_running (CONFLICT, a running plan holds the agent) or sharing_changes_required. Reuse operationId with identical parameters after response loss to receive the stored result without a second agent or change; the same operationId with other parameters is CONFLICT. An owner or user parameter does not exist: the owner is always the connected account.";

const READ_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

interface WriteToolOptions {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly properties: Properties;
  readonly optionalKeys: readonly string[];
}

function writeTool(options: WriteToolOptions): Tool {
  const { name, title, description, properties, optionalKeys } = options;
  return {
    name,
    title,
    description,
    inputSchema: {
      type: "object",
      properties: { operationId: IDENTIFIER, ...properties },
      required: [
        "operationId",
        ...Object.keys(properties).filter((key) => !optionalKeys.includes(key)),
      ],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  };
}

/** Reads of user agents and of the models an account may give them. */
export const AGENT_READ_TOOLS: readonly {
  readonly operation: PageAgentReadOperation;
  readonly tool: Tool;
}[] = [
  {
    operation: "agents.list",
    tool: {
      name: "list_agents",
      title: "List agents",
      description: `Lists the user agents of the connected account: id, name, instruction, parameters, directoryParameter, run options (read only), modelProfileId, model, reasoningEffort, sharing with group and department names, ownerId, canEdit (only the owner), isUsable (a run could start now), hasDeletedTargets and revision. Ordered by name; pass nextCursor with the same query to continue. ${SEE_DESCRIPTION}`,
      inputSchema: {
        type: "object",
        properties: {
          cursor: { type: ["string", "null"], maxLength: 2048 },
          limit: { type: "integer", minimum: 1, maximum: 100 },
        },
        additionalProperties: false,
      },
      annotations: READ_ANNOTATIONS,
    },
  },
  {
    operation: "agents.read",
    tool: {
      name: "read_agent",
      title: "Read agent",
      description: `Reads one user agent by its id, with the same fields as list_agents. ${SEE_DESCRIPTION}`,
      inputSchema: {
        type: "object",
        properties: { agentId: IDENTIFIER },
        required: ["agentId"],
        additionalProperties: false,
      },
      annotations: READ_ANNOTATIONS,
    },
  },
  {
    operation: "agents.models.list",
    tool: {
      name: "list_agent_models",
      title: "List agent models",
      description:
        "Lists the models the connected account may give an agent now: modelProfileId, name, model, reasoning (levels, automatic, none or unknown), reasoningEfforts the catalog lists, catalogDefaultReasoningEffort the catalog names, defaultReasoningEffort applied when create_agent omits reasoningEffort (medium when listed, otherwise the catalog default, otherwise null) and isDefault for the model applied when create_agent omits modelProfileId (the first model Pages lists, the one its agent form starts on). Only models that administrators released for the account and whose connection verifies are listed, without credentials or connection details. An account without a model gets an empty list; create_agent without modelProfileId then returns FORBIDDEN with reason default_model_unavailable.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: READ_ANNOTATIONS,
    },
  },
];

const OPTIONAL_FIELDS: readonly string[] = [
  "instruction",
  "parameters",
  "directoryParameter",
  "modelProfileId",
  "reasoningEffort",
  "sharing",
];

const FIELD_PROPERTIES: Properties = {
  instruction: INSTRUCTION,
  parameters: PARAMETERS,
  directoryParameter: { type: ["string", "null"], maxLength: 64 },
  modelProfileId: IDENTIFIER,
  reasoningEffort: EFFORT,
  sharing: SHARING,
};

/** Changes of user agents; the owner is always the connected account. */
export const AGENT_WRITE_TOOLS: readonly {
  readonly operation: PageAgentWriteOperation;
  readonly tool: Tool;
}[] = [
  {
    operation: "agents.create",
    tool: writeTool({
      name: "create_agent",
      title: "Create agent",
      description: `Creates a user agent owned by the connected account. New agents are private. Omitted modelProfileId and reasoningEffort take the default shown by list_agent_models; the result is { id, changed, revision }. ${FIELDS_DESCRIPTION} ${CHANGE_DESCRIPTION}`,
      properties: { name: NAME, ...FIELD_PROPERTIES },
      optionalKeys: OPTIONAL_FIELDS,
    }),
  },
  {
    operation: "agents.update",
    tool: writeTool({
      name: "update_agent",
      title: "Update agent",
      description: `Changes a user agent of the connected account; pass only what changes, the other fields stay as they are, and at least one field is required. Only the owner may change an agent: an agent that is only shared with the account is FORBIDDEN, one it cannot see NOT_FOUND, and agents of administrators are not reachable. Pass the revision read last as expectedRevision; CONFLICT with details.currentRevision means it changed meanwhile and nothing was written. A request that matches the stored agent returns changed false. Changing modelProfileId keeps reasoningEffort unless it is passed, so pass both when the new model lists other efforts. An agent whose share names a deleted group or department needs an explicit sharing (reason sharing_changes_required). ${FIELDS_DESCRIPTION} ${CHANGE_DESCRIPTION}`,
      properties: {
        agentId: IDENTIFIER,
        expectedRevision: REVISION,
        name: NAME,
        ...FIELD_PROPERTIES,
      },
      optionalKeys: ["name", ...OPTIONAL_FIELDS],
    }),
  },
];
