import { AGENT_READ_LIMITS } from "../AgentReadChunks.js";
import {
  CHANGES,
  EXECUTION_TARGET,
  FORMAT,
  PARAMETER_NAME,
  VALUE,
} from "./PlanChangeSchema.js";
import {
  COORDINATE_SCHEMA,
  CURSOR_SCHEMA,
  IDENTIFIER_SCHEMA,
  LIMIT_SCHEMA,
  REVISION_SCHEMA,
  buildReadTool,
  buildWriteTool,
} from "./ToolDefinition.js";

import type { PropertySchema, ToolProperties } from "./ToolDefinition.js";
import type { Tool } from "@modelcontextprotocol/server";
import type {
  AgentPlanReadOperation,
  AgentPlanWriteOperation,
} from "../AgentPlanOperations.js";

const NAME = { type: "string", minLength: 1, maxLength: 120 } as const;

const SELECT: PropertySchema = { enum: ["latest", "first"] };

const SHARING: PropertySchema = {
  type: "object",
  properties: {
    scope: { enum: ["private", "global", "restricted"] },
    operator: { enum: ["or", "and"] },
    groupIds: { type: "array", maxItems: 100, items: IDENTIFIER_SCHEMA },
    departmentIds: { type: "array", maxItems: 100, items: IDENTIFIER_SCHEMA },
  },
  required: ["scope"],
  additionalProperties: false,
};

const SEE_DESCRIPTION =
  "Pages applies the rules of its plan page on every call: a plan is visible while the account can open the project of its workspace and the plan is its own, belongs to a department the account is a member or leader of (its team) or is shared with it; a hidden plan answers NOT_FOUND like a missing one.";
const RUN_DESCRIPTION =
  "Runs belong to the account that started them; other accounts' runs are never listed or read, and reading a run also needs current access to the agents, workspaces, tickets and pages it used. Name the run by runId (planId may be added and must match), or by planId with select latest (newest start) or first (oldest start). A missing or hidden run is NOT_FOUND.";
const CHANGE_DESCRIPTION =
  "Only the owner or a member or leader of the plan's team (canEdit) changes a plan; a plan that is only shared with the account is FORBIDDEN, and so is a move to a workspace of another project by a team member who is not the owner. Whoever saves works with their own access: agents, models, tickets and pages are checked for the connected account. The owner and the team of a plan never change by a save. Pass the revision read last as expectedRevision; CONFLICT with details.currentRevision means it changed meanwhile and nothing was written. Pages checks the saved plan like its plan page: INVALID_REQUEST with details.reason graph_invalid and details.issues (nodeId, port, problem) for a refused graph, plan_frame_repair_required when a frame move or dissolution would replace edges or change bindings (explicitly disconnect, unbind or clear the affected loop condition first), parameter_value_invalid, workspace_unavailable, parameter_reference_unavailable (a ticket, page or workspace the account cannot use), plan_script_invalid (a script field breaks its rules), plan_script_profile_missing (a new or changed interpreterProfileId names no configured profile), plan_name_taken (another plan of the team in the same project has the name, ignoring case and surrounding spaces; nothing was written), sharing_target_unavailable or credentials_in_text (also in script content). Reuse operationId with identical parameters after response loss to receive the stored result without a second change; the same operationId with other parameters is CONFLICT. The result is { planId, changed, revision, createdNodeIds }. Plan create/update and parameter create/update accept a 2 MiB UTF-8 JSON envelope; split independent changes across revisions if needed.";
