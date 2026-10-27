/** Editable node fields shared by the operation reader and MCP schema. Graph membership uses explicit changes. */
export const PLAN_NODE_FIELDS = {
  start: [],
  end: [],
  group: ["name"],
  loop: [
    "name",
    "runs",
    "runsSource",
    "countMode",
    "sessionPolicy",
    "condition",
  ],
  agent: [
    "agentId",
    "personalAgentId",
    "instruction",
    "executionTarget",
    "completion",
    "completionGate",
    "configuration",
  ],
  script: [
    "name",
    "executionTarget",
    "interpreterProfileId",
    "content",
    "inputs",
    "outputs",
    "timeoutSeconds",
  ],
  task: ["taskId"],
  parameter: ["name", "format", "value"],
  variable: [],
} as const;

/** Node families the editor creates; legacy variables remain readable and movable. */
export const PLAN_ADDABLE_TYPES = [
  "start",
  "end",
  "agent",
  "script",
  "task",
  "parameter",
  "group",
  "loop",
] as const;
