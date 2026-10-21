import {
  CURSOR_SCHEMA,
  IDENTIFIER_SCHEMA,
  LIMIT_SCHEMA,
  READ_ANNOTATIONS,
} from "./tool-definition.js";

import type { Tool } from "@modelcontextprotocol/server";
import type {
  PageAgentReadOperation,
  PageAgentWriteOperation,
} from "../../../definition/PageAgentOperations.js";

const SEE_DESCRIPTION =
  "Legacy definitions stay readable; they are no longer a required step for using a model.";

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
      description: `Compatibility read of retained definitions; configure new nodes directly with read_plan_sources and create_plan/update_plan. Lists the user agents of the connected account: id, name, instruction, parameters, directoryParameter, run options (read only), modelProfileId, model, reasoningEffort, sharing with group and department names, ownerId, canEdit (only the owner), isUsable (a run could start now), hasDeletedTargets and revision. Ordered by name; pass nextCursor with the same query to continue. ${SEE_DESCRIPTION}`,
      inputSchema: {
        type: "object",
        properties: {
          cursor: CURSOR_SCHEMA,
          limit: LIMIT_SCHEMA,
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
      description: `Compatibility read; new instructions belong to plan nodes. Reads one user agent by its id, with the same fields as list_agents. ${SEE_DESCRIPTION}`,
      inputSchema: {
        type: "object",
        properties: { agentId: IDENTIFIER_SCHEMA },
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
        "Lists currently permitted connection/model pairs for direct plan nodes, with reasoning support. modelProfileId is a compatibility selection key, not a managed profile. connectionId plus model identifies the access. No credentials are returned and no provider is called. No model is selected implicitly; pass an explicit pair in a plan node configuration. Prefer read_plan_sources for the workspace-specific plan contract.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: READ_ANNOTATIONS,
    },
  },
];

/** Definition writes are retired; direct node configuration is offered by the plan tools. */
export const AGENT_WRITE_TOOLS: readonly {
  readonly operation: PageAgentWriteOperation;
  readonly tool: Tool;
}[] = [];