const STRUCTURE_DESCRIPTION =
  "Changes are ordered and atomic. addNode creates start/end/agent/script/task/parameter/group/loop; group needs name and starts empty/portless. New agent nodes select an explicit connectionId and model from read_plan_sources.models in configuration; agentId is not required. No agent or model profile has to be created. updateNode changes only the fields of that family, also for agent members inside groups. configuration is a PATCH: name, connectionId + model (modelProfileId remains a compatibility selection key) and reasoningEffort, template.markdown/parameters/directoryParameter/run; omitted fields survive. Model/provider facts derive from read_plan_sources.models, reasoning must be one of that model's choices, or null for the provider standard. Run patches merge; changing a model keeps instructions, inputs, bindings and run options. Unsupported run options require an explicit correction. x/y are integers 0..6000 exactly as in the editor. Batch multiple updates for joint positioning. placeNode moves an agent into groupId (null detaches), x/y relative inside a group, absolute outside. Edges and bindings survive membership changes. Groups never have ports; loops have outer flow ports, and frames cannot nest. placeLoopNode(nodeId,loopId|null,x,y) moves an agent or script into/out of a loop. A membership change that would discard a flow edge, result binding or loop-condition source is refused with plan_frame_repair_required; explicitly repair those references first. Loops accept name, runs(1..999), runsSource(value|parameter), countMode(max|expected), sessionPolicy(reuse|fresh), and the editor condition. bind can supply loop.runs and previous-iteration results inside a loop. The plan executionTarget is {kind:local} or {kind:remote,workspaceId} from read_plan_sources.remoteTargets; it is inherited by agent and script nodes unless they specify an executionTarget of their own. Omitting it in an update preserves the saved target; Remote Play requires an authorized ready runner and its actual model/interpreter catalog; unavailable targets never fall back to local work. Groups and loops with remote targets remain subject to the existing runtime restrictions. connect/disconnect name actual members, including internal and cross-group edges. bind/unbind target agent members or scripts with source/result/literal typed values. removeNode removes the node and its incident references; a group removal deletes its members. ungroup keeps all members/edges/bindings and requires an explicit absolute position for each member; ambiguous legacy aliases are refused. insertTemplate inserts a checked independent copy of templateId at x/y and returns all new IDs. Scripts use declared text inputs, zero or one text output, a configured interpreter profile and a finite timeout of 1..86400 seconds (default 60). An output policy may be report or gate: both require a JSON object with status, summary and nonempty checks of {name,status,detail}; status is passed, failed or partial and must agree with the check outcomes. report forwards a complete failed or partial finding as data; gate blocks unless all checks pass. Omitted policy preserves arbitrary text. Explicit authorized Play executes scripts as processes in the approved workspace, requiring active administrator mode and current plan/project/workspace rights. stdin receives one JSON object of named text values; stdout is text and stderr is diagnostic. Local streams are each limited to 128 KiB UTF-8; a remote runner limits both together to 64 KiB and retains a bounded stderr tail. Credential-shaped content is filtered. Saving never starts a run. Unknown fields, raw groups/steps/edges replacement and arbitrary credentials are refused.";

const RUN_SELECTION: ToolProperties = {
  runId: IDENTIFIER_SCHEMA,
  planId: IDENTIFIER_SCHEMA,
  select: SELECT,
};
const TARGET: ToolProperties = {
  planId: IDENTIFIER_SCHEMA,
  expectedRevision: REVISION_SCHEMA,
};

