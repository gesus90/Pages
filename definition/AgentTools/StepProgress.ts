import {
  AGENT_TODO_LIMIT,
  AGENT_TODO_PRIORITIES,
  AGENT_TODO_STATUS_ALIASES,
  AGENT_TODO_STATUSES,
  AGENT_TODO_TEXT_LENGTH,
} from "../AgentPlanAgentTodos.js";
import {
  AGENT_STEP_ACTIVITY_LENGTH,
  AGENT_STEP_PROGRESS_STATUSES,
} from "../AgentPlanStepProgress.js";

import {
  ADDITIVE_ANNOTATIONS,
  IDENTIFIER_SCHEMA,
  stringChoice,
} from "./ToolDefinition.js";

import type { Tool } from "@modelcontextprotocol/server";

/**
 * Reports the live progress of the running step of a run-bound connection.
 * @remarks
 * Read-only sessions must be able to call it like `report_step_result`, so
 * it carries the hints of an additive write: it only changes the progress of
 * the session's own step and ends nothing. `plan` is the agent's own list of
 * concrete work steps; Pages stores it like a structured CLI plan, so every
 * runner has the same way to show its work list in the terminal.
 */
export const STEP_PROGRESS_TOOL = {
  name: "update_step_progress",
  title: "Update the step progress",
  description:
    "Reports live todo states, your own work list or a short activity line for the current plan step. todos holds only the assigned todo IDs of the run contract (status open, active or done; pending, in_progress and completed count as open, active and done); only the named todos change. plan is your own complete list of concrete work steps in order (text and status open, active, done or failed; pending, in_progress and completed count as open, active and done; a priority is ignored); every call with plan replaces the whole list, unchanged entries keep their state, so always send all entries. Send the list before your first command and again after each finished entry; the closing report_step_result call is no entry, because it checks that every entry is done and refuses done while you never sent a list. While your list is missing, the answer names it in notice. Use todos: [] with activity or plan to report progress without changing assigned todos. Pages refuses unknown todo IDs and names them in details.problems. The binding result comes from report_step_result. Available only to plan sessions.",
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
            status: stringChoice([
              ...AGENT_STEP_PROGRESS_STATUSES,
              ...AGENT_TODO_STATUS_ALIASES,
            ]),
            priority: stringChoice(AGENT_TODO_PRIORITIES),
          },
          required: ["id", "status"],
          additionalProperties: false,
        },
      },
      plan: {
        type: "array",
        minItems: 1,
        maxItems: AGENT_TODO_LIMIT,
        items: {
          type: "object",
          properties: {
            text: {
              type: "string",
              minLength: 1,
              maxLength: AGENT_TODO_TEXT_LENGTH,
            },
            status: stringChoice([
              ...AGENT_TODO_STATUSES,
              ...AGENT_TODO_STATUS_ALIASES,
            ]),
            priority: stringChoice(AGENT_TODO_PRIORITIES),
          },
          required: ["text", "status"],
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
