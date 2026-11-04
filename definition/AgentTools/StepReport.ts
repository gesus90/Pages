import { AGENT_STEP_REPORT_STATUSES } from "../AgentPlanStepReport.js";

import { ADDITIVE_ANNOTATIONS, IDENTIFIER_SCHEMA } from "./ToolDefinition.js";

import type { Tool } from "@modelcontextprotocol/server";

const text = { type: "string", minLength: 1, maxLength: 2000 } as const;

/**
 * Reports the result of the running step of a run-bound connection.
 *
 * @remarks
 * Read-only sessions must be able to call it, and they run without anybody who
 * could confirm a call. So it carries the hints of an additive write: it only
 * replaces the session's own result and changes no other Pages record.
 */
export const STEP_REPORT_TOOL = {
  name: "report_step_result",
  title: "Report the step result",
  description:
    "Reports the result of the plan step this session runs; the connection is bound to that run and step and has no other target. A valid call is the result of the step, also without any pages-report text, and a later call of the same attempt replaces it. status done requires every todo done and every criterion met with real evidence, and checked ticket entries where the session can check them. status blocked stops the step for a person to decide; message names why. Pages checks the call at once: a refused call sets nothing and details.problems names what to correct. runId and stepId are optional and only refuse a call meant for another run or step. Available only to plan sessions.",
  inputSchema: {
    type: "object",
    properties: {
      status: { enum: [...AGENT_STEP_REPORT_STATUSES] },
      message: text,
      todos: {
        type: "array",
        maxItems: 1000,
        items: {
          type: "object",
          properties: {
            id: IDENTIFIER_SCHEMA,
            status: { enum: ["done", "open"] },
          },
          required: ["id", "status"],
          additionalProperties: false,
        },
      },
      criteria: {
        type: "array",
        maxItems: 1000,
        items: {
          type: "object",
          properties: {
            id: IDENTIFIER_SCHEMA,
            met: { type: "boolean" },
            evidence: { type: "string", maxLength: 2000 },
          },
          required: ["id", "met", "evidence"],
          additionalProperties: false,
        },
      },
      decisions: { type: "array", maxItems: 20, items: text },
      summary: { type: "string", maxLength: 2000 },
      runId: IDENTIFIER_SCHEMA,
      stepId: IDENTIFIER_SCHEMA,
    },
    required: ["status", "message"],
    additionalProperties: false,
  },
  annotations: ADDITIVE_ANNOTATIONS,
} satisfies Tool;
