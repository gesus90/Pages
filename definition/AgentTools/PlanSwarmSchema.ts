import {
  PLAN_SWARM_ACCESS_MODES,
  PLAN_SWARM_TEXT_LENGTH,
  PLAN_SWARM_TIMEOUT_MINUTES,
  PLAN_SWARM_WORKER_LIMIT,
} from "../AgentPlanSwarm.js";

import { PLAN_NODE_IDENTIFIER_SCHEMA } from "./ToolDefinition.js";

import type { PropertySchema, ToolProperties } from "./ToolDefinition.js";

const MODEL: PropertySchema = {
  oneOf: [
    { type: "null" },
    {
      type: "object",
      properties: {
        connectionId: PLAN_NODE_IDENTIFIER_SCHEMA,
        provider: {
          enum: ["codex_cli", "claude_code", "opencode", "antigravity"],
        },
        model: { type: "string", minLength: 1, maxLength: 200 },
        reasoningEffort: { type: ["string", "null"], maxLength: 100 },
      },
      required: ["connectionId", "provider", "model", "reasoningEffort"],
      additionalProperties: false,
    },
  ],
};

const ACCESS: PropertySchema = { enum: [...PLAN_SWARM_ACCESS_MODES] };

const WORKER: PropertySchema = {
  type: "object",
  properties: { model: MODEL, access: ACCESS },
  required: ["model", "access"],
  additionalProperties: false,
};

const INSTRUCTION: PropertySchema = {
  type: "string",
  maxLength: PLAN_SWARM_TEXT_LENGTH.instruction,
};

/** The fields of a swarm node (PAGE-313) in a plan change. */
export const SWARM_FIELDS: ToolProperties = {
  task: {
    description:
      "swarm: the task as text, or source ticket with the ticket bound as the input task.",
    oneOf: [
      {
        type: "object",
        properties: {
          source: { const: "text" },
          text: { type: "string", maxLength: PLAN_SWARM_TEXT_LENGTH.task },
        },
        required: ["source", "text"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: { source: { const: "ticket" } },
        required: ["source"],
        additionalProperties: false,
      },
    ],
  },
  main: {
    type: "object",
    description:
      "swarm: the main model (connection, model and reasoning from read_plan_sources.models), its access and an optional additional instruction.",
    properties: { model: MODEL, access: ACCESS, instruction: INSTRUCTION },
    required: ["model", "access"],
    additionalProperties: false,
  },
  workers: {
    type: "object",
    description: `swarm: 1 to ${String(PLAN_SWARM_WORKER_LIMIT)} helpers. mode same uses the same configuration for every helper; individual uses one entry per helper, H1 first. instruction is shared by every helper.`,
    properties: {
      count: { type: "integer", minimum: 1, maximum: PLAN_SWARM_WORKER_LIMIT },
      mode: { enum: ["same", "individual"] },
      same: WORKER,
      individual: {
        type: "array",
        maxItems: PLAN_SWARM_WORKER_LIMIT,
        items: WORKER,
      },
      instruction: INSTRUCTION,
    },
    required: ["count", "mode", "same", "individual"],
    additionalProperties: false,
  },
  directory: {
    type: "string",
    maxLength: PLAN_SWARM_TEXT_LENGTH.directory,
    description:
      "swarm: a directory below the plan workspace; empty means its root.",
  },
  timeoutMinutes: {
    type: "integer",
    minimum: PLAN_SWARM_TIMEOUT_MINUTES.minimum,
    maximum: PLAN_SWARM_TIMEOUT_MINUTES.maximum,
    description:
      "swarm: the time limit of the whole node. A remote execution target is refused with swarm_remote_unsupported.",
  },
};