/** Reads of agent plans, their runs and the reports of a run. */
export const PLAN_READ_TOOLS: readonly {
  readonly operation: AgentPlanReadOperation;
  readonly tool: Tool;
}[] = [
  {
    operation: "plans.list",
    tool: buildReadTool({
      name: "list_plans",
      title: "List agent plans",
      description: `Lists the visible agent plans ordered by name: id, name, project, workspaceId, ownerId, canEdit, team (the department whose members and leaders share the plan, or null), sharing, revision, nodeCount, state (idle, running, pausing, paused or stopping by the account's own runs) and latestRun. text keeps plans whose name contains it (case-insensitive), projectId those of one project. Pass nextCursor with the same query to continue. ${SEE_DESCRIPTION}`,
      properties: {
        text: NAME,
        projectId: IDENTIFIER_SCHEMA,
        cursor: CURSOR_SCHEMA,
        limit: LIMIT_SCHEMA,
      },
    }),
  },
  {
    operation: "plans.read",
    tool: buildReadTool({
      name: "read_plan",
      title: "Read agent plan",
      description: `Reads one visible plan with its nodes (id, type, x, y, label and the fields of its kind, agent and script nodes with bindings), its flow edges (from → to), sharing, stored default executionTarget, revision and status: state, runCount, latestRun, live isRunnable and graph issues. Large reads return chunk {text, offsetBytes, byteLength, totalBytes, sha256, nextCursor}: concatenate text in offset order, verify SHA-256 and parse JSON. Pass nextCursor as cursor with the same planId and maxBytes. maxBytes forces chunking (1024..65536 UTF-8 bytes including the response envelope; default 65536). The complete plan is streamed without the general 1 MiB serialized-result limit; each page rechecks its snapshot and very large plans need more work to read. Cursors bind the account, revision and exact snapshot; changes or another query return INVALID_REQUEST. A null executionTarget means the stored plan has no explicit default; consult its registered workspace and current control rather than assuming a local fallback. No partial result is presented as a complete plan. read_plan_control additionally reports actual shared execution state and concrete availability blockers. ${SEE_DESCRIPTION}`,
      properties: {
        planId: IDENTIFIER_SCHEMA,
        cursor: CURSOR_SCHEMA,
        maxBytes: {
          type: "integer",
          minimum: AGENT_READ_LIMITS.minimumChunkBytes,
          maximum: AGENT_READ_LIMITS.chunkBytes,
        },
      },
      required: ["planId"],
    }),
  },
  {
    operation: "plans.sources.read",
    tool: buildReadTool({
      name: "read_plan_sources",
      title: "Read plan sources",
      description:
        "Returns authorized direct connection/model pairs with a selection key, connectionId, provider, model and supported reasoningEfforts, secret-free source configuration copies and editor limits. Lists the workspaces a plan can be created in (projects the account can open), and with workspaceId the agents, interpreter profiles and visible remote targets of that project. remoteStatus reports the current problem and Pages, OpenCode and exact-result capabilities for each visible target; a false hasExactResultPayload requires Runner 1.13.0 before a new remote CLI start. Authorized remote target paths are included; interpreter executable paths and credentials are not. Tickets for task nodes are found with search_tickets.",
      properties: { workspaceId: IDENTIFIER_SCHEMA },
    }),
  },
  {
    operation: "plans.runs.list",
    tool: buildReadTool({
      name: "list_plan_runs",
      title: "List plan runs",
      description: `Lists the account's runs of a visible plan: runId, planId, planName, startedAt (ISO 8601) and status (running, pausing, paused, stopping, succeeded, failed or cancelled). order newest (default) or oldest sorts by start. 20 runs per page unless limit says otherwise; pass nextCursor with the same query to continue, total counts all runs. ${RUN_DESCRIPTION}`,
      properties: {
        planId: IDENTIFIER_SCHEMA,
        order: { enum: ["newest", "oldest"] },
        cursor: CURSOR_SCHEMA,
        limit: LIMIT_SCHEMA,
      },
      required: ["planId"],
    }),
  },
  {
    operation: "plans.run.read",
    tool: buildReadTool({
      name: "read_plan_run",
      title: "Read plan run",
      description: `Reads one run of the account: runId, planId, planName, planRevision, startedAt, endedAt, status, stopRequested appliedPlanRevision, continuationVersion, loop iterations with their member statuses, and every node with status, isBlocked, blockedByStepId when recorded, error, verdict, startedAt, endedAt and hasReport. For remote attempts, these timestamps are Pages observations, not proven process start and end times. ${RUN_DESCRIPTION}`,
      properties: RUN_SELECTION,
    }),
  },
  {
    operation: "plans.run.reports.read",
    tool: buildReadTool({
      name: "read_plan_run_reports",
      title: "Read plan run reports",
      description: `Reads the reports of one run of the account, each with runId, planId and stepId of the node it belongs to (loop member reports additionally identify loopId and iteration): status, startedAt, endedAt, the redacted result text (output), isOutputFiltered, error, verdict, summary, todos, criteria with evidence, decisions and issues. stepId narrows it to one node (NOT_FOUND when that node has no report). Reports over 1 MiB of UTF-8 JSON are PAYLOAD_TOO_LARGE; read one node at a time then. ${RUN_DESCRIPTION}`,
      properties: { ...RUN_SELECTION, stepId: IDENTIFIER_SCHEMA },
    }),
  },
];

const PARAMETER_FIELDS: ToolProperties = {
  name: PARAMETER_NAME,
  value: VALUE,
  format: FORMAT,
  x: COORDINATE_SCHEMA,
  y: COORDINATE_SCHEMA,
};

