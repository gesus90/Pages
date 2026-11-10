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
    "mode",
    "while",
  ],
  agent: [
    "agentId",
    "personalAgentId",
    "instruction",
    "executionTarget",
    "completion",
    "completionGate",
    "role",
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
    "role",
  ],
  // The removed Git closeout (PAGE-285) is only moved or removed, never configured.
  git_closeout: [],
  decision: ["name", "mode", "question", "model", "output", "cases", "input"],
  stack: ["name", "entries"],
  asset: ["name", "file"],
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
  "stack",
  "decision",
] as const;
