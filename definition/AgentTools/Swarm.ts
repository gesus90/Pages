import {
  AGENT_SWARM_STATUS_WAIT_SECONDS,
  type AgentSwarmOperation,
} from "../AgentPlanSwarmOperations.js";
import {
  PLAN_SWARM_PATH_LENGTH,
  PLAN_SWARM_SCOPE_PATHS,
} from "../AgentPlanSwarmScope.js";
import { PLAN_SWARM_RUN_TEXT } from "../AgentPlanSwarmRun.js";

import { ADDITIVE_ANNOTATIONS, READ_ANNOTATIONS } from "./ToolDefinition.js";

import type { Tool } from "@modelcontextprotocol/server";

const WORKER = { type: "string", pattern: "^H(?:[1-9]|10)$" } as const;
const TASK = { type: "string", pattern: "^T[0-9]{1,4}$" } as const;
const PATH = {
  type: "string",
  minLength: 1,
  maxLength: PLAN_SWARM_PATH_LENGTH,
} as const;

const SWARM_NOTE = "Available only to the sessions of a swarm node.";

function swarmTool(
  name: string,
  description: string,
  properties: NonNullable<Tool["inputSchema"]["properties"]>,
  required: readonly string[],
): Tool {
  return {
    name,
    title: name.replace("_", " "),
    description: `${description} ${SWARM_NOTE}`,
    inputSchema: {
      type: "object",
      properties: { ...properties },
      required: [...required],
      additionalProperties: false,
    },
    annotations:
      name === "swarm_status" ||
      name === "swarm_result" ||
      name === "swarm_locks"
        ? READ_ANNOTATIONS
        : ADDITIVE_ANNOTATIONS,
  };
}

/** The swarm tools of main model and helpers (PAGE-313), with their operations. */
export const SWARM_TOOLS: readonly {
  readonly operation: AgentSwarmOperation;
  readonly tool: Tool;
}[] = [
  {
    operation: "run.swarm.assign",
    tool: swarmTool(
      "swarm_assign",
      "Main model: hands a subtask to a given helper (workerId H1…H10) or the next free one, optionally with an area of responsibility (paths or directories relative to the working directory). Areas of subtasks that wait or run at the same time must not overlap; an overlap is refused with swarm_scope_overlap and nothing changes. taskId hands a failed or cancelled subtask out again (at most three times); a finished one never runs again. Answers at once.",
      {
        instruction: { type: "string", maxLength: PLAN_SWARM_RUN_TEXT },
        workerId: WORKER,
        scope: { type: "array", maxItems: PLAN_SWARM_SCOPE_PATHS, items: PATH },
        taskId: TASK,
      },
      [],
    ),
  },
  {
    operation: "run.swarm.status",
    tool: swarmTool(
      "swarm_status",
      `Main model: the state of every helper (idle, starting, busy, done, failed, not_started with its reason), every subtask, the TODOs, the held locks and the reported violations. Answers at once; waitSeconds (at most ${String(AGENT_SWARM_STATUS_WAIT_SECONDS)}) returns at the next change at the latest after that time.`,
      {
        waitSeconds: {
          type: "integer",
          minimum: 0,
          maximum: AGENT_SWARM_STATUS_WAIT_SECONDS,
        },
      },
      [],
    ),
  },
  {
    operation: "run.swarm.result",
    tool: swarmTool(
      "swarm_result",
      "Main model: one subtask with its status, result or error.",
      { taskId: TASK },
      ["taskId"],
    ),
  },
  {
    operation: "run.swarm.cancel",
    tool: swarmTool(
      "swarm_cancel",
      "Main model: cancels a waiting or running subtask; the helper's session ends and its locks are released.",
      { taskId: TASK },
      ["taskId"],
    ),
  },
  {
    operation: "run.swarm.finish",
    tool: swarmTool(
      "swarm_finish",
      "Main model: ends the swarm node with a summary, as succeeded or failed. Running subtasks are cancelled. Nothing else ends the node.",
      {
        status: { enum: ["succeeded", "failed"] },
        summary: {
          type: "string",
          minLength: 1,
          maxLength: PLAN_SWARM_RUN_TEXT,
        },
      },
      ["status", "summary"],
    ),
  },
  {
    operation: "run.swarm.lock",
    tool: swarmTool(
      "swarm_lock",
      "Helper: locks a file before you change it. Never waits: answers locked, or taken with the helper that holds it (also when the file lies in another helper's area). Then do something else first and try again later. Reading needs no lock.",
      { path: PATH },
      ["path"],
    ),
  },
  {
    operation: "run.swarm.unlock",
    tool: swarmTool(
      "swarm_unlock",
      "Helper: releases a lock you hold. Your locks are released anyway when your subtask ends.",
      { path: PATH },
      ["path"],
    ),
  },
  {
    operation: "run.swarm.locks",
    tool: swarmTool(
      "swarm_locks",
      "Helper: lists who holds which lock.",
      {},
      [],
    ),
  },
];
