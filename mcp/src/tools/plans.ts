import type { Tool } from "@modelcontextprotocol/server";
import type {
  AgentPlanReadOperation,
  AgentPlanWriteOperation,
} from "../../../definition/AgentPlanOperations.js";

type Properties = NonNullable<Tool["inputSchema"]["properties"]>;
type Schema = Properties[string];

const IDENTIFIER = { type: "string", minLength: 1, maxLength: 200 } as const;
const NAME = { type: "string", minLength: 1, maxLength: 120 } as const;
const REVISION = { type: "integer", minimum: 1 } as const;
const COORDINATE = { type: "integer", minimum: 0, maximum: 6000 } as const;
const CURSOR: Schema = { type: ["string", "null"], maxLength: 2048 };
const LIMIT = { type: "integer", minimum: 1, maximum: 100 } as const;
const SELECT: Schema = { enum: ["latest", "first"] };
const FORMAT: Schema = { enum: ["string", "number", "json"] };

const VALUE: Schema = {
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

const NODE_FIELDS: Properties = {
  x: COORDINATE,
  y: COORDINATE,
  agentId: { type: "string", maxLength: 100 },
  personalAgentId: { type: ["string", "null"], maxLength: 100 },
  instruction: { type: "string", maxLength: 200_000 },
  completion: { enum: ["report", "todos"] },
  taskId: { type: "string", minLength: 1, maxLength: 100 },
  name: { type: "string", pattern: "^[a-z][a-z0-9_]{0,63}$" },
  format: FORMAT,
  value: VALUE,
};

function change(action: string, properties: Properties): Schema {
  return {
    type: "object",
    properties: { action: { const: action }, ...properties },
    required: ["action", ...Object.keys(properties)],
    additionalProperties: false,
  };
}

const CHANGES: Schema = {
  type: "array",
  maxItems: 200,
  items: {
    oneOf: [
      change("addNode", {
        node: {
          type: "object",
          properties: {
            type: { enum: ["start", "end", "agent", "task", "parameter"] },
            id: { type: "string", minLength: 1, maxLength: 100 },
            ...NODE_FIELDS,
          },
          required: ["type"],
          additionalProperties: false,
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
      change("removeNode", { nodeId: IDENTIFIER }),
      change("connect", { from: IDENTIFIER, to: IDENTIFIER }),
      change("disconnect", { from: IDENTIFIER, to: IDENTIFIER }),
      change("bind", {
        nodeId: IDENTIFIER,
        parameter: { type: "string", pattern: "^[a-z][a-z0-9_]{0,63}$" },
        binding: BINDING,
      }),
      change("unbind", { nodeId: IDENTIFIER, parameter: IDENTIFIER }),
    ],
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
  "Pages applies the rules of its plan page on every call: a plan is visible while the account can open the project of its workspace and the plan is its own or shared with it; a hidden plan answers NOT_FOUND like a missing one.";
const RUN_DESCRIPTION =
  "Runs belong to the account that started them; other accounts' runs are never listed or read, and reading a run also needs current access to the agents, workspaces, tickets and pages it used. Name the run by runId (planId may be added and must match), or by planId with select latest (newest start) or first (oldest start). A missing or hidden run is NOT_FOUND.";
const CHANGE_DESCRIPTION =
  "Only the owner (canEdit) changes a plan; a plan that is only shared with the account is FORBIDDEN. Pass the revision read last as expectedRevision; CONFLICT with details.currentRevision means it changed meanwhile and nothing was written. Pages checks the saved plan like its plan page: INVALID_REQUEST with details.reason graph_invalid and details.issues (nodeId, port, problem) for a refused graph, parameter_value_invalid, workspace_unavailable, parameter_reference_unavailable (a ticket, page or workspace the account cannot use), sharing_target_unavailable or credentials_in_text. Reuse operationId with identical parameters after response loss to receive the stored result without a second change; the same operationId with other parameters is CONFLICT. The result is { planId, changed, revision, createdNodeIds }.";
const STRUCTURE_DESCRIPTION =
  "changes apply in order and together or not at all. addNode adds start, end, agent (agentId from read_plan_sources, optional personalAgentId, instruction and completion), task (taskId of a task or subtask of the project) or parameter (name a-z0-9_, value, optional format string|number|json) nodes; id is optional and lets later changes of the same call refer to the node, x and y default to the next free slot. A new agent node gets value nodes for its defaults and its directory parameter as in the editor. updateNode sets fields of the node's kind (x, y for every node). completion selects progress scope only: report (default) describes todos and acceptance criteria; todos follows the current ticket todo list, ticked live. In both modes, regular runner completion automatically releases successors, including internal group steps. Missing or invalid reports, open todos, unmet criteria, missing evidence and ticket changes are diagnostics and never fail execution; open or unknown work stays visible. Technical runner errors, access denials and explicit pause/stop remain effective. removeNode also removes its connections and the inputs it fed. connect and disconnect change flow connections from → to (start and agent nodes to agent and end nodes). bind sets where an agent node's input parameter takes its value: kind source (a parameter or task node), result (the text result of an earlier agent node) or literal; unbind removes it. element_missing (INVALID_REQUEST) means a named node, connection or input does not exist or has another kind; element_exists means an id, connection or parameter name is taken.";

const READ_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

interface ToolOptions {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly properties: Properties;
}

interface ReadToolOptions extends ToolOptions {
  readonly required?: readonly string[];
}

interface WriteToolOptions extends ToolOptions {
  readonly optionalKeys: readonly string[];
  /** Whether the change can remove nodes, connections or inputs. */
  readonly isDestructive: boolean;
}

function readTool(options: ReadToolOptions): Tool {
  const { name, title, description, properties, required = [] } = options;
  return {
    name,
    title,
    description,
    inputSchema: {
      type: "object",
      properties,
      ...(required.length === 0 ? {} : { required: [...required] }),
      additionalProperties: false,
    },
    annotations: READ_ANNOTATIONS,
  };
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
      destructiveHint: options.isDestructive,
      idempotentHint: true,
      openWorldHint: false,
    },
  };
}

const RUN_SELECTION: Properties = {
  runId: IDENTIFIER,
  planId: IDENTIFIER,
  select: SELECT,
};
const TARGET: Properties = { planId: IDENTIFIER, expectedRevision: REVISION };

/** Reads of agent plans, their runs and the reports of a run. */
export const PLAN_READ_TOOLS: readonly {
  readonly operation: AgentPlanReadOperation;
  readonly tool: Tool;
}[] = [
  {
    operation: "plans.list",
    tool: readTool({
      name: "list_plans",
      title: "List agent plans",
      description: `Lists the visible agent plans ordered by name: id, name, project, workspaceId, ownerId, canEdit, sharing, revision, nodeCount, state (idle, running, pausing, paused or stopping by the account's own runs) and latestRun. text keeps plans whose name contains it (case-insensitive), projectId those of one project. Pass nextCursor with the same query to continue. ${SEE_DESCRIPTION}`,
      properties: {
        text: NAME,
        projectId: IDENTIFIER,
        cursor: CURSOR,
        limit: LIMIT,
      },
    }),
  },
  {
    operation: "plans.read",
    tool: readTool({
      name: "read_plan",
      title: "Read agent plan",
      description: `Reads one visible plan with its nodes (id, type, x, y, label and the fields of its kind, agent nodes with bindings), its flow edges (from → to), sharing, revision and status: state, runCount, latestRun, isRunnable and issues as the plan page checks before Play. ${SEE_DESCRIPTION}`,
      properties: { planId: IDENTIFIER },
      required: ["planId"],
    }),
  },
  {
    operation: "plans.sources.read",
    tool: readTool({
      name: "read_plan_sources",
      title: "Read plan sources",
      description:
        "Lists the workspaces a plan can be created in (projects the account can open), and with workspaceId the agents a node of a plan there can run: id, name, model, isUsable, directoryParameter and the parameters each declares. No credential, connection or path is part of it. Tickets for task nodes are found with search_tickets.",
      properties: { workspaceId: IDENTIFIER },
    }),
  },
  {
    operation: "plans.runs.list",
    tool: readTool({
      name: "list_plan_runs",
      title: "List plan runs",
      description: `Lists the account's runs of a visible plan: runId, planId, planName, startedAt (ISO 8601) and status (running, pausing, paused, stopping, succeeded, failed or cancelled). order newest (default) or oldest sorts by start. 20 runs per page unless limit says otherwise; pass nextCursor with the same query to continue, total counts all runs. ${RUN_DESCRIPTION}`,
      properties: {
        planId: IDENTIFIER,
        order: { enum: ["newest", "oldest"] },
        cursor: CURSOR,
        limit: LIMIT,
      },
      required: ["planId"],
    }),
  },
  {
    operation: "plans.run.read",
    tool: readTool({
      name: "read_plan_run",
      title: "Read plan run",
      description: `Reads one run of the account: runId, planId, planName, planRevision, startedAt, endedAt, status, stopRequested and every node with status, isBlocked, error, verdict, startedAt, endedAt and hasReport. ${RUN_DESCRIPTION}`,
      properties: RUN_SELECTION,
    }),
  },
  {
    operation: "plans.run.reports.read",
    tool: readTool({
      name: "read_plan_run_reports",
      title: "Read plan run reports",
      description: `Reads the reports of one run of the account, each with runId, planId and stepId of the node it belongs to: status, startedAt, endedAt, the redacted result text (output), error, verdict, summary, todos, criteria with evidence, decisions and issues. stepId narrows it to one node (NOT_FOUND when that node has no report). Reports over 1 MiB of UTF-8 JSON are PAYLOAD_TOO_LARGE; read one node at a time then. ${RUN_DESCRIPTION}`,
      properties: { ...RUN_SELECTION, stepId: IDENTIFIER },
    }),
  },
];

const PARAMETER_FIELDS: Properties = {
  name: NODE_FIELDS.name,
  value: VALUE,
  format: FORMAT,
  x: COORDINATE,
  y: COORDINATE,
};

/** Changes of agent plans; only the owner changes a plan. */
export const PLAN_WRITE_TOOLS: readonly {
  readonly operation: AgentPlanWriteOperation;
  readonly tool: Tool;
}[] = [
  {
    operation: "plans.create",
    tool: writeTool({
      name: "create_plan",
      title: "Create agent plan",
      description: `Creates an agent plan owned by the connected account in a workspace from read_plan_sources. sharing is private when omitted; global shares it with everyone who can open the project, restricted with groupIds and/or departmentIds (operator or/and). A share never lets anyone else change the plan. ${STRUCTURE_DESCRIPTION} ${CHANGE_DESCRIPTION}`,
      properties: {
        name: NAME,
        workspaceId: IDENTIFIER,
        sharing: SHARING,
        changes: CHANGES,
      },
      optionalKeys: ["sharing", "changes"],
      isDestructive: false,
    }),
  },
  {
    operation: "plans.update",
    tool: writeTool({
      name: "update_plan",
      title: "Update agent plan",
      description: `Changes the name, the share or the structure of a plan; at least one of them is required. A request that matches the stored plan returns changed false. The workspace of a plan does not change. ${STRUCTURE_DESCRIPTION} ${CHANGE_DESCRIPTION}`,
      properties: { ...TARGET, name: NAME, sharing: SHARING, changes: CHANGES },
      optionalKeys: ["name", "sharing", "changes"],
      isDestructive: true,
    }),
  },
  {
    operation: "plans.parameter.create",
    tool: writeTool({
      name: "create_plan_parameter",
      title: "Create plan parameter",
      description: `Adds one parameter node to a plan: a name (a-z, 0-9, _; unique in the plan, element_exists otherwise) and a value of type text, number, ticket, workspace or wiki. format string (default; number for a number value), number or json says how a text value is checked; numbers and JSON reach text inputs as text. Bind it to an agent input with update_plan. createdNodeIds holds its id. ${CHANGE_DESCRIPTION}`,
      properties: { ...TARGET, ...PARAMETER_FIELDS },
      optionalKeys: ["format", "x", "y"],
      isDestructive: false,
    }),
  },
  {
    operation: "plans.parameter.update",
    tool: writeTool({
      name: "update_plan_parameter",
      title: "Update plan parameter",
      description: `Changes the name, value, format or position of one parameter node, named by parameterId (its node id from read_plan); pass only what changes. An id that is no parameter node is NOT_FOUND. ${CHANGE_DESCRIPTION}`,
      properties: { ...TARGET, parameterId: IDENTIFIER, ...PARAMETER_FIELDS },
      optionalKeys: ["name", "value", "format", "x", "y"],
      isDestructive: false,
    }),
  },
  {
    operation: "plans.parameter.remove",
    tool: writeTool({
      name: "remove_plan_parameter",
      title: "Remove plan parameter",
      description: `Removes one parameter node, named by parameterId, together with the agent inputs it fed; those inputs fall back to the agent's defaults. An id that is no parameter node is NOT_FOUND. ${CHANGE_DESCRIPTION}`,
      properties: { ...TARGET, parameterId: IDENTIFIER },
      optionalKeys: [],
      isDestructive: true,
    }),
  },
];