/** Changes of agent plans; the owner and the members and leaders of the plan's team change a plan. */
export const PLAN_WRITE_TOOLS: readonly {
  readonly operation: AgentPlanWriteOperation;
  readonly tool: Tool;
}[] = [
  {
    operation: "plans.create",
    tool: buildWriteTool({
      name: "create_plan",
      title: "Create agent plan",
      description: `Creates an agent plan owned by the connected account in a workspace from read_plan_sources. A plan of an account that is a member or leader of exactly one department also belongs to that department's team: its members and leaders who can open the project read, change and run it, each with their own access (an account with no or several departments creates plans without a team; leading and being a member of the same department is one department). The name is unique among the team's plans of a project, ignoring case and surrounding spaces. sharing is private when omitted; global shares it with everyone who can open the project, restricted with groupIds and/or departmentIds (operator or/and). A share only lets others read the plan, never change it. ${STRUCTURE_DESCRIPTION} ${CHANGE_DESCRIPTION}`,
      properties: {
        name: NAME,
        workspaceId: IDENTIFIER_SCHEMA,
        sharing: SHARING,
        executionTarget: EXECUTION_TARGET,
        changes: CHANGES,
      },
      optionalKeys: ["sharing", "executionTarget", "changes"],
      isDestructive: false,
    }),
  },
  {
    operation: "plans.update",
    tool: buildWriteTool({
      name: "update_plan",
      title: "Update agent plan",
      description: `Changes the name, the share, the workspace, the default execution target or the structure of a plan; at least one of them is required. Every team member may change the share (the same checks as for the owner; it only lets others read the plan) and may move the plan to another workspace of its project that the connected account can use (workspace_unavailable otherwise); a workspace of another project is the owner's alone (FORBIDDEN). A request that matches the stored plan returns changed false. ${STRUCTURE_DESCRIPTION} ${CHANGE_DESCRIPTION}`,
      properties: {
        ...TARGET,
        name: NAME,
        sharing: SHARING,
        workspaceId: IDENTIFIER_SCHEMA,
        executionTarget: EXECUTION_TARGET,
        changes: CHANGES,
      },
      optionalKeys: [
        "name",
        "sharing",
        "workspaceId",
        "executionTarget",
        "changes",
      ],
      isDestructive: true,
    }),
  },
  {
    operation: "plans.parameter.create",
    tool: buildWriteTool({
      name: "create_plan_parameter",
      title: "Create plan parameter",
      description: `Adds one parameter node to a plan: a display name (letters, digits and _, starting with a letter; nodes are identified by ID) and a value of type text, number, ticket, workspace or wiki. format string (default; number for a number value), number or json says how a text value is checked; numbers and JSON reach text inputs as text. Bind it to an agent input with update_plan. createdNodeIds holds its id. ${CHANGE_DESCRIPTION}`,
      properties: { ...TARGET, ...PARAMETER_FIELDS },
      optionalKeys: ["format", "x", "y"],
      isDestructive: false,
    }),
  },
  {
    operation: "plans.parameter.update",
    tool: buildWriteTool({
      name: "update_plan_parameter",
      title: "Update plan parameter",
      description: `Changes the name, value, format or position of one parameter node, named by parameterId (its node id from read_plan); pass only what changes. An id that is no parameter node is NOT_FOUND. ${CHANGE_DESCRIPTION}`,
      properties: {
        ...TARGET,
        parameterId: IDENTIFIER_SCHEMA,
        ...PARAMETER_FIELDS,
      },
      optionalKeys: ["name", "value", "format", "x", "y"],
      isDestructive: true,
    }),
  },
  {
    operation: "plans.parameter.remove",
    tool: buildWriteTool({
      name: "remove_plan_parameter",
      title: "Remove plan parameter",
      description: `Removes one parameter node, named by parameterId, together with the agent inputs it fed; those inputs fall back to the agent's defaults. An id that is no parameter node is NOT_FOUND. ${CHANGE_DESCRIPTION}`,
      properties: { ...TARGET, parameterId: IDENTIFIER_SCHEMA },
      optionalKeys: [],
      isDestructive: true,
    }),
  },
];
