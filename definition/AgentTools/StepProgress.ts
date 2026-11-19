import {
  AGENT_STEP_ACTIVITY_LENGTH,
  AGENT_STEP_PROGRESS_STATUSES,
} from "../AgentPlanStepProgress.js";

import { ADDITIVE_ANNOTATIONS, IDENTIFIER_SCHEMA } from "./ToolDefinition.js";

import type { Tool } from "@modelcontextprotocol/server";

/**
 * Reports the live progress of the running step of a run-bound connection.
 * @remarks
 * Read-only sessions must be able to call it like `report_step_result`, so
 * it carries the hints of an additive write: it only changes the progress of
 * the session's own step and ends nothing.
 */
export const STEP_PROGRESS_TOOL = {
  name: "update_step_progress",
  title: "Update the step progress",
  description:
    "Reports live todo states or a short activity line for the current plan step. Use todos: [] with activity to report progress without changing todo states. Set a todo to active when starting it and to done when finishing it. Only the named todos change. Pages refuses unknown todo IDs and names them in details.problems. The binding result comes from report_step_result. Available only to plan sessions.",
  inputSchema: {
    type: "object",
    properties: {
      todos: {
        type: "array",
        maxItems: 1000,
        items: {
          type: "object",
          properties: {
            id: IDENTIFIER_SCHEMA,
            status: { enum: [...AGENT_STEP_PROGRESS_STATUSES] },
          },
          required: ["id", "status"],
          additionalProperties: false,
        },
      },
      activity: {
        type: "string",
        minLength: 1,
        maxLength: AGENT_STEP_ACTIVITY_LENGTH,
      },
    },
    required: ["todos"],
    additionalProperties: false,
  },
  annotations: ADDITIVE_ANNOTATIONS,
} satisfies Tool;
